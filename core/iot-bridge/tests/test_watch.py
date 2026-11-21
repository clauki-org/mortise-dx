# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử vòng xét luật sau khi ghi số đo, với Scorpio, CSDL và workflow-api giả: mở hồ sơ đúng tenant khi đủ
# lâu, lỗi khi xét luật không làm mất số đo, và luật của tenant khác không áp vào.

import json
from datetime import UTC, datetime, timedelta

import httpx

from app.cases import CaseError, Cases
from app.main import Bridge
from app.rules import Rule, Sample
from app.tenants import TenantCheck
from app.watch import RuleCache, Watcher

T0 = datetime(2026, 11, 20, 10, 0, tzinfo=UTC)
RULE = Rule.from_definition(
    "core",
    {
        "id": "test-level-high",
        "title": "Kiểm thử",
        "entityType": "Device",
        "measurement": "testLevel",
        "above": 100,
        "holdSeconds": 60,
        "process": "core-approval",
    },
)


class FakeScorpio:
    def __init__(self, history: list[Sample]):
        self.history_samples = history
        self.writes: list[tuple[str, dict]] = []

    def upsert(self, tenant, entity):
        self.writes.append((tenant, entity))

    def history(self, tenant, entity_id, attribute, last):
        return list(self.history_samples)


class FakeCases:
    def __init__(self, fail: bool = False):
        self.opened: list[tuple[str, str, str, dict]] = []
        self.fail = fail

    def open(self, tenant, process, key, variables):
        if self.fail:
            raise CaseError("giả lập lỗi")
        self.opened.append((tenant, process, key, variables))
        return "p1"


def message(value: float, at: datetime) -> bytes:
    return json.dumps(
        {"observedAt": at.isoformat().replace("+00:00", "Z"), "measurements": {"testLevel": value}}
    ).encode()


def bridge(history: list[Sample], cases: FakeCases, rules=None) -> tuple[Bridge, FakeScorpio]:
    scorpio = FakeScorpio(history)
    cache = RuleCache(rules or (lambda tenant: [RULE] if tenant == "xa-a" else []))
    return Bridge(TenantCheck(lambda tenant: True), scorpio, Watcher(cache, scorpio, cases, 200)), scorpio


def test_held_breach_opens_case_for_tenant_of_topic():
    cases = FakeCases()
    history = [Sample(T0, 150)]
    b, _ = bridge(history, cases)
    assert b.handle("mortise/xa-a/archive-01", message(160, T0 + timedelta(seconds=90)))
    [(tenant, process, _, variables)] = cases.opened
    assert (tenant, process, variables["device"], variables["value"]) == (
        "xa-a",
        "core-approval",
        "archive-01",
        160,
    )


def test_latest_reading_counts_even_if_history_lags():
    cases = FakeCases()
    b, _ = bridge([Sample(T0, 150)], cases)
    b.handle("mortise/xa-a/archive-01", message(160, T0 + timedelta(seconds=30)))
    assert cases.opened == []
    b, _ = bridge([Sample(T0, 150)], cases)
    b.handle("mortise/xa-a/archive-01", message(160, T0 + timedelta(seconds=60)))
    assert len(cases.opened) == 1


def test_other_tenant_has_no_rule():
    cases = FakeCases()
    b, _ = bridge([Sample(T0, 150)], cases)
    b.handle("mortise/xa-b/archive-01", message(160, T0 + timedelta(seconds=90)))
    assert cases.opened == []


def test_failure_to_open_case_keeps_the_reading():
    b, scorpio = bridge([Sample(T0, 150)], FakeCases(fail=True))
    assert b.handle("mortise/xa-a/archive-01", message(160, T0 + timedelta(seconds=90)))
    assert len(scorpio.writes) == 1


def test_rule_database_error_keeps_the_reading():
    def broken(_tenant):
        raise OSError("connection refused")

    cases = FakeCases()
    b, scorpio = bridge([Sample(T0, 150)], cases, rules=broken)
    assert b.handle("mortise/xa-a/archive-01", message(160, T0 + timedelta(seconds=90)))
    assert len(scorpio.writes) == 1 and cases.opened == []


def test_cases_reuses_token_until_close_to_expiry():
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": f"t{len(calls)}", "expires_in": 300})
        assert request.headers["X-Mortise-Tenant"] == "xa-a"
        return httpx.Response(201, json={"id": "p1", "process": "core-approval"})

    now = [0.0]
    cases = Cases(
        "http://kc/token",
        "mortise-iot-bridge",
        "s",
        "http://wf",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        clock=lambda: now[0],
    )
    cases.open("xa-a", "core-approval", "k" * 10, {})
    cases.open("xa-a", "core-approval", "k" * 10, {})
    now[0] = 280
    cases.open("xa-a", "core-approval", "k" * 10, {})
    assert [path.rsplit("/", 1)[-1] for path in calls] == [
        "token",
        "instances",
        "instances",
        "token",
        "instances",
    ]


def test_cases_reports_rejected_secret():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "unauthorized_client"})

    cases = Cases(
        "http://kc/token",
        "x",
        "sai",
        "http://wf",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    try:
        cases.open("xa-a", "core-approval", "k" * 10, {})
    except CaseError as error:
        assert "IOT_BRIDGE_CLIENT_SECRET" in str(error)
    else:
        raise AssertionError("phải báo lỗi")


def test_recent_readings_count_while_history_lags():
    # Lịch sử của Scorpio chưa có lần đo nào: hai lần đo vượt cách nhau đủ lâu vẫn mở hồ sơ ở lần thứ hai.
    cases = FakeCases()
    b, _ = bridge([], cases)
    b.handle("mortise/xa-a/archive-01", message(150, T0))
    assert cases.opened == []
    b.handle("mortise/xa-a/archive-01", message(151, T0 + timedelta(seconds=60)))
    assert len(cases.opened) == 1


def test_recent_normal_reading_breaks_the_run():
    # Lịch sử còn thấy chuỗi vượt cũ, nhưng lần đo bình thường vừa ghi (chưa vào lịch sử) đã cắt chuỗi.
    cases = FakeCases()
    b, _ = bridge([Sample(T0, 150), Sample(T0 + timedelta(seconds=30), 150)], cases)
    b.handle("mortise/xa-a/archive-01", message(50, T0 + timedelta(seconds=60)))
    b.handle("mortise/xa-a/archive-01", message(160, T0 + timedelta(seconds=90)))
    assert cases.opened == []
