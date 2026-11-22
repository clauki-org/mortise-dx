-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Bảng phân cấp thẩm quyền (ADR 0028): bước nào của quy trình tới vai trò nào, theo tenant và theo mức của hồ sơ.
-- Bộ cài gói (scripts/app-deploy.py) và `make seed` (dòng mẫu của lõi) chỉ thêm dòng chưa có; tenant_admin của tenant
-- cha sửa vai trò và ngưỡng của tenant con qua Hasura (core/hasura/tables.yaml); workflow-api đọc lúc khởi tạo bằng
-- vai trò CSDL workflow_api, do core/postgres/roles.sh tạo trước migration.

-- migrate:up
CREATE TABLE core.step_authorities (
    tenant_id  text NOT NULL REFERENCES core.tenants (id) ON DELETE CASCADE,
    -- Gói sở hữu dòng (id trong app.yaml), hay `core` cho dòng mẫu của lõi; gỡ gói thì xóa theo cột này. Không nằm
    -- trong khóa: khóa quy trình đã duy nhất trên lõi và mọi gói (`make check-fast`), nên workflow-api tra theo
    -- (tenant, quy trình, bước) mà không cần biết gói.
    app        text NOT NULL,
    process    text NOT NULL,
    step       text NOT NULL,
    -- Mã dòng do gói khai, ổn định: cài lại nhận ra dòng đã có theo mã này và không ghi đè dòng đã sửa.
    rule       text NOT NULL,
    variable   text,
    above      numeric,
    role       text NOT NULL,
    scope      text NOT NULL DEFAULT 'tenant',
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, process, step, rule),
    -- Vai trò thành nhóm ứng viên của Flowable, nơi dấu phẩy tách nhiều nhóm và dấu / tách tenant cha với vai trò
    -- (dòng scope parent); cho các ký tự đó thì một dòng mở việc cho nhóm ngoài ý người sửa. Tiền tố authority_ là
    -- của biến lõi đặt, không phải vai trò.
    CONSTRAINT step_authorities_role CHECK (role ~ '^[a-z][a-z0-9_]*(-[a-z0-9_]+)*$' AND role !~ '^authority_'),
    CONSTRAINT step_authorities_scope CHECK (scope IN ('tenant', 'parent')),
    -- Dòng gốc không so biến nào; dòng khác có cả biến lẫn ngưỡng. Nhờ vậy sửa `above` qua Hasura không biến được dòng
    -- gốc thành dòng ngưỡng hay ngược lại: người sửa không ghi được cột variable.
    CONSTRAINT step_authorities_threshold CHECK ((above IS NULL) = (variable IS NULL)),
    -- Trần hữu hạn: numeric nhận NaN (lớn hơn mọi số trong PostgreSQL, nên điều kiện < cũng loại nó) và số vượt
    -- float8, mà workflow-api đọc ngưỡng dưới dạng float8.
    CONSTRAINT step_authorities_above CHECK (above >= 0 AND above < 1e15),
    CONSTRAINT step_authorities_variable CHECK (variable ~ '^[A-Za-z_][A-Za-z0-9_]*$'),
    -- Dòng gốc là chỗ dựa cuối cùng của bước; ở tenant cha thì tenant không có cha không còn dòng nào áp được.
    CONSTRAINT step_authorities_root_in_tenant CHECK (above IS NOT NULL OR scope = 'tenant')
);

-- Một dòng gốc cho mỗi bước: hai dòng gốc thì workflow-api không biết chọn dòng nào khi hồ sơ không vượt ngưỡng nào.
CREATE UNIQUE INDEX step_authorities_one_root ON core.step_authorities (tenant_id, process, step)
    WHERE above IS NULL;

-- Còn dòng nào của một bước thì phải còn dòng gốc: thiếu nó, hồ sơ không vượt ngưỡng nào không có ai nhận. Không chặn
-- hẳn việc xóa dòng gốc, vì gỡ gói (xóa theo app) và xóa tenant (ON DELETE CASCADE) xóa mọi dòng của bước cùng lúc.
-- Kiểm lúc commit (DEFERRABLE INITIALLY DEFERRED) để bộ cài thêm dòng gốc và dòng ngưỡng theo thứ tự nào cũng được.
CREATE FUNCTION core.step_authorities_keep_root() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    changed record;
BEGIN
    FOR changed IN
        SELECT OLD.tenant_id, OLD.process, OLD.step WHERE TG_OP <> 'INSERT'
        UNION SELECT NEW.tenant_id, NEW.process, NEW.step WHERE TG_OP <> 'DELETE'
    LOOP
        IF EXISTS (SELECT FROM core.step_authorities a WHERE (a.tenant_id, a.process, a.step)
                = (changed.tenant_id, changed.process, changed.step))
            AND NOT EXISTS (SELECT FROM core.step_authorities a WHERE (a.tenant_id, a.process, a.step)
                = (changed.tenant_id, changed.process, changed.step) AND a.above IS NULL) THEN
            RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = format(
                'Bước %s của quy trình %s ở tenant %s phải còn dòng gốc (không có above) khi còn dòng khác; '
                'thêm lại dòng gốc hoặc xóa mọi dòng của bước (ADR 0028)',
                changed.step, changed.process, changed.tenant_id);
        END IF;
    END LOOP;
    RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER step_authorities_keep_root
    AFTER INSERT OR UPDATE OR DELETE ON core.step_authorities
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION core.step_authorities_keep_root();

-- Hasura ghi đè được cột nhưng không đặt được giờ của máy chủ; không có trigger này thì dòng tenant cha vừa sửa vẫn
-- mang giờ lúc cài.
CREATE FUNCTION core.step_authorities_touch() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END
$$;

CREATE TRIGGER step_authorities_touch BEFORE UPDATE ON core.step_authorities
    FOR EACH ROW EXECUTE FUNCTION core.step_authorities_touch();

-- Đổi bảng là đổi ai duyệt hồ sơ, nên có nhật ký ai sửa dòng nào, trước và sau (ADR 0009).
SELECT core.audit_attach('core.step_authorities');

-- workflow-api chỉ đọc: dòng của bước và tenant cha để ghép nhóm của dòng scope parent.
GRANT USAGE ON SCHEMA core TO workflow_api;
GRANT SELECT ON core.step_authorities, core.tenants TO workflow_api;

-- migrate:down
REVOKE SELECT ON core.step_authorities, core.tenants FROM workflow_api;
REVOKE USAGE ON SCHEMA core FROM workflow_api;
SELECT core.audit_detach('core.step_authorities');
DROP TABLE core.step_authorities;
DROP FUNCTION core.step_authorities_touch();
DROP FUNCTION core.step_authorities_keep_root();
