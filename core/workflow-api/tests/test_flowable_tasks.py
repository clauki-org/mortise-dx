# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử truy vấn task của flowable.py: đọc hết các trang thay vì chỉ trang đầu, và ghi cảnh báo khi chạm
# trần số trang. HTTP tới Flowable được thay bằng bản giả.

import logging

import httpx
import pytest

from app import flowable


def fake_flowable(monkeypatch, total: int) -> list[dict]:
    """Flowable giả có `total` task; trả danh sách thân các truy vấn đã gửi."""
    sent: list[dict] = []

    def call(_method, _path, json):
        sent.append(json)
        start, size = json["start"], json["size"]
        data = [{"id": f"t{i}"} for i in range(start, min(start + size, total))]
        return httpx.Response(200, json={"data": data, "total": total})

    monkeypatch.setattr(flowable, "_call", call)
    return sent


def test_reads_every_page(monkeypatch):
    sent = fake_flowable(monkeypatch, 450)
    found = flowable.tasks(None, groups=["tinh-mau/manager"])
    assert len(found) == 450
    assert [body["start"] for body in sent] == [0, 200, 400]
    assert all(body["sort"] == "id" and "tenantId" not in body for body in sent)


def test_single_page_is_one_request(monkeypatch):
    sent = fake_flowable(monkeypatch, 3)
    assert len(flowable.tasks("xa-a", assignee="m-a")) == 3
    assert len(sent) == 1
    assert sent[0]["tenantId"] == "xa-a"


def test_warns_when_the_page_limit_is_reached(monkeypatch, caplog):
    monkeypatch.setattr(flowable, "MAX_PAGES", 2)
    fake_flowable(monkeypatch, 450)
    with caplog.at_level(logging.WARNING, logger="workflow-api.flowable"):
        found = flowable.tasks(None, groups=["tinh-mau/manager"])
    assert len(found) == 400
    assert "450" in caplog.text


@pytest.mark.parametrize("total", [0, 200])
def test_stops_at_the_reported_total(monkeypatch, total):
    sent = fake_flowable(monkeypatch, total)
    assert len(flowable.tasks("xa-a")) == total
    assert len(sent) == 1
