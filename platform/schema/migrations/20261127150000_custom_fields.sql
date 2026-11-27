-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Trường tùy chỉnh (ADR 0059): quản trị org (tenant_admin của tenant không có cha) thêm trường cho một bảng của gói mà
-- không đổi lược đồ. Giá trị nằm trong cột `custom jsonb` của bảng đó; định nghĩa nằm ở platform.custom_fields, một bộ
-- cho mỗi tenant gốc, áp cho mọi tenant con. Gói bật cho bảng của mình bằng platform.custom_fields_attach() trong
-- migration của gói, vì gói khai báo không được tự viết trigger (ADR 0022). Quyền đọc, ghi nằm ở
-- platform/schema/hasura/tables.yaml.

-- migrate:up

-- Tenant gốc của mỗi tenant: đi ngược parent_id tới tenant không có cha. Dùng chung cho mọi cấu hình đặt theo tenant
-- gốc (một bộ cho cả org), để quyền Hasura đi qua một quan hệ thay vì so nhiều tầng bằng `_or`, mà
-- scripts/hasura-metadata.py không coi là lọc theo tenant. CYCLE: CSDL chỉ chặn tenant làm cha chính nó; vòng dài hơn
-- do người vận hành sửa nhầm thì view dừng thay vì đệ quy mãi, và tenant trong vòng không có gốc nào.
CREATE VIEW platform.tenant_roots AS
WITH RECURSIVE walk (tenant_id, current_id, parent_id) AS (
    SELECT t.id, t.id, t.parent_id FROM core.tenants t
    UNION ALL
    SELECT w.tenant_id, p.id, p.parent_id
    FROM walk w JOIN core.tenants p ON p.id = w.parent_id
) CYCLE current_id SET looped USING path
SELECT tenant_id, current_id AS root_tenant_id FROM walk WHERE parent_id IS NULL AND NOT looped;

-- Bảng đã bật trường tùy chỉnh, do custom_fields_attach() ghi. Định nghĩa trỏ về đây: không định nghĩa được trường cho
-- bảng không có cột `custom` và trigger kiểm, và gỡ gói (lùi migration gọi detach) xóa định nghĩa theo.
CREATE TABLE platform.custom_field_tables (
    -- Tên GraphQL mà Hasura sinh cho bảng (<lược đồ>_<bảng>), cũng là `source` trong cấu hình danh mục, biểu mẫu:
    -- giao diện lọc và thêm định nghĩa bằng đúng chuỗi nó đang có, không phải đoán lại tên lược đồ. Hasura không đăng
    -- ký được hai bảng cùng tên này, nên chuỗi chỉ trỏ một bảng.
    source text PRIMARY KEY,
    app    text NOT NULL,
    UNIQUE (app, source)
);

