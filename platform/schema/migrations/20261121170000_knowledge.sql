-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Văn bản cho trợ lý hỏi văn bản (ADR 0021, contracts/knowledge.schema.json): mỗi văn bản một dòng, mỗi đoạn một dòng,
-- chép cho từng tenant. Bộ cài gói (scripts/app-deploy.py) ghi và xóa theo mục `knowledge` của app.yaml; `make seed`
-- nạp văn bản mẫu của lõi. Trợ lý đọc qua GraphQL bằng token người hỏi, nên Hasura lọc theo tenant trước khi tìm.
-- Người dùng không sửa.

-- migrate:up
CREATE TABLE platform.knowledge_documents (
    tenant_id     text NOT NULL REFERENCES core.tenants (id) ON DELETE CASCADE,
    -- Gói sở hữu văn bản (id trong app.yaml), hay `core` cho văn bản mẫu của lõi; gỡ gói thì xóa theo cột này.
    app           text NOT NULL,
    document_id   text NOT NULL,
    title         text NOT NULL,
    -- Bản gốc mà các đoạn được chép từ đó, để người đọc tự đối chiếu câu trích.
    source_url    text NOT NULL,
    source_sha256 text NOT NULL,
    retrieved     date NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, app, document_id)
);

CREATE TABLE platform.knowledge_passages (
    tenant_id   text NOT NULL,
    app         text NOT NULL,
    document_id text NOT NULL,
    passage_id  text NOT NULL,
    -- Thứ tự trong tệp, để hiện các đoạn theo đúng thứ tự của văn bản.
    position    integer NOT NULL,
    label       text NOT NULL,
    text        text NOT NULL,
    -- Đoạn đã bị thay thế trỏ tới đoạn thay nó; trợ lý không tìm trong đoạn này. Hai cột cùng có hoặc cùng trống.
    superseded_by_document text,
    superseded_by_passage  text,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, app, document_id, passage_id),
    FOREIGN KEY (tenant_id, app, document_id)
        REFERENCES platform.knowledge_documents (tenant_id, app, document_id) ON DELETE CASCADE,
    CHECK ((superseded_by_document IS NULL) = (superseded_by_passage IS NULL))
);

-- Đổi văn bản là đổi điều trợ lý được trích làm căn cứ, nên có nhật ký như menu và khai báo bước (ADR 0009).
SELECT core.audit_attach('platform.knowledge_documents');
SELECT core.audit_attach('platform.knowledge_passages');

-- migrate:down
SELECT core.audit_detach('platform.knowledge_passages');
SELECT core.audit_detach('platform.knowledge_documents');
DROP TABLE platform.knowledge_passages;
DROP TABLE platform.knowledge_documents;
