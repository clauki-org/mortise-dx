-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Kiểm trường tùy chỉnh ở mức CSDL (ADR 0059): tenant gốc, ràng buộc của định nghĩa, trigger kiểm `custom` trên một
-- bảng thử. Chạy bằng superuser trong một giao dịch rồi ROLLBACK, nên không để lại gì (kể cả dòng nhật ký);
-- scripts/smoke.sh gọi, lỗi đầu tiên dừng tệp với thông báo nói rõ ca nào sai. Quyền Hasura (ai ghi, ai đọc) kiểm qua
-- cổng ở apps/facilities-commune/tests/smoke.sh.
\set ON_ERROR_STOP 1
BEGIN;

-- Câu lệnh phải bị từ chối với thông báo chứa mẫu; chạy trong khối con để lỗi mong đợi không hủy cả giao dịch.
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

INSERT INTO core.tenants (id, name, parent_id) VALUES
    ('cf-root', 'Gốc thử', NULL), ('cf-child', 'Con thử', 'cf-root'), ('cf-grand', 'Cháu thử', 'cf-child'),
    ('cf-other', 'Gốc khác', NULL);

DO $$
BEGIN
    IF (SELECT array_agg(root_tenant_id ORDER BY tenant_id) FROM platform.tenant_roots
        WHERE tenant_id IN ('cf-child', 'cf-grand', 'cf-other', 'cf-root'))
        IS DISTINCT FROM ARRAY['cf-root', 'cf-root', 'cf-other', 'cf-root'] THEN
        RAISE EXCEPTION 'FAIL tenant_roots: con, cháu về gốc của mình, gốc về chính nó';
    END IF;
    RAISE NOTICE 'PASS tenant_roots: con, cháu về gốc của mình, gốc về chính nó';
END
$$;

CREATE SCHEMA cf_test;
CREATE TABLE cf_test.things (id serial PRIMARY KEY, tenant_id text NOT NULL, name text);
SELECT platform.custom_fields_attach('cf_test.things', 'cf-app');

SELECT pg_temp.accepts('định nghĩa ở tenant gốc', $$
    INSERT INTO platform.custom_fields (root_tenant_id, app, source, code, label, kind, choices, required) VALUES
        ('cf-root', 'cf-app', 'cf_test_things', 'pick', 'Lựa chọn', 'choice', '["A", "B"]', true),
        ('cf-root', 'cf-app', 'cf_test_things', 'amount', 'Số', 'number', NULL, false),
        ('cf-root', 'cf-app', 'cf_test_things', 'day', 'Ngày', 'date', NULL, false),
        ('cf-root', 'cf-app', 'cf_test_things', 'note', 'Chữ', 'text', NULL, false),
        ('cf-other', 'cf-app', 'cf_test_things', 'other_only', 'Chỉ gốc khác', 'text', NULL, true)$$);
SELECT pg_temp.rejects('tenant có cha không định nghĩa được', $$
    INSERT INTO platform.custom_fields (root_tenant_id, app, source, code, label, kind)
    VALUES ('cf-child', 'cf-app', 'cf_test_things', 'x', 'X', 'text')$$, 'tenant gốc');
SELECT pg_temp.rejects('bảng chưa bật trường tùy chỉnh', $$
    INSERT INTO platform.custom_fields (root_tenant_id, app, source, code, label, kind)
    VALUES ('cf-root', 'cf-app', 'cf_test_nothing', 'x', 'X', 'text')$$, 'foreign key');
SELECT pg_temp.rejects('lựa chọn rỗng', $$
    INSERT INTO platform.custom_fields (root_tenant_id, app, source, code, label, kind, choices)
    VALUES ('cf-root', 'cf-app', 'cf_test_things', 'y', 'Y', 'choice', '[]')$$, 'custom_fields_choices');
SELECT pg_temp.rejects('mã sai dạng', $$
    INSERT INTO platform.custom_fields (root_tenant_id, app, source, code, label, kind)
    VALUES ('cf-root', 'cf-app', 'cf_test_things', 'Bad-Code', 'Z', 'text')$$, 'check constraint');
SELECT pg_temp.rejects('mã bất biến', $$
    UPDATE platform.custom_fields SET code = 'amount2' WHERE root_tenant_id = 'cf-root' AND code = 'amount'$$,
    'không đổi được');
SELECT pg_temp.rejects('kiểu bất biến', $$
    UPDATE platform.custom_fields SET kind = 'text' WHERE root_tenant_id = 'cf-root' AND code = 'amount'$$,
    'không đổi được');
SELECT pg_temp.accepts('nhãn, bắt buộc sửa được', $$
    UPDATE platform.custom_fields SET label = 'Số (đơn vị)' WHERE root_tenant_id = 'cf-root' AND code = 'amount'$$);

SELECT pg_temp.accepts('dòng của tenant con với giá trị hợp lệ', $$
    INSERT INTO cf_test.things (id, tenant_id, custom) VALUES
        (1, 'cf-child', '{"pick": "A", "amount": 5.5, "day": "2026-02-28", "note": "x"}'),
        (2, 'cf-grand', '{"pick": "B"}'),
        (3, 'cf-other', '{"other_only": "có"}')$$);
