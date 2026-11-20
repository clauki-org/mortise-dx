# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Sau khi ghi số đo, xét các luật ngưỡng của tenant (core.threshold_rules, do bộ cài gói và `make seed`
# nạp) và mở hồ sơ qua cases.py khi số đo vượt ngưỡng đủ lâu. Lịch sử lấy từ Scorpio, nên cầu nối khởi
# động lại, hay dừng trong lúc sao lưu, vẫn xét đúng; chỉ vài lần đo vừa ghi được nhớ thêm (xem RECENT).

import logging
import time
from collections import deque
from collections.abc import Callable
from datetime import datetime

import pg8000.native

from .cases import CaseError, Cases
from .message import Reading
from .rules import Rule, Sample, breaches, case_key, held
from .scorpio import Scorpio, Unavailable

log = logging.getLogger("iot-bridge.watch")

# Luật chỉ đổi khi cài, gỡ gói hay seed: đọc lại sau chừng này giây là đủ, không hỏi CSDL mỗi tin.
RULES_SECONDS = 30
# Scorpio ghi lịch sử (API temporal) sau khi trả lời lệnh ghi; đo ngày 2026-11-20 trên bản cài cục bộ (gửi
# một tin rồi hỏi lịch sử mỗi 0,5 giây), lần đo vừa ghi xuất hiện sau khoảng 2,5 giây. Thiếu những lần đo đó
# thì hồ sơ mở chậm một lần đo, hay lần đo bình thường vừa tới không cắt được chuỗi vượt ngưỡng. Nên nhớ vài
# lần đo gần nhất của mỗi thiết bị và số đo có luật để gộp với lịch sử.
RECENT = 20


class RuleCache:
    def __init__(self, load: Callable[[str], list[Rule]], clock: Callable[[], float] = time.monotonic):
        self._load = load
        self._clock = clock
        self._cache: dict[str, tuple[list[Rule], float]] = {}

    def of(self, tenant: str) -> list[Rule]:
        """Luật của tenant. CSDL lỗi thì dùng bản cũ nếu có, không thì không xét luật nào."""
        now = self._clock()
        cached = self._cache.get(tenant)
        if cached and cached[1] > now:
            return cached[0]
        try:
            rules = self._load(tenant)
        except Exception as error:  # noqa: BLE001 - mọi lỗi CSDL đều dẫn tới cùng cách xử lý
            log.error("Không đọc được luật ngưỡng của %s: %s", tenant, error)
            return cached[0] if cached else []
        self._cache[tenant] = (rules, now + RULES_SECONDS)
        return rules


class Watcher:
    def __init__(self, rules: RuleCache, scorpio: Scorpio, cases: Cases, history: int):
        self._rules = rules
        self._scorpio = scorpio
        self._cases = cases
        self._history = history
        self._recent: dict[tuple[str, str, str], deque[Sample]] = {}

    def check(self, reading: Reading) -> list[str]:
        """Id các hồ sơ đã mở hay còn mở cho tin này. Lỗi chỉ ghi log: số đo đã được ghi trước đó."""
        opened = []
        for rule in self._rules.of(reading.tenant):
            attribute = reading.entity.get(rule.measurement)
            if rule.entity_type != reading.entity["type"] or attribute is None:
                continue
            self._remember(reading, rule.measurement, attribute)
            # Số đo mới nhất không vượt thì chắc chắn chưa đủ, khỏi hỏi lịch sử.
            if not breaches(rule, attribute["value"]):
                continue
            try:
                case = self._check_rule(reading, rule, attribute)
            except (Unavailable, CaseError) as error:
                log.error("Không xét được luật %s/%s cho %s: %s", rule.app, rule.id, reading.device, error)
                continue
            if case:
                opened.append(case)
        return opened

    def _remember(self, reading: Reading, measurement: str, attribute: dict) -> None:
        key = (reading.tenant, reading.entity["id"], measurement)
        recent = self._recent.setdefault(key, deque(maxlen=RECENT))
        # Hai luật cùng số đo gọi lại với cùng lần đo; nhớ một lần.
        if recent and recent[-1].observed_at == datetime.fromisoformat(attribute["observedAt"]):
            return
        recent.append(Sample(datetime.fromisoformat(attribute["observedAt"]), attribute["value"]))

    def _check_rule(self, reading: Reading, rule: Rule, attribute: dict) -> str | None:
        stored = self._scorpio.history(reading.tenant, reading.entity["id"], rule.measurement, self._history)
        # Lần đo nhớ trong bộ nhớ thắng lần đo cùng thời điểm trong lịch sử: đó là giá trị vừa ghi.
        merged = {sample.observed_at: sample for sample in stored}
        merged |= {
            sample.observed_at: sample
            for sample in self._recent[(reading.tenant, reading.entity["id"], rule.measurement)]
        }
        samples = list(merged.values())
        current = Sample(datetime.fromisoformat(attribute["observedAt"]), attribute["value"])
        if not held(rule, samples):
            # Chuỗi vượt ngưỡng phủ hết lịch sử lấy về mà vẫn chưa đủ: luật giữ lâu hơn số lần đo
            # RULE_HISTORY phủ được thì không bao giờ mở hồ sơ; báo để người vận hành tăng RULE_HISTORY hay
            # giảm holdSeconds.
            if len(stored) >= self._history and all(breaches(rule, sample.value) for sample in samples):
                log.warning(
                    "Luật %s/%s: %d lần đo gần nhất của %s đều vượt mà chưa đủ %d giây; tăng RULE_HISTORY",
                    rule.app,
                    rule.id,
                    len(samples),
                    reading.device,
                    rule.hold_seconds,
                )
            return None
        variables = {
            "title": f"{rule.title}: {reading.device}",
            "rule": rule.id,
            "ruleApp": rule.app,
            "device": reading.device,
            "measurement": rule.measurement,
            "value": current.value,
            "threshold": rule.threshold,
            "observedAt": attribute["observedAt"],
        }
        case = self._cases.open(reading.tenant, rule.process, case_key(rule, reading.device), variables)
        log.info(
            "Hồ sơ %s cho luật %s/%s, thiết bị %s của %s",
            case,
            rule.app,
            rule.id,
            reading.device,
            reading.tenant,
        )
        return case


def database_rules(host: str, database: str, user: str, password: str) -> Callable[[str], list[Rule]]:
    def load(tenant: str) -> list[Rule]:
        connection = pg8000.native.Connection(
            user, host=host, database=database, password=password, timeout=5
        )
        try:
            rows = connection.run(
                "SELECT app, definition FROM core.threshold_rules WHERE tenant_id = :t ORDER BY app, rule",
                t=tenant,
            )
        finally:
            connection.close()
        return [Rule.from_definition(app, definition) for app, definition in rows]

    return load
