-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Kiểm lớp ghi đè cấu hình ở mức CSDL (ADR 0060): chỉ tenant gốc ghi, dạng của value theo loại, đích có trong cấu hình
-- gốc của mục, view trả phần chỉnh cho mọi tenant cùng gốc, cài lại mục (xóa rồi ghi lại menu_items) không mất phần
-- chỉnh, có nhật ký. Chạy bằng superuser trong một giao dịch rồi ROLLBACK, nên không để lại gì; scripts/smoke.sh gọi.
-- Quyền Hasura (ai ghi, ai đọc) kiểm qua cổng trong scripts/smoke.sh.
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

-- Thêm một phần chỉnh của tenant gốc thử vào mục thử.
CREATE FUNCTION pg_temp.put(item text, kind text, target text, value jsonb, root text DEFAULT 'co-root')
RETURNS text LANGUAGE sql AS $$
    SELECT format('INSERT INTO platform.config_overrides (root_tenant_id, app, item, kind, target, value)
                   VALUES (%L, ''co-app'', %L, %L, %L, %L)', root, item, kind, target, value)
$$;

INSERT INTO core.tenants (id, name, parent_id) VALUES
    ('co-root', 'Gốc thử', NULL), ('co-child', 'Con thử', 'co-root'), ('co-other', 'Gốc khác', NULL);

-- Bộ cài ghi mỗi mục cho mọi tenant; ở đây chỉ cần dòng của tenant gốc, cộng một dòng của tenant con.
INSERT INTO platform.menu_items (tenant_id, app, item, position, label, component, config) VALUES
    ('co-root', 'co-app', 'list', 0, 'Danh sách', 'catalog', '{"title": "T", "source": "s",
        "fields": [{"name": "code", "label": "Mã"}, {"name": "name", "label": "Tên"},
                   {"name": "owner.name", "label": "Chủ"}],
        "list": {"columns": ["code", "name"]}}'),
    ('co-child', 'co-app', 'list', 0, 'Danh sách', 'catalog', '{}'),
    ('co-root', 'co-app', 'entry', 1, 'Nhập', 'form', '{"title": "F", "fields": [
        {"name": "code", "label": "Mã", "type": "string", "required": true},
        {"name": "note", "label": "Ghi chú", "type": "string"}]}'),
    ('co-root', 'co-app', 'numbers', 2, 'Số', 'dashboard', '{"title": "D", "panels": [
        {"id": "main", "title": "Chính", "cards": [
            {"column": "used", "label": "Dùng", "tone": {"warn_when": {"gt": 80, "label": "Cao"}}}]},
        {"id": "side", "title": "Phụ"}]}'),
    ('co-root', 'co-app', 'page', 3, 'Trang', 'page', '{"blocks": [{"item": "list"}]}');

SELECT pg_temp.accepts('nhãn của chính mục menu', pg_temp.put('list', 'label', '', '"Danh sách mới"'));
SELECT pg_temp.accepts('nhãn, ẩn, thứ tự của cột danh mục', pg_temp.put('list', 'label', 'name', '"Tên mới"'));
SELECT pg_temp.accepts('ẩn cột', pg_temp.put('list', 'hidden', 'code', 'true'));
SELECT pg_temp.accepts('thứ tự cột', pg_temp.put('list', 'order', 'name', '0'));
SELECT pg_temp.accepts('nhãn của trường qua quan hệ', pg_temp.put('list', 'label', 'owner.name', '"Người giữ"'));
SELECT pg_temp.rejects('trường qua quan hệ không phải cột của danh sách',
    pg_temp.put('list', 'hidden', 'owner.name', 'false'), 'qua quan hệ');
SELECT pg_temp.rejects('cột không có trong cấu hình gốc', pg_temp.put('list', 'label', 'nothing', '"X"'),
    'không phải trường');
SELECT pg_temp.rejects('nhãn rỗng', pg_temp.put('list', 'label', 'name', '"  "'), 'nhãn phải là chữ');
SELECT pg_temp.rejects('ẩn không phải true, false', pg_temp.put('list', 'hidden', 'name', '"yes"'), 'true hay false');
SELECT pg_temp.rejects('thứ tự không nguyên', pg_temp.put('list', 'order', 'code', '1.5'), 'số nguyên');
SELECT pg_temp.rejects('loại lạ', pg_temp.put('list', 'color', 'code', '"red"'), 'loại color');
SELECT pg_temp.rejects('kiểu cho mục không khai variant', pg_temp.put('list', 'variant', '', '"cards"'),
    'không áp cho chính mục');
SELECT pg_temp.rejects('mục chưa cài', pg_temp.put('missing', 'label', '', '"X"'), 'chưa cài');

SELECT pg_temp.accepts('ẩn trường không bắt buộc của biểu mẫu', pg_temp.put('entry', 'hidden', 'note', 'true'));
SELECT pg_temp.rejects('ẩn trường bắt buộc', pg_temp.put('entry', 'hidden', 'code', 'true'), 'bắt buộc');

SELECT pg_temp.accepts('nhãn khối bảng điều hành', pg_temp.put('numbers', 'label', 'side', '"Phụ mới"'));
SELECT pg_temp.accepts('nhãn thẻ số', pg_temp.put('numbers', 'label', 'main.used', '"Đã dùng"'));
SELECT pg_temp.accepts('ngưỡng của mức đã khai', pg_temp.put('numbers', 'threshold', 'main.used',
    '{"warn_when": {"gte": 90}}'));
