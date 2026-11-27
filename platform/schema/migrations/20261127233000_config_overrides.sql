-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Lớp ghi đè cấu hình theo org (ADR 0060): quản trị org (tenant_admin của tenant không có cha) đổi nhãn, ẩn hiện, thứ
-- tự, kiểu, khối, ngưỡng của mục menu do gói khai mà không sửa platform.menu_items.config. Bộ cài gói
-- (scripts/app-deploy.py) xóa và ghi lại menu_items mỗi lần cài, nên phần chỉnh nằm ở bảng riêng, không khóa ngoại tới
-- menu_items: cài lại gói không mất phần đã chỉnh. Trình duyệt đọc qua view config_overrides_by_tenant, trộn với cấu
-- hình gốc rồi kiểm lại (platform/web/src/configOverrides.ts). Quyền đọc, ghi ở platform/schema/hasura/tables.yaml.

-- migrate:up

CREATE TABLE platform.config_overrides (
    -- Tenant gốc của org; mọi tenant con dùng chung phần chỉnh này (platform.tenant_roots).
    root_tenant_id text NOT NULL REFERENCES core.tenants (id) ON DELETE CASCADE,
    app            text NOT NULL,
    item           text NOT NULL,
    -- Danh sách đóng: giao diện chỉ biết trộn các loại này, loại lạ thì bị bỏ qua, nên CSDL không nhận loại khác.
    kind           text NOT NULL CHECK (kind IN ('label', 'hidden', 'order', 'variant', 'block', 'threshold')),
    -- Tên trường, cột hay khối trong cấu hình gốc, không phải đường dẫn JSON: cấu hình gốc đổi bố cục khi gói lên bản
    -- mới thì tên vẫn trỏ đúng chỗ. Chuỗi rỗng là chính mục menu (nhãn, ẩn, thứ tự trên menu); NULL không dùng được
    -- vì cột nằm trong khóa chính.
    target         text NOT NULL CHECK (length(target) <= 200),
    value          jsonb NOT NULL,
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (root_tenant_id, app, item, kind, target)
);

