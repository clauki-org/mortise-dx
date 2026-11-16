-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Nhật ký thay đổi dữ liệu phát hiện sửa (ADR 0009). Mỗi thay đổi trên bảng có gắn core.audit_row() thêm một dòng
-- vào core.audit_log: ai làm, lúc nào, giá trị trước và sau. Mỗi dòng băm cùng băm của dòng trước thành một chuỗi;
-- core.audit_verify() tính lại chuỗi và chỉ ra chỗ đầu tiên bị sửa hay mất.

-- migrate:up
CREATE TABLE core.audit_log (
    id           bigserial PRIMARY KEY,
    at           timestamptz NOT NULL,
    -- Không đặt khóa ngoại tới core.tenants: xóa tenant thì nhật ký của nó vẫn phải còn.
    tenant_id    text,
    table_name   text NOT NULL,
    op           text NOT NULL,
    row_key      jsonb,
    before       jsonb,
    after        jsonb,
    actor        text NOT NULL,
    -- Vai trò khai trong token khi đi qua Hasura; NULL với dịch vụ tự viết và psql.
    actor_role   text,
    -- Tài khoản CSDL đã mở kết nối: cho biết người làm được lấy từ nguồn nào, và nguồn đó tin được tới đâu.
    db_role      text NOT NULL,
    hash_version smallint NOT NULL,
    prev_hash    bytea NOT NULL UNIQUE,
    hash         bytea NOT NULL UNIQUE
);

-- Công thức băm, dùng chung cho lúc ghi và lúc kiểm. Các trường gom thành một mảng JSON (jsonb chuẩn hóa thứ tự
-- khóa) để NULL và chuỗi ghép không gây nhập nhằng; thời điểm băm dạng số micro giây, vì dạng chữ đổi theo múi giờ
-- và DateStyle của phiên. Đổi công thức thì tăng hash_version, không sửa phiên bản cũ.
CREATE FUNCTION core.audit_hash(
    version smallint, prev bytea, id bigint, at timestamptz, tenant text, table_name text, op text,
    row_key jsonb, before jsonb, after jsonb, actor text, actor_role text, db_role text
) RETURNS bytea
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
    SELECT sha256(convert_to(jsonb_build_array(
        version, encode(prev, 'hex'), id, (extract(epoch FROM at) * 1000000)::bigint, tenant, table_name, op,
        row_key, before, after, actor, actor_role, db_role
    )::text, 'UTF8'))
$$;

-- Khóa ghi nhật ký, lấy ở trigger BEFORE STATEMENT, tức trước khi câu lệnh khóa dòng nào. Nếu chỉ lấy trong
-- trigger theo dòng (sau khi dòng đã bị khóa), hai giao dịch cùng sửa nhiều dòng sẽ giữ khóa theo thứ tự ngược
-- nhau và deadlock. Giữ tới khi giao dịch kết thúc.
CREATE FUNCTION core.audit_lock() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('core.audit_log'));
    RETURN NULL;
END
$$;

-- Trigger ghi nhật ký theo dòng. Gắn bằng core.audit_attach() bên dưới. Chạy bằng quyền chủ hàm để ghi được vào
-- core.audit_log dù tài khoản đang dùng không có quyền trên bảng đó.
CREATE FUNCTION core.audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    before_row jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
    after_row  jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
    source     jsonb := coalesce(after_row, before_row);
    tenant     text := source ->> coalesce(TG_ARGV[0], 'tenant_id');
    key        jsonb;
    hasura     jsonb;
    actor      text;
    actor_role text;
    prev       bytea;
    next_id    bigint;
    stamp      timestamptz;
BEGIN
    -- Trong hàm SECURITY DEFINER, current_user là chủ hàm; session_user mới là tài khoản đã mở kết nối.
    IF session_user = 'hasura' THEN
        -- Hasura đặt biến này cho mỗi thao tác; đi qua JWT thì là sub của token, đi bằng admin secret thì người
        -- gọi tự khai được, nên ghi kèm vai trò để người đọc biết mức tin.
        hasura := nullif(current_setting('hasura.user', true), '')::jsonb;
        actor := hasura ->> 'x-hasura-user-id';
        actor_role := hasura ->> 'x-hasura-role';
    ELSE
        actor := nullif(current_setting('mortise.actor', true), '');
    END IF;
    actor := coalesce(actor, session_user::text);

    SELECT jsonb_object_agg(a.attname, source -> a.attname) INTO key
    FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = TG_RELID AND i.indisprimary;

    -- Ghi lần lượt (khóa đã lấy ở core.audit_lock; lấy lại ở đây không tốn gì). Ở READ COMMITTED, câu SELECT sau
    -- thấy băm cuối mà giao dịch trước vừa commit. Ở REPEATABLE READ hay SERIALIZABLE, snapshot có thể cũ hơn:
    -- khi đó băm trước trùng và ràng buộc UNIQUE chặn lại, chuỗi không rẽ nhánh, giao dịch phải chạy lại.
    PERFORM pg_advisory_xact_lock(hashtext('core.audit_log'));
    SELECT l.hash INTO prev FROM core.audit_log l ORDER BY l.id DESC LIMIT 1;
    prev := coalesce(prev, '\x'::bytea);
    next_id := nextval('core.audit_log_id_seq');
    -- clock_timestamp: thời điểm ghi thật, không phải thời điểm bắt đầu giao dịch.
    stamp := clock_timestamp();

    BEGIN
        INSERT INTO core.audit_log (id, at, tenant_id, table_name, op, row_key, before, after, actor, actor_role,
                                    db_role, hash_version, prev_hash, hash)
        VALUES (next_id, stamp, tenant, TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, TG_OP, key, before_row,
                after_row, actor, actor_role, session_user, 1, prev,
                core.audit_hash(1::smallint, prev, next_id, stamp, tenant, TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
                                TG_OP, key, before_row, after_row, actor, actor_role, session_user::text));
    EXCEPTION WHEN unique_violation THEN
        -- Mã 40001 (serialization_failure): thư viện và người gọi hiểu là "chạy lại giao dịch".
        RAISE EXCEPTION 'Ghi nhật ký trùng lúc với giao dịch khác ở mức cô lập REPEATABLE READ/SERIALIZABLE; chạy lại giao dịch'
            USING ERRCODE = '40001';
    END;
    RETURN NULL;