SELECT pg_temp.rejects('ngưỡng của mức chưa khai', pg_temp.put('numbers', 'threshold', 'main.used',
    '{"bad_when": {"gt": 95}}'), 'chỉ có mức warn_when');
SELECT pg_temp.rejects('ngưỡng kèm chữ mức độ', pg_temp.put('numbers', 'threshold', 'main.used',
    '{"warn_when": {"gt": 1, "label": "X"}}'), 'đúng một phép');
SELECT pg_temp.rejects('ngưỡng hai phép', pg_temp.put('numbers', 'threshold', 'main.used',
    '{"warn_when": {"gt": 1, "lt": 5}}'), 'đúng một phép');
SELECT pg_temp.rejects('ngưỡng trên khối không phải thẻ', pg_temp.put('numbers', 'threshold', 'side',
    '{"warn_when": {"gt": 1}}'), 'không phải trường');

SELECT pg_temp.accepts('kiểu của khối trên trang', pg_temp.put('page', 'variant', 'list', '"cards"'));
SELECT pg_temp.accepts('thêm khối là mục khác của gói', pg_temp.put('page', 'block', 'numbers', 'true'));
SELECT pg_temp.accepts('thứ tự của khối vừa thêm', pg_temp.put('page', 'order', 'numbers', '0'));
SELECT pg_temp.rejects('thứ tự của khối chưa thêm', pg_temp.put('page', 'order', 'entry', '0'), 'không phải trường');
SELECT pg_temp.rejects('thêm khối không có trong gói', pg_temp.put('page', 'block', 'other', 'true'),
    'không phải trường');
SELECT pg_temp.rejects('kiểu sai dạng', pg_temp.put('page', 'variant', 'list', '"Thẻ"'), 'tên ngắn');

SELECT pg_temp.rejects('tenant con không ghi được', pg_temp.put('list', 'label', '', '"X"', 'co-child'),
    'có tenant cha');
SELECT pg_temp.rejects('đổi đích sau khi tạo', $$
    UPDATE platform.config_overrides SET target = 'code' WHERE item = 'list' AND kind = 'label' AND target = 'name'$$,
    'chỉ sửa được giá trị');
SELECT pg_temp.accepts('sửa giá trị', $$
    UPDATE platform.config_overrides SET value = '"Tên khác"' WHERE item = 'list' AND kind = 'label' AND target = 'name'$$);

DO $$
BEGIN
    IF (SELECT count(*) FROM platform.config_overrides_by_tenant WHERE tenant_id = 'co-child' AND app = 'co-app')
            <> (SELECT count(*) FROM platform.config_overrides WHERE root_tenant_id = 'co-root')
        OR EXISTS (SELECT FROM platform.config_overrides_by_tenant WHERE tenant_id = 'co-other') THEN
        RAISE EXCEPTION 'FAIL view: tenant con nhận đủ phần chỉnh của gốc, gốc khác không nhận dòng nào';
    END IF;
    RAISE NOTICE 'PASS view: tenant con nhận đủ phần chỉnh của gốc, gốc khác không nhận dòng nào';
END
$$;

-- Cài lại gói: bộ cài xóa mục bỏ khỏi app.yaml rồi ghi lại; phần chỉnh không khóa ngoại tới menu_items nên còn nguyên.
DELETE FROM platform.menu_items WHERE app = 'co-app';
INSERT INTO platform.menu_items (tenant_id, app, item, position, label, component, config)
VALUES ('co-root', 'co-app', 'list', 0, 'Danh sách', 'catalog', '{"fields": [{"name": "name", "label": "Tên"}]}');
DO $$
BEGIN
    IF (SELECT value FROM platform.config_overrides WHERE item = 'list' AND kind = 'label' AND target = 'name')
            IS DISTINCT FROM '"Tên khác"' THEN
        RAISE EXCEPTION 'FAIL cài lại: phần chỉnh mất sau khi ghi lại menu_items';
    END IF;
    RAISE NOTICE 'PASS cài lại: phần chỉnh còn sau khi ghi lại menu_items';
END
$$;

-- "Về mặc định" là xóa dòng; nhật ký giữ cả lần ghi lẫn lần xóa theo tenant gốc.
DELETE FROM platform.config_overrides WHERE root_tenant_id = 'co-root' AND item = 'list';
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM core.audit_log WHERE table_name = 'platform.config_overrides' AND op = 'DELETE'
                   AND tenant_id = 'co-root' AND before ->> 'target' = 'name')
        OR NOT EXISTS (SELECT FROM core.audit_log WHERE table_name = 'platform.config_overrides' AND op = 'UPDATE'
                   AND tenant_id = 'co-root' AND after ->> 'value' = 'Tên khác') THEN
        RAISE EXCEPTION 'FAIL nhật ký: thiếu dòng sửa hay xóa phần chỉnh của tenant gốc';
    END IF;
    RAISE NOTICE 'PASS nhật ký ghi sửa và xóa phần chỉnh theo tenant gốc';
END
$$;

ROLLBACK;
