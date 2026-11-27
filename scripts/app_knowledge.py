# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Phần văn bản của bộ cài gói (ADR 0021): kiểm các luật nhiều tệp mà contracts/knowledge.schema.json và
# contracts/assistant.schema.json không diễn đạt được, rồi dựng dòng cho platform.knowledge_documents và
# platform.knowledge_passages. scripts/app-deploy.py gọi các hàm này và chạy SQL; ở đây không gọi CSDL, nên
# kiểm thử được mà không cần lõi.

import os

import yaml
from app_entries import entries

# Ghi văn bản của một chủ sở hữu (gói, hay `core`) cho mọi tenant. Văn bản và đoạn không còn trong tệp bị
# xóa, để chạy lại sau khi sửa tệp cho kết quả như trên dữ liệu trắng; dòng không đổi thì không ghi, để nhật
# ký thay đổi (ADR 0009) chỉ có thay đổi thật.
SQL = """
BEGIN;
CREATE TEMP TABLE doc ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(:'documents'::jsonb)
    AS x(document_id text, title text, source_url text, source_sha256 text, retrieved date);
CREATE TEMP TABLE passage ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(:'passages'::jsonb)
    AS x(document_id text, passage_id text, position integer, label text, text text,
         superseded_by_document text, superseded_by_passage text);
DELETE FROM platform.knowledge_passages p WHERE p.app = :'app'
    AND (p.document_id, p.passage_id) NOT IN (SELECT document_id, passage_id FROM passage);
DELETE FROM platform.knowledge_documents d WHERE d.app = :'app'
    AND d.document_id NOT IN (SELECT document_id FROM doc);
INSERT INTO platform.knowledge_documents AS k
    (tenant_id, app, document_id, title, source_url, source_sha256, retrieved)
SELECT t.id, :'app', d.document_id, d.title, d.source_url, d.source_sha256, d.retrieved
FROM core.tenants t, doc d
ON CONFLICT (tenant_id, app, document_id) DO UPDATE
    SET title = EXCLUDED.title, source_url = EXCLUDED.source_url, source_sha256 = EXCLUDED.source_sha256,
    retrieved = EXCLUDED.retrieved, updated_at = now()
    WHERE (k.title, k.source_url, k.source_sha256, k.retrieved)
        IS DISTINCT FROM (EXCLUDED.title, EXCLUDED.source_url, EXCLUDED.source_sha256, EXCLUDED.retrieved);
INSERT INTO platform.knowledge_passages AS k (tenant_id, app, document_id, passage_id, position, label, text,
    superseded_by_document, superseded_by_passage)
SELECT t.id, :'app', p.document_id, p.passage_id, p.position, p.label, p.text,
    p.superseded_by_document, p.superseded_by_passage
FROM core.tenants t, passage p
ON CONFLICT (tenant_id, app, document_id, passage_id) DO UPDATE
    SET position = EXCLUDED.position, label = EXCLUDED.label, text = EXCLUDED.text,
    superseded_by_document = EXCLUDED.superseded_by_document,
    superseded_by_passage = EXCLUDED.superseded_by_passage, updated_at = now()
    WHERE (k.position, k.label, k.text, k.superseded_by_document, k.superseded_by_passage)
        IS DISTINCT FROM (EXCLUDED.position, EXCLUDED.label, EXCLUDED.text, EXCLUDED.superseded_by_document,
                          EXCLUDED.superseded_by_passage);
COMMIT;
"""


def problems(documents: list[dict]) -> list[str]:
    """Mã văn bản trùng, mã đoạn trùng, `superseded_by` trỏ tới đoạn không có."""
    found, passages = [], {}
    for document in documents:
        if document["id"] in passages:
            found.append(f"văn bản {document['id']} khai ở hai tệp")
        ids = [passage["id"] for passage in document["passages"]]
        if len(ids) != len(set(ids)):
            found.append(f"văn bản {document['id']} có mã đoạn trùng")
        passages[document["id"]] = set(ids)
    for document in documents:
        for passage in document["passages"]:
            target = passage.get("superseded_by")
            # Đoạn thay thế không có thì trợ lý bỏ đoạn cũ mà không còn đoạn nào nói điều đó.
            if target and target["passage"] not in passages.get(target["document"], set()):
                found.append(
                    f"{document['id']}/{passage['id']}: superseded_by trỏ tới "
                    f"{target['document']}/{target['passage']}, đoạn này không có"
                )
    return found


def menu_problems(directory: str, app: dict, known: set[str]) -> list[str]:
    """Mục menu `assistant` hỏi văn bản không có trong `known` (mã văn bản gói khai ở `knowledge`).

    Mục hỏi dữ liệu (`data`, ADR 0027) không hỏi văn bản nào; scripts/check-assistant-data.py kiểm mục đó."""
    found = []
    for entry in assistant_configs(directory, app):
        if "documents" not in entry["content"]:
            continue
        missing = set(entry["content"]["documents"]) - known
        # Thiếu văn bản thì mọi câu hỏi ở mục này đều bị từ chối mà không ai biết vì sao.
        if missing:
            names = ", ".join(sorted(missing))
            found.append(f"mục menu {entry['id']} hỏi văn bản không có trong knowledge: {names}")
    return found


def assistant_configs(directory: str, app: dict) -> list[dict]:
    """Mục menu `assistant` của gói, kèm nội dung tệp cấu hình (`content`) và đường dẫn tệp (`path`)."""
    found = []
    for entry in entries(app):
        if entry["component"] == "assistant":
            path = os.path.join(directory, entry["config"])
            with open(path, encoding="utf-8") as file:
                found.append(entry | {"path": path, "content": yaml.safe_load(file)})
    return found


def rows(documents: list[dict]) -> tuple[list[dict], list[dict]]:
    """Dòng văn bản và dòng đoạn, đúng tên cột của hai bảng; vị trí là thứ tự đoạn trong tệp."""
    document_rows = [
        {
            "document_id": document["id"],
            "title": document["title"],
            "source_url": document["source"]["url"],
            "source_sha256": document["source"]["sha256"],
            # YAML đọc ngày không đặt trong ngoặc kép thành kiểu date, json.dumps không chuyển được kiểu đó.
            "retrieved": str(document["source"]["retrieved"]),
        }
        for document in documents
    ]
    passage_rows = [
        {
            "document_id": document["id"],
            "passage_id": passage["id"],
            "position": position,
            "label": passage["label"],
            "text": passage["text"],
            "superseded_by_document": passage.get("superseded_by", {}).get("document"),
            "superseded_by_passage": passage.get("superseded_by", {}).get("passage"),
        }
        for document in documents
        for position, passage in enumerate(document["passages"])
    ]
    return document_rows, passage_rows
