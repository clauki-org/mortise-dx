-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Ràng buộc trên nhiều dòng cho gói khai báo (ADR 0062): gói viết một view liệt kê các dòng vi phạm (ví dụ số dư âm)
-- rồi gọi platform.empty_guard_attach() trong migration của mình cho mỗi bảng mà thay đổi có thể làm view có dòng.
-- Lệnh ghi nào làm view có dòng của tenant vừa ghi thì bị từ chối với lời báo của gói. CHECK chỉ thấy một dòng, còn
-- gói khai báo không được tự viết trigger (ADR 0022), nên luật kiểu "không xuất quá số đang có" cần hàm này.

-- migrate:up

-- Chạy sau mỗi dòng thêm, sửa, xóa (AFTER ROW, tức cuối câu lệnh: view thấy mọi dòng câu lệnh đã ghi). Khóa theo
-- (view, tenant) rồi mới đọc view: hai giao dịch cùng ghi một tenant thì giao dịch sau chờ giao dịch trước xong, và ở
-- mức READ COMMITTED (mặc định của PostgreSQL) câu SELECT sau khóa thấy dòng giao dịch trước đã ghi. Không khóa thì hai
-- lệnh xuất đồng thời cùng thấy đủ hàng và cùng qua. Tenant khác không chờ nhau.
CREATE FUNCTION platform.empty_guard_check() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    violations    text := TG_ARGV[0];
    message       text := TG_ARGV[1];
    tenant_column text := TG_ARGV[2];
    tenant        text;
    found         boolean;
BEGIN
    -- Sửa có thể chuyển dòng sang tenant khác: xét cả tenant cũ và mới, theo thứ tự cố định để hai giao dịch không
    -- khóa chéo nhau.
    FOR tenant IN
        SELECT DISTINCT t FROM (VALUES
            (CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ->> tenant_column END),
            (CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ->> tenant_column END)) AS v (t)
        WHERE t IS NOT NULL
        ORDER BY t
    LOOP
        PERFORM pg_advisory_xact_lock(hashtext(violations), hashtext(tenant));
        EXECUTE format('SELECT EXISTS (SELECT FROM %s WHERE %I = $1)', violations, tenant_column)
            INTO found USING tenant;
        IF found THEN
            -- check_violation: cùng mã với vi phạm CHECK của bảng, để Hasura và giao diện xử lý như lỗi giá trị chứ
            -- không như lỗi quyền.
            RAISE EXCEPTION USING ERRCODE = 'check_violation', MESSAGE = message;
        END IF;
    END LOOP;
    RETURN NULL;
END
$$;

-- Gắn luật cho một bảng: view `violations` phải có cột tenant cùng tên với cột tenant của bảng. Lời báo do gói viết,
-- vì nền tảng không biết luật nói về điều gì. Gỡ bảng hay lược đồ (DROP ... CASCADE) thì trigger đi theo, nên không có
-- hàm gỡ riêng.
CREATE FUNCTION platform.empty_guard_attach(
    target regclass, violations regclass, message text, tenant_column text DEFAULT 'tenant_id'
) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF coalesce(btrim(message), '') = '' THEN
        RAISE EXCEPTION 'empty_guard_attach: cần lời báo cho người dùng khi lệnh ghi bị từ chối';
    END IF;
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %s
                    FOR EACH ROW EXECUTE FUNCTION platform.empty_guard_check(%L, %L, %L)',
                   left('empty_guard_' || (SELECT relname FROM pg_class WHERE oid = violations), 63),
                   target, violations::text, message, tenant_column);
END
$$;

-- migrate:down
DROP FUNCTION platform.empty_guard_attach(regclass, regclass, text, text);
DROP FUNCTION platform.empty_guard_check();
