-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Kiểm bật, tắt gói ở mức CSDL (ADR 0065): chỉ tenant gốc ghi, chỉ sửa được enabled, không tắt gói mà gói đang bật
-- khác cần, không bật gói khi gói nó cần đang tắt hay chưa cài, view trả trạng thái của tenant gốc cho mọi tenant con,
-- cài lại gói giữ lựa chọn, gỡ gói xóa lựa chọn, có nhật ký. Chạy bằng superuser trong một giao dịch rồi ROLLBACK, nên
-- không để lại gì; scripts/smoke.sh gọi. Quyền Hasura (ai ghi, menu có bỏ gói tắt không) kiểm qua cổng trong
-- scripts/app-states-smoke.sh.
\set ON_ERROR_STOP 1
BEGIN;

CREATE FUNCTION pg_temp.rejects(name text, statement text, pattern text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM !~ pattern THEN
            RAISE EXCEPTION 'FAIL %: lỗi khác mong đợi: %', name, SQLERRM;
        END IF;
        RAISE NOTICE 'PASS %', name;
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL %: câu lệnh được nhận, mong bị từ chối', name;
END
$$;

CREATE FUNCTION pg_temp.accepts(name text, statement text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE statement;
    RAISE NOTICE 'PASS %', name;
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL %: %', name, SQLERRM;
END
$$;

CREATE FUNCTION pg_temp.expect(name text, actual text, wanted text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF actual IS DISTINCT FROM wanted THEN
        RAISE EXCEPTION 'FAIL %: muốn %, nhận %', name, wanted, actual;
    END IF;
    RAISE NOTICE 'PASS %', name;
END
$$;

-- Ghi trạng thái như Hasura ghi: insert kèm on_conflict sửa enabled.
CREATE FUNCTION pg_temp.put(package text, enabled boolean, root text DEFAULT 'as-root') RETURNS text
LANGUAGE sql AS $$
    SELECT format('INSERT INTO platform.app_states (root_tenant_id, app, enabled) VALUES (%L, %L, %L)
                   ON CONFLICT (root_tenant_id, app) DO UPDATE SET enabled = EXCLUDED.enabled', root, package, enabled)
$$;

INSERT INTO core.tenants (id, name, parent_id) VALUES
    ('as-root', 'Gốc thử', NULL), ('as-child', 'Con thử', 'as-root'), ('as-other', 'Gốc khác', NULL);

-- as-top cần as-base; as-free không cần gói nào. as-orphan cần một gói chưa cài.
INSERT INTO platform.apps (app, name, description, requires) VALUES
    ('as-base', 'Gói nền thử', 'Nền', '{}'),
    ('as-top', 'Gói trên thử', NULL, '{as-base}'),
    ('as-free', 'Gói rời thử', NULL, '{}'),
    ('as-orphan', 'Gói thiếu thử', NULL, '{as-missing}');

INSERT INTO platform.menu_items (tenant_id, app, item, position, label, component, config) VALUES
    ('as-root', 'as-free', 'list', 0, 'Danh sách', 'catalog', '{}'),
    ('as-child', 'as-free', 'list', 0, 'Danh sách', 'catalog', '{}');

SELECT pg_temp.expect('Không có dòng trạng thái là đang bật',
    (SELECT string_agg(app || '=' || enabled, ',' ORDER BY app) FROM platform.apps_by_tenant
     WHERE tenant_id = 'as-child' AND app LIKE 'as-%'),
    'as-base=true,as-free=true,as-orphan=true,as-top=true');

SELECT pg_temp.rejects('Tenant con không bật, tắt được gói', pg_temp.put('as-free', false, 'as-child'),
    'có tenant cha');
SELECT pg_temp.rejects('Gói chưa cài không có trạng thái', pg_temp.put('as-missing', false), 'chưa cài');
SELECT pg_temp.rejects('Không tắt gói mà gói đang bật khác cần', pg_temp.put('as-base', false),
    'Không tắt được gói as-base: gói đang bật Gói trên thử \(as-top\) cần');
SELECT pg_temp.rejects('Không bật gói khi gói nó cần chưa cài', pg_temp.put('as-orphan', true),
    'Không bật được gói as-orphan: gói này cần as-missing');

SELECT pg_temp.accepts('Tắt gói rời', pg_temp.put('as-free', false));
SELECT pg_temp.expect('Tenant con theo trạng thái của tenant gốc',
    (SELECT enabled::text FROM platform.apps_by_tenant WHERE tenant_id = 'as-child' AND app = 'as-free'), 'false');
SELECT pg_temp.expect('Org khác không bị ảnh hưởng',
    (SELECT enabled::text FROM platform.apps_by_tenant WHERE tenant_id = 'as-other' AND app = 'as-free'), 'true');
SELECT pg_temp.expect('disabled_apps có gói tắt cho cả tenant gốc và tenant con',
    (SELECT string_agg(tenant_id, ',' ORDER BY tenant_id) FROM platform.disabled_apps WHERE app = 'as-free'),
    'as-child,as-root');
SELECT pg_temp.expect('Tắt gói không xóa mục menu (dữ liệu giữ nguyên)',
    (SELECT count(*)::text FROM platform.menu_items WHERE app = 'as-free'), '2');

-- Tắt gói trên rồi gói nền thì được; bật lại gói trên khi gói nền đang tắt thì không.
SELECT pg_temp.accepts('Tắt gói cần gói khác', pg_temp.put('as-top', false));
SELECT pg_temp.accepts('Tắt gói nền khi không còn gói đang bật nào cần nó', pg_temp.put('as-base', false));
SELECT pg_temp.rejects('Không bật gói khi gói nó cần đang tắt', pg_temp.put('as-top', true),
    'Không bật được gói as-top: gói này cần as-base');
SELECT pg_temp.accepts('Bật lại gói nền', pg_temp.put('as-base', true));
SELECT pg_temp.accepts('Bật lại gói trên sau gói nền', pg_temp.put('as-top', true));
SELECT pg_temp.rejects('Gói nền lại bị chặn tắt khi gói trên bật lại',
    pg_temp.put('as-base', false), 'as-top');

SELECT pg_temp.rejects('Chỉ sửa được enabled',
    $$UPDATE platform.app_states SET app = 'as-top' WHERE root_tenant_id = 'as-root' AND app = 'as-free'$$,
    'chỉ sửa được bật, tắt');

-- Cài lại gói: bộ cài chỉ sửa dòng platform.apps (ON CONFLICT DO UPDATE), lựa chọn tắt còn nguyên.
INSERT INTO platform.apps (app, name, description, requires) VALUES ('as-free', 'Gói rời thử, bản mới', NULL, '{}')
ON CONFLICT (app) DO UPDATE SET name = EXCLUDED.name, requires = EXCLUDED.requires;
SELECT pg_temp.expect('Cài lại gói giữ lựa chọn tắt',
    (SELECT enabled::text FROM platform.app_states WHERE root_tenant_id = 'as-root' AND app = 'as-free'), 'false');

SELECT pg_temp.expect('Nhật ký ghi lần tắt với tenant gốc',
    (SELECT count(*)::text FROM core.audit_log WHERE table_name = 'platform.app_states' AND tenant_id = 'as-root'
       AND after ->> 'app' = 'as-free' AND after ->> 'enabled' = 'false'), '1');

-- Gỡ gói: bộ cài xóa dòng platform.apps, lựa chọn đi theo.
DELETE FROM platform.apps WHERE app = 'as-free';
SELECT pg_temp.expect('Gỡ gói xóa lựa chọn',
    (SELECT count(*)::text FROM platform.app_states WHERE app = 'as-free'), '0');

ROLLBACK;
