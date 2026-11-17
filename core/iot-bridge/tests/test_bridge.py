# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử vòng xử lý tin với CSDL và Scorpio giả: tin hỏng không làm dừng cầu nối, tenant không có thật hay
# CSDL lỗi thì không ghi, và tenant ghi vào Scorpio là tenant của chủ đề.

import json

from app.main import Bridge
from app.scorpio import Unavailable
from app.tenants import UNKNOWN_SECONDS, TenantCheck


class FakeScorpio:
    def __init__(self, fail: bool = False):
        self.writes: list[tuple[str, dict]] = []
        self.fail = fail

    def upsert(self, tenant, entity):
        if self.fail:
            raise Unavailable("giả lập lỗi")
        self.writes.append((tenant, entity))


def good(value: float = 70) -> bytes:
    return json.dumps({"measurements": {"humidity": value}}).encode()


def test_garbage_then_valid_message_is_still_written():
    scorpio = FakeScorpio()
    bridge = Bridge(TenantCheck(lambda tenant: True), scorpio)
    assert bridge.handle("mortise/xuong-a/archive-01", b"\x00garbage") is False
    assert bridge.handle("mortise/xuong-a/archive-01", good()) is True
    assert [tenant for tenant, _ in scorpio.writes] == ["xuong-a"]


def test_unknown_tenant_is_not_written():
    scorpio = FakeScorpio()
    bridge = Bridge(TenantCheck(lambda tenant: tenant == "xuong-a"), scorpio)
    assert bridge.handle("mortise/khong-co/archive-01", good()) is False
    assert scorpio.writes == []


def test_database_error_fails_closed():
    def broken(_tenant):
        raise OSError("connection refused")

    scorpio = FakeScorpio()
    assert Bridge(TenantCheck(broken), scorpio).handle("mortise/xuong-a/archive-01", good()) is False
    assert scorpio.writes == []


def test_scorpio_error_does_not_escape():
    bridge = Bridge(TenantCheck(lambda tenant: True), FakeScorpio(fail=True))
    assert bridge.handle("mortise/xuong-a/archive-01", good()) is False


def test_new_tenant_is_seen_shortly_after_it_is_created():
    # Cầu nối chạy trước `make seed`: tenant chưa có lúc đầu không bị nhớ là "không có" quá lâu.
    now = [0.0]
    created = {"xuong-a": False}
    check = TenantCheck(lambda tenant: created[tenant], clock=lambda: now[0])
    assert check.exists("xuong-a") is False
    created["xuong-a"] = True
    assert check.exists("xuong-a") is False
    now[0] += UNKNOWN_SECONDS + 1
    assert check.exists("xuong-a") is True