-- Dạng của value theo loại; NULL là hợp lệ. Ngưỡng chỉ đổi con số, không đổi chữ mức độ: chữ là của gói.
CREATE FUNCTION platform.config_override_value_problem(kind text, value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
    SELECT CASE
        WHEN kind = 'label' AND (jsonb_typeof(value) <> 'string' OR btrim(value #>> '{}') = ''
                OR length(value #>> '{}') > 200)
            THEN 'nhãn phải là chữ, từ 1 tới 200 ký tự'
        WHEN kind IN ('hidden', 'block') AND jsonb_typeof(value) <> 'boolean'
            THEN 'phải là true hay false'
        WHEN kind = 'order' AND (jsonb_typeof(value) <> 'number' OR (value #>> '{}')::numeric % 1 <> 0
                OR (value #>> '{}')::numeric NOT BETWEEN 0 AND 9999)
            THEN 'thứ tự phải là số nguyên từ 0 tới 9999'
        WHEN kind = 'variant' AND (jsonb_typeof(value) <> 'string' OR (value #>> '{}') !~ '^[a-z][a-z0-9-]{0,39}$')
            THEN 'kiểu phải là tên ngắn: chữ thường, số, gạch ngang'
        WHEN kind = 'threshold' AND (jsonb_typeof(value) <> 'object' OR value = '{}'
                OR EXISTS (SELECT FROM jsonb_object_keys(value) k WHERE k NOT IN ('warn_when', 'bad_when'))
                OR EXISTS (SELECT FROM jsonb_each(value) l WHERE jsonb_typeof(l.value) <> 'object'
                    OR (SELECT count(*) FROM jsonb_object_keys(l.value)) <> 1
                    OR EXISTS (SELECT FROM jsonb_each(l.value) o
                               WHERE o.key NOT IN ('gt', 'gte', 'lt', 'lte') OR jsonb_typeof(o.value) <> 'number')))
            THEN 'ngưỡng phải là {warn_when, bad_when}, mỗi mức đúng một phép gt, gte, lt, lte với một số'
    END
$$;

-- Đích của phần chỉnh có trong cấu hình gốc của mục không; NULL là có. Chỉ xét tầng ngoài cùng của cấu hình (trường
-- của danh mục ngoài cùng, không phải của bảng con hay biểu mẫu lồng trong nó): tên trường lặp lại ở bảng con, nên
-- một tên không chỉ ra được một chỗ. Hàm này và overrideTargets() trong platform/web/src/configOverrides.ts phải nói
-- cùng một điều; platform/schema/tests/config_overrides.sql thử từng loại.
CREATE FUNCTION platform.config_override_target_problem(
    root text, app text, item text, component text, config jsonb, kind text, target text, value jsonb)
RETURNS text
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog
AS $$
DECLARE
    field jsonb;
    card  jsonb;
BEGIN
    IF target = '' THEN
        IF kind IN ('label', 'hidden', 'order') OR (kind = 'variant' AND config ? 'variant') THEN
            RETURN NULL;
        END IF;
        RETURN format('loại %s không áp cho chính mục menu', kind);
    END IF;

    -- Khối của trang (thành phần có blocks): đổi kiểu, ẩn, thứ tự của khối đã có; thêm khối là một mục khác của cùng
    -- gói, đã có trong menu_items nên đã qua bộ kiểm khi cài.
    IF jsonb_typeof(config -> 'blocks') = 'array' THEN
        IF kind IN ('variant', 'hidden', 'order', 'block')
                AND EXISTS (SELECT FROM jsonb_array_elements(config -> 'blocks') b WHERE b ->> 'item' = target) THEN
            RETURN NULL;
        END IF;
        -- Tham số mang tên hàm phía trước: cột của menu_items trùng tên app, item.
        IF kind = 'block' AND value = 'true' AND target <> item AND EXISTS (
                SELECT FROM platform.menu_items m
                WHERE m.tenant_id = config_override_target_problem.root
                    AND m.app = config_override_target_problem.app AND m.item = target) THEN
            RETURN NULL;
        END IF;
        -- Khối đã thêm bằng phần chỉnh block cũng đổi được kiểu, thứ tự.
        IF kind IN ('variant', 'hidden', 'order') AND EXISTS (
                SELECT FROM platform.config_overrides o
                WHERE o.root_tenant_id = config_override_target_problem.root
                    AND o.app = config_override_target_problem.app AND o.item = config_override_target_problem.item
                    AND o.kind = 'block' AND o.target = config_override_target_problem.target
                    AND o.value = 'true') THEN
            RETURN NULL;
        END IF;
    END IF;

    IF component IN ('catalog', 'form') AND kind IN ('label', 'hidden', 'order') THEN
        SELECT f INTO field FROM jsonb_array_elements(config -> 'fields') f WHERE f ->> 'name' = target;
        IF field IS NOT NULL THEN
            -- Danh sách chỉ đọc cột của chính bảng; trường qua quan hệ (có dấu chấm) chỉ hiện ở chi tiết.
            IF component = 'catalog' AND kind <> 'label' AND target LIKE '%.%' THEN
                RETURN format('"%s" là trường qua quan hệ, không phải cột của danh sách', target);
            END IF;
            -- Ẩn trường bắt buộc thì biểu mẫu không bao giờ gửi được.
            IF component = 'form' AND kind = 'hidden' AND value = 'true' AND field ->> 'required' = 'true' THEN
                RETURN format('trường "%s" là bắt buộc, không ẩn được', target);
            END IF;
            RETURN NULL;
        END IF;
    END IF;

    IF component = 'dashboard' THEN
        IF kind IN ('label', 'hidden', 'order')
                AND EXISTS (SELECT FROM jsonb_array_elements(config -> 'panels') p WHERE p ->> 'id' = target) THEN
            RETURN NULL;
        END IF;
        -- Thẻ số: <khối>.<cột>, vì cùng một cột có thể hiện ở nhiều khối.
        SELECT c INTO card FROM jsonb_array_elements(config -> 'panels') p, jsonb_array_elements(p -> 'cards') c
        WHERE p ->> 'id' = split_part(target, '.', 1) AND c ->> 'column' = split_part(target, '.', 2)
            AND target = split_part(target, '.', 1) || '.' || split_part(target, '.', 2);
        IF card IS NOT NULL AND kind = 'label' THEN
            RETURN NULL;
        END IF;
        -- Chỉ đổi số của mức gói đã khai: chữ mức độ lấy từ gói, mức chưa khai thì không có chữ để hiện.
        IF card IS NOT NULL AND kind = 'threshold' THEN
            IF EXISTS (SELECT FROM jsonb_object_keys(value) k WHERE NOT coalesce(card -> 'tone' ? k, false)) THEN
                RETURN format('thẻ "%s" chỉ có mức %s', target,
                              coalesce((SELECT string_agg(k, ', ') FROM jsonb_object_keys(card -> 'tone') k), 'nào'));
            END IF;
            RETURN NULL;
        END IF;
    END IF;

    RETURN format('"%s" không phải trường, cột hay khối của mục %s/%s nhận loại %s', target, app, item, kind);
END
$$;

-- Kiểm mỗi lần ghi, kể cả đường ghi khác Hasura (psql, bộ cài sau này): tenant gốc, dạng của value, và đích có trong
-- cấu hình gốc của mục ở tenant gốc. Bộ cài ghi menu_items cho mọi tenant, nên dòng của tenant gốc có mặt khi gói đã
-- cài. Gói lên bản mới bỏ một trường thì phần chỉnh cũ vẫn nằm đây; giao diện bỏ qua nó và báo ở console.
CREATE FUNCTION platform.config_overrides_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    menu    platform.menu_items;
    problem text;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.root_tenant_id, NEW.app, NEW.item, NEW.kind, NEW.target)
            IS DISTINCT FROM (OLD.root_tenant_id, OLD.app, OLD.item, OLD.kind, OLD.target) THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE =
            'Phần chỉnh cấu hình: chỉ sửa được giá trị; đổi đích thì xóa rồi thêm dòng mới (ADR 0060)';
    END IF;
    IF EXISTS (SELECT FROM core.tenants t WHERE t.id = NEW.root_tenant_id AND t.parent_id IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = format(
            'Tenant %s có tenant cha: chỉ tenant gốc của org chỉnh được cấu hình (ADR 0060)', NEW.root_tenant_id);
    END IF;
    problem := platform.config_override_value_problem(NEW.kind, NEW.value);
    IF problem IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation',
            MESSAGE = format('Phần chỉnh %s của "%s": %s', NEW.kind, NEW.target, problem);
    END IF;
    SELECT m.* INTO menu FROM platform.menu_items m
    WHERE m.tenant_id = NEW.root_tenant_id AND m.app = NEW.app AND m.item = NEW.item;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = format(
            'Mục %s/%s chưa cài cho tenant %s: không có cấu hình gốc để chỉnh', NEW.app, NEW.item, NEW.root_tenant_id);
    END IF;
    problem := platform.config_override_target_problem(NEW.root_tenant_id, NEW.app, NEW.item, menu.component,
                                                       menu.config, NEW.kind, NEW.target, NEW.value);
    IF problem IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = format('Phần chỉnh cấu hình: %s', problem);
    END IF;
    -- Hasura ghi được cột nhưng không đặt được giờ của máy chủ.
    NEW.updated_at := now();
    RETURN NEW;
END
$$;

CREATE TRIGGER config_overrides_guard BEFORE INSERT OR UPDATE ON platform.config_overrides
    FOR EACH ROW EXECUTE FUNCTION platform.config_overrides_guard();

-- Phần chỉnh đổi điều mọi tenant con thấy, nên có nhật ký (ADR 0009); "Về mặc định" là xóa dòng, cũng có nhật ký.
SELECT core.audit_attach('platform.config_overrides', 'root_tenant_id');

-- Phần chỉnh mỗi tenant nhận: của tenant gốc của nó. Quyền đọc lọc theo tenant_id của view bằng tenant trong token,
-- nên tenant thuộc org khác không thấy dòng nào.
CREATE VIEW platform.config_overrides_by_tenant AS
SELECT r.tenant_id, o.root_tenant_id, o.app, o.item, o.kind, o.target, o.value, o.updated_at
FROM platform.config_overrides o
JOIN platform.tenant_roots r ON r.root_tenant_id = o.root_tenant_id;

-- migrate:down
DROP VIEW platform.config_overrides_by_tenant;
SELECT core.audit_detach('platform.config_overrides');
DROP TABLE platform.config_overrides;
DROP FUNCTION platform.config_overrides_guard();
DROP FUNCTION platform.config_override_target_problem(text, text, text, text, jsonb, text, text, jsonb);
DROP FUNCTION platform.config_override_value_problem(text, jsonb);