END
$$;

-- TRUNCATE xóa dữ liệu mà không qua trigger theo dòng, nên nhật ký sẽ không thấy; chặn hẳn trên bảng có nhật ký.
-- Nhật ký chỉ được thêm: sửa, xóa, TRUNCATE đều bị chặn, kể cả với chủ bảng, trừ khi cố ý tắt trigger.
CREATE FUNCTION core.audit_refuse() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% trên % không được phép: thay đổi phải để lại nhật ký (ADR 0009)', TG_OP, TG_TABLE_NAME;
END
$$;

CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON core.audit_log
    FOR EACH ROW EXECUTE FUNCTION core.audit_refuse();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON core.audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION core.audit_refuse();

-- Kiểm chuỗi: trả các dòng sai, dòng đầu tiên trước. Nối các dòng theo prev_hash chứ không theo id liền nhau, vì
-- giao dịch rollback để lại lỗ trong dãy id. anchor_id/anchor_hash: băm cuối ghi trong bản sao lưu, để phát hiện
-- cả việc sửa rồi tính lại toàn bộ chuỗi hay xóa các dòng cuối, tính đến thời điểm sao lưu.
CREATE FUNCTION core.audit_verify(anchor_id bigint DEFAULT NULL, anchor_hash bytea DEFAULT NULL)
RETURNS TABLE (id bigint, problem text)
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
    WITH chain AS (
        SELECT l.id, l.hash, l.prev_hash,
               coalesce(lag(l.hash) OVER (ORDER BY l.id), '\x'::bytea) AS expected_prev,
               core.audit_hash(l.hash_version, l.prev_hash, l.id, l.at, l.tenant_id, l.table_name, l.op, l.row_key,
                               l.before, l.after, l.actor, l.actor_role, l.db_role) AS recomputed
        FROM core.audit_log l
    )
    SELECT c.id, CASE
        WHEN c.prev_hash <> c.expected_prev THEN 'chuỗi đứt: thiếu hoặc chèn dòng ngay trước dòng này'
        ELSE 'nội dung dòng này đã bị sửa'
    END
    FROM chain c
    WHERE c.prev_hash <> c.expected_prev OR c.recomputed <> c.hash
    UNION ALL
    SELECT anchor_id, 'không khớp băm ghi trong bản sao lưu: dòng bị sửa, bị xóa, hoặc chuỗi bị tính lại'
    WHERE anchor_id IS NOT NULL
      AND NOT EXISTS (SELECT FROM core.audit_log l WHERE l.id = anchor_id AND l.hash = anchor_hash)
    ORDER BY 1
$$;

-- Gắn nhật ký cho một bảng: khóa trước câu lệnh, ghi theo dòng, chặn TRUNCATE. Gói gọi trong migration của mình:
-- SELECT core.audit_attach('app_x.facilities'); truyền tên cột tenant nếu không phải tenant_id.
CREATE FUNCTION core.audit_attach(target regclass, tenant_column text DEFAULT 'tenant_id') RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    EXECUTE format('CREATE TRIGGER audit_lock BEFORE INSERT OR UPDATE OR DELETE ON %s
                    FOR EACH STATEMENT EXECUTE FUNCTION core.audit_lock()', target);
    EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON %s
                    FOR EACH ROW EXECUTE FUNCTION core.audit_row(%L)', target, tenant_column);
    EXECUTE format('CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON %s
                    FOR EACH STATEMENT EXECUTE FUNCTION core.audit_refuse()', target);
END
$$;

-- Gỡ nhật ký khỏi một bảng (phần down của migration).
CREATE FUNCTION core.audit_detach(target regclass) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    EXECUTE format('DROP TRIGGER audit_lock ON %s', target);
    EXECUTE format('DROP TRIGGER audit ON %s', target);
    EXECUTE format('DROP TRIGGER audit_no_truncate ON %s', target);
END
$$;

SELECT core.audit_attach('core.files');
SELECT core.audit_attach('core.tenants', 'id');

-- migrate:down
SELECT core.audit_detach('core.tenants');
SELECT core.audit_detach('core.files');
DROP FUNCTION core.audit_detach(regclass);
DROP FUNCTION core.audit_attach(regclass, text);
DROP FUNCTION core.audit_verify(bigint, bytea);
DROP TABLE core.audit_log;
DROP FUNCTION core.audit_refuse();
DROP FUNCTION core.audit_row();
DROP FUNCTION core.audit_lock();
DROP FUNCTION core.audit_hash(smallint, bytea, bigint, timestamptz, text, text, text, jsonb, jsonb, jsonb, text, text, text);