-- Danh sách lựa chọn: mảng chuỗi khác rỗng, không trùng. Giá trị lưu trong dòng chính là chuỗi hiện ra, nên không có
-- cặp mã và nhãn để giữ đồng bộ.
CREATE FUNCTION platform.custom_field_choices_valid(choices jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
    SELECT jsonb_typeof(choices) = 'array'
       AND jsonb_array_length(choices) BETWEEN 1 AND 100
       AND NOT EXISTS (
           SELECT FROM jsonb_array_elements(choices) c
           WHERE jsonb_typeof(c) <> 'string' OR btrim(c #>> '{}') = '' OR length(c #>> '{}') > 200)
       AND (SELECT count(DISTINCT c) FROM jsonb_array_elements(choices) c) = jsonb_array_length(choices)
$$;

CREATE TABLE platform.custom_fields (
    -- Tenant gốc của org; mọi tenant con dùng chung bộ định nghĩa này.
    root_tenant_id text NOT NULL REFERENCES core.tenants (id) ON DELETE CASCADE,
    app            text NOT NULL,
    source         text NOT NULL,
    -- Khóa trong jsonb của dòng; bất biến, vì đổi mã thì giá trị đã ghi dưới mã cũ thành khóa lạ.
    code           text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{0,39}$'),
    label          text NOT NULL CHECK (btrim(label) <> '' AND length(label) <= 200),
    -- Bất biến như mã: đổi kiểu thì giá trị đã ghi không còn đúng kiểu.
    kind           text NOT NULL CHECK (kind IN ('text', 'number', 'date', 'choice')),
    choices        jsonb,
    required       boolean NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (root_tenant_id, source, code),
    FOREIGN KEY (app, source) REFERENCES platform.custom_field_tables (app, source) ON DELETE CASCADE,
    CONSTRAINT custom_fields_choices CHECK (
        CASE WHEN kind = 'choice' THEN platform.custom_field_choices_valid(choices) ELSE choices IS NULL END)
);

-- Ràng buộc mà CHECK không diễn đạt được. Hasura đã chỉ cho sửa nhãn, lựa chọn, bắt buộc và chỉ cho tenant không có
-- cha ghi; kiểm lại ở đây để đường ghi khác (psql, bộ cài sau này) cũng không phá được.
CREATE FUNCTION platform.custom_fields_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.root_tenant_id, NEW.app, NEW.source, NEW.code, NEW.kind)
            IS DISTINCT FROM (OLD.root_tenant_id, OLD.app, OLD.source, OLD.code, OLD.kind) THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = format(
            'Trường tùy chỉnh %s: không đổi được mã, kiểu hay bảng sau khi tạo; xóa trường rồi tạo trường mới (ADR 0059)',
            OLD.code);
    END IF;
    IF EXISTS (SELECT FROM core.tenants t WHERE t.id = NEW.root_tenant_id AND t.parent_id IS NOT NULL) THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = format(
            'Tenant %s có tenant cha: trường tùy chỉnh chỉ định nghĩa ở tenant gốc của org (ADR 0059)',
            NEW.root_tenant_id);
    END IF;
    -- Hasura ghi được cột nhưng không đặt được giờ của máy chủ.
    NEW.updated_at := now();
    RETURN NEW;
END
$$;

CREATE TRIGGER custom_fields_guard BEFORE INSERT OR UPDATE ON platform.custom_fields
    FOR EACH ROW EXECUTE FUNCTION platform.custom_fields_guard();

-- Đổi định nghĩa là đổi dữ liệu mọi tenant con nhập được, nên có nhật ký (ADR 0009); tenant ghi là tenant gốc.
SELECT core.audit_attach('platform.custom_fields', 'root_tenant_id');

-- Lỗi của một khóa trong `custom`, hay NULL nếu giá trị hợp lệ. Tách khỏi trigger để đọc riêng từng kiểu.
CREATE FUNCTION platform.custom_field_problem(field platform.custom_fields, value jsonb) RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
    SELECT CASE
        WHEN field.kind = 'text' AND (jsonb_typeof(value) <> 'string' OR length(value #>> '{}') > 2000)
            THEN 'phải là chữ, tối đa 2000 ký tự'
        WHEN field.kind = 'number' AND jsonb_typeof(value) <> 'number'
            THEN 'phải là số'
        -- pg_input_is_valid: chuỗi khớp dạng mà sai ngày (2026-02-30) cũng bị từ chối, không chỉ so mẫu.
        WHEN field.kind = 'date' AND (jsonb_typeof(value) <> 'string'
                OR (value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' OR NOT pg_input_is_valid(value #>> '{}', 'date'))
            THEN 'phải là ngày dạng YYYY-MM-DD'
        WHEN field.kind = 'choice' AND (jsonb_typeof(value) <> 'string' OR NOT field.choices @> jsonb_build_array(value))
            THEN 'phải là một trong ' || field.choices::text
    END
$$;

-- Trigger kiểm `custom` của bảng đã bật, theo định nghĩa của tenant gốc của dòng. Chỉ kiểm khi INSERT hay khi `custom`
-- (hoặc tenant) đổi: thêm một trường bắt buộc không khóa việc sửa cột khác của dòng cũ. Khóa giữ nguyên giá trị so với
-- trước không bị kiểm lại, nên xóa một trường hay bỏ một lựa chọn không làm hỏng dòng đã có khi sửa trường khác.
-- SECURITY DEFINER: vai trò CSDL nào ghi bảng của gói cũng đọc được định nghĩa, không cần cấp quyền trên platform.
CREATE FUNCTION platform.custom_fields_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    tenant_column text := TG_ARGV[0];
    target    text := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
    graphql   text := TG_TABLE_SCHEMA || '_' || TG_TABLE_NAME;
    tenant    text := to_jsonb(NEW) ->> tenant_column;
    previous  jsonb;
    root      text;
    field     platform.custom_fields;
    key       text;
    value     jsonb;
    problem   text;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.custom IS NOT DISTINCT FROM OLD.custom
            AND tenant IS NOT DISTINCT FROM to_jsonb(OLD) ->> tenant_column THEN
        RETURN NEW;
    END IF;
    IF jsonb_typeof(NEW.custom) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION USING ERRCODE = 'check_violation',
            MESSAGE = 'Trường tùy chỉnh (custom) phải là một đối tượng JSON {mã: giá trị} (ADR 0059)';
    END IF;
    SELECT r.root_tenant_id INTO root FROM platform.tenant_roots r WHERE r.tenant_id = tenant;
    -- Đổi tenant thì dòng sang bộ định nghĩa của gốc khác: kiểm lại mọi khóa, không dựa vào giá trị đã nhận trước đó.
    IF TG_OP = 'UPDATE' AND tenant IS NOT DISTINCT FROM to_jsonb(OLD) ->> tenant_column THEN
        previous := OLD.custom;
    END IF;

    FOR key, value IN SELECT * FROM jsonb_each(NEW.custom) LOOP
        -- null là ô bỏ trống; giá trị không đổi so với trước thì đã được nhận lúc ghi.
        CONTINUE WHEN jsonb_typeof(value) = 'null' OR previous -> key IS NOT DISTINCT FROM value;
        SELECT f.* INTO field FROM platform.custom_fields f
        WHERE f.root_tenant_id = root AND f.source = graphql AND f.code = key;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = format(
                'Trường tùy chỉnh "%s" chưa được định nghĩa cho %s; quản trị org thêm trường trước (ADR 0059)',
                key, target);
        END IF;
        problem := platform.custom_field_problem(field, value);
        IF problem IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = 'check_violation',
                MESSAGE = format('Trường "%s" (%s) %s', field.label, key, problem);
        END IF;
    END LOOP;

    FOR field IN SELECT f.* FROM platform.custom_fields f
            WHERE f.root_tenant_id = root AND f.source = graphql AND f.required LOOP
        value := NEW.custom -> field.code;
        IF value IS NULL OR jsonb_typeof(value) = 'null' OR btrim(value #>> '{}') = '' THEN
            RAISE EXCEPTION USING ERRCODE = 'check_violation',
                MESSAGE = format('Trường "%s" (%s) là bắt buộc', field.label, field.code);
        END IF;
    END LOOP;
    RETURN NEW;
END
$$;

-- Bật trường tùy chỉnh cho một bảng của gói. Gói gọi trong migration của mình:
-- SELECT platform.custom_fields_attach('app_x.items', 'x'); truyền tên cột tenant nếu không phải tenant_id. Tên lược
-- đồ và bảng phải là chữ thường không cần trích dẫn, để source khớp đúng tên trigger thấy và tên GraphQL.
CREATE FUNCTION platform.custom_fields_attach(target regclass, app text, tenant_column text DEFAULT 'tenant_id')
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    name text;
BEGIN
    SELECT n.nspname || '.' || c.relname INTO name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = target;
    IF name !~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$' THEN
        RAISE EXCEPTION 'custom_fields_attach: tên % phải là chữ thường, số, gạch dưới', name;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_attribute a WHERE a.attrelid = target AND a.attname = tenant_column
                   AND NOT a.attisdropped) THEN
        RAISE EXCEPTION 'custom_fields_attach: bảng % không có cột tenant %', name, tenant_column;
    END IF;
    EXECUTE format('ALTER TABLE %s ADD COLUMN custom jsonb NOT NULL DEFAULT ''{}''', target);
    EXECUTE format('CREATE TRIGGER custom_fields BEFORE INSERT OR UPDATE ON %s
                    FOR EACH ROW EXECUTE FUNCTION platform.custom_fields_check(%L)', target, tenant_column);
    INSERT INTO platform.custom_field_tables (source, app) VALUES (replace(name, '.', '_'), app);
END
$$;

-- Gỡ trường tùy chỉnh khỏi một bảng (phần down của migration): xóa định nghĩa (có nhật ký), trigger và cột.
CREATE FUNCTION platform.custom_fields_detach(target regclass) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    DELETE FROM platform.custom_field_tables t
    WHERE t.source = (SELECT n.nspname || '_' || c.relname
                          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = target);
    EXECUTE format('DROP TRIGGER custom_fields ON %s', target);
    EXECUTE format('ALTER TABLE %s DROP COLUMN custom', target);
END
$$;

-- migrate:down
DROP FUNCTION platform.custom_fields_detach(regclass);
DROP FUNCTION platform.custom_fields_attach(regclass, text, text);
DROP FUNCTION platform.custom_fields_check();
DROP FUNCTION platform.custom_field_problem(platform.custom_fields, jsonb);
SELECT core.audit_detach('platform.custom_fields');
DROP TABLE platform.custom_fields;
DROP FUNCTION platform.custom_fields_guard();
DROP FUNCTION platform.custom_field_choices_valid(jsonb);
DROP TABLE platform.custom_field_tables;
DROP VIEW platform.tenant_roots;
