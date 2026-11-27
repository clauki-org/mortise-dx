-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Niêm phong hồ sơ và hạn của bước chờ (ADR 0053). workflow-api ghi một dòng core.case_seals khi hồ sơ của quy trình
-- khai `mortise:seal="true"` kết thúc: chỉ mã hồ sơ, tenant, quy trình và băm SHA-256 của bản JSON chuẩn, không có
-- dữ liệu nghiệp vụ. workflow-api ghi một dòng core.case_deadlines khi hồ sơ vào một bước chờ hẹn giờ, để gói biết
-- hạn của bước đó mà không phải hỏi Flowable. Cả hai bảng chỉ thêm và gắn nhật ký (ADR 0009): dòng niêm phong vào
-- chuỗi băm của nhật ký, nên sửa lén băm niêm phong cũng lộ ra khi so với nhật ký (core.case_seals_unlogged).

-- migrate:up
-- Không đặt khóa ngoại tới core.tenants, như core.audit_log: bảng chỉ thêm nên ON DELETE CASCADE sẽ bị chặn, và xóa
-- tenant thì dấu niêm phong của nó vẫn phải còn.
CREATE TABLE core.case_seals (
    -- Mã hồ sơ (process instance) trong Flowable.
    case_id      text PRIMARY KEY,
    tenant_id    text NOT NULL,
    process      text NOT NULL,
    -- Phiên bản cách dựng bản JSON chuẩn (core/workflow-api/app/seal.py); đổi cách dựng thì tăng, không sửa băm cũ.
    hash_version smallint NOT NULL,
    hash         bytea NOT NULL CHECK (octet_length(hash) = 32),
    sealed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.case_deadlines (
    case_id     text NOT NULL,
    tenant_id   text NOT NULL,
    process     text NOT NULL,
    -- id của bước chờ (intermediateCatchEvent) trong BPMN.
    activity_id text NOT NULL,
    due_at      timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    -- Hồ sơ quay lại cùng bước chờ thì có hạn mới, thành dòng mới; ghi lại cùng hạn (sau khi lập hồ sơ và khi bù)
    -- thì trùng khóa và workflow-api bỏ qua.
    PRIMARY KEY (case_id, activity_id, due_at)
);
CREATE INDEX case_deadlines_tenant ON core.case_deadlines (tenant_id, case_id);

-- Chỉ thêm: sửa hay xóa dòng niêm phong là xóa dấu vết; sửa hạn là kéo dài cửa sổ của bước chờ.
CREATE TRIGGER case_seals_append_only BEFORE UPDATE OR DELETE ON core.case_seals
    FOR EACH ROW EXECUTE FUNCTION core.audit_refuse();
CREATE TRIGGER case_deadlines_append_only BEFORE UPDATE OR DELETE ON core.case_deadlines
    FOR EACH ROW EXECUTE FUNCTION core.audit_refuse();
SELECT core.audit_attach('core.case_seals');
SELECT core.audit_attach('core.case_deadlines');

-- Dòng niêm phong khác dòng INSERT của chính nó trong nhật ký. Người tắt được trigger sửa được băm trong
-- core.case_seals mà chuỗi băm của nhật ký vẫn khớp, vì nhật ký không đổi; so hai nơi thì thấy. Dòng nhật ký đã
-- chuyển sang kho lạnh (ADR 0014) không còn ở đây để so, nên bỏ qua.
CREATE FUNCTION core.case_seals_unlogged()
RETURNS TABLE (case_id text, problem text)
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
    SELECT s.case_id, 'băm niêm phong khác băm ghi trong nhật ký lúc niêm phong'
    FROM core.case_seals s
    JOIN core.audit_log l ON l.table_name = 'core.case_seals' AND l.op = 'INSERT'
        AND l.row_key ->> 'case_id' = s.case_id
    WHERE l.after ->> 'hash' IS DISTINCT FROM '\x' || encode(s.hash, 'hex')
       OR l.after ->> 'tenant_id' IS DISTINCT FROM s.tenant_id
    ORDER BY 1
$$;

-- workflow-api chỉ thêm và đọc; quyền SELECT để biết hồ sơ đã niêm phong chưa và để `make seal-verify` đọc băm. Cấp ở
-- đây, không ở core/postgres/roles.sh: script đó chạy trước migration, khi bảng chưa có.
GRANT SELECT, INSERT ON core.case_seals, core.case_deadlines TO workflow_api;

-- migrate:down
REVOKE SELECT, INSERT ON core.case_seals, core.case_deadlines FROM workflow_api;
DROP FUNCTION core.case_seals_unlogged();
SELECT core.audit_detach('core.case_deadlines');
SELECT core.audit_detach('core.case_seals');
DROP TABLE core.case_deadlines;
DROP TABLE core.case_seals;