SELECT pg_temp.rejects('khóa lạ', $$
    INSERT INTO cf_test.things (tenant_id, custom) VALUES ('cf-child', '{"pick": "A", "other": "x"}')$$,
    'chưa được định nghĩa');
SELECT pg_temp.rejects('trường của gốc khác là khóa lạ', $$
    INSERT INTO cf_test.things (tenant_id, custom) VALUES ('cf-child', '{"pick": "A", "other_only": "x"}')$$,
    'chưa được định nghĩa');
SELECT pg_temp.rejects('số gửi dạng chữ', $$
    INSERT INTO cf_test.things (tenant_id, custom) VALUES ('cf-child', '{"pick": "A", "amount": "5"}')$$,
    'phải là số');
SELECT pg_temp.rejects('ngày không có thật', $$
    INSERT INTO cf_test.things (tenant_id, custom) VALUES ('cf-child', '{"pick": "A", "day": "2026-02-30"}')$$,
    'phải là ngày');
SELECT pg_temp.rejects('lựa chọn ngoài danh sách', $$
    INSERT INTO cf_test.things (tenant_id, custom) VALUES ('cf-child', '{"pick": "C"}')$$, 'một trong');
SELECT pg_temp.rejects('chữ gửi dạng số', $$
    INSERT INTO cf_test.things (tenant_id, custom) VALUES ('cf-child', '{"pick": "A", "note": 1}')$$, 'phải là chữ');
SELECT pg_temp.rejects('custom không phải đối tượng', $$
    INSERT INTO cf_test.things (tenant_id, custom) VALUES ('cf-child', '["A"]')$$, 'đối tượng JSON');
SELECT pg_temp.rejects('thiếu trường bắt buộc khi thêm', $$
    INSERT INTO cf_test.things (tenant_id, name) VALUES ('cf-child', 'không có custom')$$, 'bắt buộc');
SELECT pg_temp.rejects('trường bắt buộc để null', $$
    INSERT INTO cf_test.things (tenant_id, custom) VALUES ('cf-child', '{"pick": null}')$$, 'bắt buộc');
SELECT pg_temp.rejects('bỏ trường bắt buộc khi sửa custom', $$
    UPDATE cf_test.things SET custom = custom - 'pick' WHERE id = 1$$, 'bắt buộc');

-- Trường bắt buộc mới không khóa việc sửa cột khác của dòng cũ; chỉ khi sửa `custom` mới phải điền.
UPDATE platform.custom_fields SET required = true WHERE root_tenant_id = 'cf-root' AND code = 'amount';
SELECT pg_temp.accepts('bắt buộc mới: sửa cột khác của dòng cũ vẫn được', $$
    UPDATE cf_test.things SET name = 'đổi tên' WHERE id = 2$$);
SELECT pg_temp.rejects('bắt buộc mới: sửa custom thì phải điền', $$
    UPDATE cf_test.things SET custom = custom || '{"pick": "A"}' WHERE id = 2$$, 'bắt buộc');

SELECT pg_temp.rejects('đổi sang tenant của gốc khác: kiểm lại theo định nghĩa của gốc mới', $$
    UPDATE cf_test.things SET tenant_id = 'cf-other' WHERE id = 1$$, 'chưa được định nghĩa');

-- Xóa một trường: dòng còn giữ giá trị cũ vẫn sửa được trường khác; thêm lại khóa đã xóa với giá trị mới thì bị từ
-- chối như khóa lạ.
DELETE FROM platform.custom_fields WHERE root_tenant_id = 'cf-root' AND code = 'note';
SELECT pg_temp.accepts('trường đã xóa: dòng cũ sửa trường khác được', $$
    UPDATE cf_test.things SET custom = custom || '{"amount": 7}' WHERE id = 1$$);
SELECT pg_temp.rejects('trường đã xóa: ghi giá trị mới bị từ chối', $$
    UPDATE cf_test.things SET custom = custom || '{"note": "mới"}' WHERE id = 1$$, 'chưa được định nghĩa');

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM core.audit_log WHERE table_name = 'platform.custom_fields' AND op = 'DELETE'
                   AND tenant_id = 'cf-root' AND before ->> 'code' = 'note') THEN
        RAISE EXCEPTION 'FAIL nhật ký: xóa định nghĩa không để lại dòng nhật ký của tenant gốc';
    END IF;
    RAISE NOTICE 'PASS nhật ký ghi thay đổi định nghĩa theo tenant gốc';
END
$$;

-- Gỡ khỏi bảng (down của migration gói): định nghĩa, trigger, cột đi theo.
SELECT platform.custom_fields_detach('cf_test.things');
DO $$
BEGIN
    IF EXISTS (SELECT FROM platform.custom_fields WHERE source = 'cf_test_things')
        OR EXISTS (SELECT FROM pg_attribute WHERE attrelid = 'cf_test.things'::regclass AND attname = 'custom') THEN
        RAISE EXCEPTION 'FAIL detach: còn định nghĩa hay cột custom';
    END IF;
    RAISE NOTICE 'PASS detach xóa định nghĩa và cột';
END
$$;

ROLLBACK;
