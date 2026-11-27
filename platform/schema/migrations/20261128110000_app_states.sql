-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Bật, tắt gói theo org (ADR 0065). platform.apps là danh sách gói đã cài (tên, mô tả, gói cần), do bộ cài gói
-- (scripts/app-deploy.py) ghi; platform.app_states là lựa chọn của quản trị org (tenant_admin của tenant không có
-- cha), một dòng mỗi gói đã tắt hay bật lại. Không có dòng là đang bật, nên gói vừa cài và mục mẫu của lõi (không có
-- trong platform.apps) luôn hiện. Tắt gói không xóa dữ liệu: quyền đọc menu_items của Hasura bỏ mục của gói tắt, nên
-- menu, trang chủ và khối của gói biến mất ở mọi tenant cùng gốc. Quyền đọc, ghi ở platform/schema/hasura/tables.yaml.

-- migrate:up

CREATE TABLE platform.apps (
    -- Mã gói (id trong app.yaml), cũng là platform.menu_items.app.
    app         text PRIMARY KEY,
    name        text NOT NULL,
    description text,
    -- Gói phải được cài và đang bật thì gói này mới chạy đúng (`requires` trong app.yaml).
    requires    text[] NOT NULL DEFAULT '{}',
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.app_states (
    -- Tenant gốc của org; mọi tenant con theo lựa chọn này (platform.tenant_roots).
    root_tenant_id text NOT NULL REFERENCES core.tenants (id) ON DELETE CASCADE,
    -- Gỡ gói thì lựa chọn đi theo; cài lại (bộ cài chỉ sửa dòng platform.apps, không xóa) thì giữ.
    app            text NOT NULL REFERENCES platform.apps (app) ON DELETE CASCADE,
    enabled        boolean NOT NULL,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (root_tenant_id, app)
);

-- Gói đang bật của một tenant gốc: đã cài và không có dòng tắt.
CREATE FUNCTION platform.app_enabled(root text, package text) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (SELECT FROM platform.apps a WHERE a.app = package)
       AND NOT EXISTS (SELECT FROM platform.app_states s
                       WHERE s.root_tenant_id = root AND s.app = package AND NOT s.enabled)
$$;

-- Kiểm mỗi lần ghi, kể cả đường ghi khác Hasura: chỉ tenant gốc, chỉ sửa được enabled, không tắt gói mà gói đang bật
-- khác cần, không bật gói khi gói nó cần chưa cài hay đang tắt. Chặn cả hai chiều: chỉ chặn chiều tắt thì tắt Y, tắt
-- X, bật lại Y vẫn để Y chạy thiếu X.
CREATE FUNCTION platform.app_states_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    needed text;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.root_tenant_id, NEW.app) IS DISTINCT FROM (OLD.root_tenant_id, OLD.app) THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE =
            'Trạng thái gói: chỉ sửa được bật, tắt (ADR 0065)';
    END IF;
    IF EXISTS (SELECT FROM core.tenants t WHERE t.id = NEW.root_tenant_id AND t.parent_id IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = format(
            'Tenant %s có tenant cha: chỉ tenant gốc của org bật, tắt được gói (ADR 0065)', NEW.root_tenant_id);
    END IF;
    -- Trigger chạy trước khóa ngoại: không kiểm ở đây thì gói chưa cài nhận lời báo về gói cần nó, khó hiểu.
    IF NOT EXISTS (SELECT FROM platform.apps a WHERE a.app = NEW.app) THEN
        RAISE EXCEPTION USING ERRCODE = 'foreign_key_violation', MESSAGE = format(
            'Gói %s chưa cài: không có trong platform.apps', NEW.app);
    END IF;
    IF NOT NEW.enabled THEN
        SELECT string_agg(format('%s (%s)', a.name, a.app), ', ' ORDER BY a.app) INTO needed
        FROM platform.apps a
        WHERE NEW.app = ANY (a.requires) AND a.app <> NEW.app AND platform.app_enabled(NEW.root_tenant_id, a.app);
        IF needed IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = format(
                'Không tắt được gói %s: gói đang bật %s cần gói này; tắt các gói đó trước', NEW.app, needed);
        END IF;
    ELSE
        SELECT string_agg(r, ', ' ORDER BY r) INTO needed
        FROM platform.apps a, unnest(a.requires) r
        WHERE a.app = NEW.app AND NOT platform.app_enabled(NEW.root_tenant_id, r);
        IF needed IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = format(
                'Không bật được gói %s: gói này cần %s, chưa cài hay đang tắt; bật các gói đó trước', NEW.app, needed);
        END IF;
    END IF;
    -- Hasura ghi được cột nhưng không đặt được giờ của máy chủ.
    NEW.updated_at := now();
    RETURN NEW;
END
$$;

CREATE TRIGGER app_states_guard BEFORE INSERT OR UPDATE ON platform.app_states
    FOR EACH ROW EXECUTE FUNCTION platform.app_states_guard();

-- Tắt, bật gói đổi điều mọi tenant con thấy, nên có nhật ký (ADR 0009).
SELECT core.audit_attach('platform.app_states', 'root_tenant_id');

-- Gói mà mỗi tenant thấy trên trang "Ứng dụng": mọi gói đã cài, với trạng thái của tenant gốc của nó. Quyền đọc lọc
-- theo tenant_id của view bằng tenant trong token.
CREATE VIEW platform.apps_by_tenant AS
SELECT r.tenant_id, r.root_tenant_id, a.app, a.name, a.description, a.requires,
       coalesce(s.enabled, true) AS enabled
FROM platform.tenant_roots r
CROSS JOIN platform.apps a
LEFT JOIN platform.app_states s ON s.root_tenant_id = r.root_tenant_id AND s.app = a.app;

-- Gói đã tắt của mỗi tenant. Quyền đọc menu_items đi qua quan hệ tới view này để bỏ mục của gói tắt; không vai trò
-- nào đọc thẳng.
CREATE VIEW platform.disabled_apps AS
SELECT r.tenant_id, s.app
FROM platform.app_states s
JOIN platform.tenant_roots r ON r.root_tenant_id = s.root_tenant_id
WHERE NOT s.enabled;

-- migrate:down
DROP VIEW platform.disabled_apps;
DROP VIEW platform.apps_by_tenant;
SELECT core.audit_detach('platform.app_states');
DROP TABLE platform.app_states;
DROP FUNCTION platform.app_states_guard();
DROP FUNCTION platform.app_enabled(text, text);
DROP TABLE platform.apps;
