# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử prompt viết câu truy vấn (ADR 0034): tin nhắn người dùng mang cột, mô tả, quan hệ, max_rows và câu
# mẫu của mục; tenant_id không bao giờ có mặt kể cả khi cấu hình khai; prompt hệ thống giống nhau với mọi cấu
# hình và nêu đúng toán tử, tham số mà guard nhận; câu trả lời sai dạng là 502.

import copy

import pytest

from app import data_model, guard
from app.errors import Denied
from app.model import MALFORMED
from tests.test_data_routes import CONFIG

DATA = copy.deepcopy(CONFIG["data"])
DATA["sources"][0]["aggregate"] = True
DATA["sources"][0]["columns"].append(
    {"name": "tenant_id", "label": "Đơn vị", "description": "Mã đơn vị sở hữu"}
)
DATA["examples"] = [
    {
        "id": "a",
        "question": "Có văn bản nào?",
        "query": "{ platform_knowledge_documents(limit: 3) { title } }",
    }
]


def user(data: dict = DATA, question: str = "Có bao nhiêu văn bản?") -> str:
    messages = data_model.messages(data, guard.allowlist(data).max_rows, question)
    assert messages[0] == {"role": "system", "content": data_model.SYSTEM}
    return messages[1]["content"]


def test_user_message_describes_sources_columns_relations_limit_and_examples():
    text = user()
    assert "- platform_knowledge_documents (Văn bản): Văn bản đã nạp" in text
    assert "    title: Tên" in text
    assert "    document -> platform_knowledge_documents (Văn bản)" in text
    assert "Có tổng hợp: platform_knowledge_documents_aggregate." in text
    assert "platform_knowledge_passages_aggregate không dùng được" in text
    assert "Số dòng tối đa mỗi danh sách (limit): 20." in text
    assert (
        "Câu hỏi: Có văn bản nào?\nCâu truy vấn:\n{ platform_knowledge_documents(limit: 3) { title } }"
        in text
    )
    assert text.endswith("===== CÂU HỎI =====\nCó bao nhiêu văn bản?\n===== HẾT CÂU HỎI =====")


def test_tenant_column_never_reaches_the_model():
    assert "tenant_id" not in user()
    assert "Mã đơn vị sở hữu" not in user()
    assert "tenant_id" not in data_model.SYSTEM


def test_max_rows_is_the_clamped_limit_of_the_guard():
    assert "(limit): 100." in user(DATA | {"max_rows": 5000})


def test_system_prompt_is_the_same_for_every_config_and_names_the_guard_rules():
    other = {"max_rows": 3, "sources": [{"field": "x_y", "label": "X", "description": "d", "columns": []}]}
    first = data_model.messages(DATA, 20, "a")[0]
    assert data_model.messages(other, 3, "b")[0] == first
    for operator in guard.OPERATORS | guard.TABLE_ARGUMENTS | set(guard.AGGREGATES):
        assert operator in data_model.SYSTEM
    assert "_by_pk" in data_model.SYSTEM


def test_missing_optional_descriptions_do_not_break_the_prompt():
    data = {
        "max_rows": 5,
        "sources": [{"field": "a_b", "label": "B", "columns": [{"name": "c", "label": "Cột C"}]}],
    }
    assert "    c: Cột C" in user(data)


def test_repair_keeps_the_conversation_and_adds_the_guard_reason():
    first = data_model.messages(DATA, 20, "a")
    turn = data_model.repair(first, '{"query": "mutation { x }"}', "Chỉ chạy câu đọc dữ liệu (query).")
    assert turn[:2] == first
    assert turn[2] == {"role": "assistant", "content": '{"query": "mutation { x }"}'}
    assert "«Chỉ chạy câu đọc dữ liệu (query).»" in turn[3]["content"]


@pytest.mark.parametrize(
    "content",
    [
        None,
        "không phải JSON",
        '{"answerable": true, "query": "{ a }"}',
        '{"answerable": "yes", "query": "", "reason": ""}',
    ],
    ids=["none", "not-json", "missing-reason", "wrong-type"],
)
def test_malformed_reply_is_a_502(content):
    with pytest.raises(Denied) as raised:
        data_model.parse(content, "Mô hình")
    assert (raised.value.status, raised.value.reason) == (502, MALFORMED)


def test_broken_examples_in_the_stored_config_are_skipped():
    data = DATA | {"examples": [{"id": "x"}, "không phải câu mẫu", DATA["examples"][0]]}
    text = user(data)
    assert text.count("Câu hỏi: ") == 1
