-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Xóa đoạn nhật ký đã lưu trữ khỏi CSDL (#97, ADR 0014). Chỉ một đường xóa: core.audit_purge, gọi trong cùng giao
-- dịch với việc ghi nhận đoạn vào core.audit_segments, sau khi cold-archive đã đọc lại tệp và tính lại băm từng
-- dòng. Chuỗi băm nối qua phần đã xóa bằng băm cuối của đoạn: trigger ghi nhật ký và core.audit_verify đều tính
-- dòng liền trước trên cả bảng lẫn các đoạn.

-- migrate:up
CREATE INDEX audit_segments_last_id ON core.audit_segments (last_id);

-- Một đoạn trong core.audit_segments nối chuỗi băm qua các dòng đã xóa (core.audit_verify tin băm cuối của đoạn), nên
-- ai ghi được một đoạn là che được việc xóa dòng. Chỉ superuser được ghi: cold-archive chạy bằng tài khoản postgres
-- (lệnh của người vận hành), còn hasura, tài khoản Hasura dùng và chủ các bảng, thì không. Chủ bảng vẫn tắt được
-- trigger bằng DDL, như ADR 0009 đã ghi; khi đó `make cold-verify` không tìm được tệp khớp với đoạn giả.
CREATE FUNCTION core.audit_segments_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF current_setting('is_superuser') <> 'on' THEN
        RAISE EXCEPTION 'Chỉ make archive (tài khoản postgres) được ghi nhận đoạn nhật ký (ADR 0014)';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER audit_segments_superuser_only BEFORE INSERT ON core.audit_segments
    FOR EACH ROW EXECUTE FUNCTION core.audit_segments_guard();

-- Thay core.audit_refuse cho riêng core.audit_log (các bảng khác vẫn dùng hàm cũ): UPDATE vẫn luôn bị chặn; DELETE
-- chỉ qua được khi superuser chạy core.audit_purge, xóa đúng đoạn hàm nhận, và đoạn đó được ghi nhận trong chính
-- giao dịch này. created_at mặc định now(), tức thời điểm bắt đầu giao dịch, nên đoạn ghi nhận ở giao dịch trước
-- không khớp; ràng buộc loại trừ của core.audit_segments không cho ghi nhận lại một đoạn chồng lên đoạn cũ. Kiểm
-- superuser ở đây chứ không chỉ trong core.audit_purge: ai cũng tự đặt được biến mortise.audit_purge rồi DELETE.
CREATE FUNCTION core.audit_log_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('is_superuser') = 'on' AND EXISTS (
        SELECT FROM core.audit_segments s
        WHERE s.id = nullif(current_setting('mortise.audit_purge', true), '')::bigint
          AND OLD.id BETWEEN s.first_id AND s.last_id
          AND s.created_at = now()
    ) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION '% trên core.audit_log không được phép: nhật ký chỉ được thêm; xóa chỉ qua make archive (ADR 0014)',
        TG_OP;
END
$$;

DROP TRIGGER audit_log_append_only ON core.audit_log;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON core.audit_log
    FOR EACH ROW EXECUTE FUNCTION core.audit_log_guard();

-- Đầu chuỗi: băm của dòng mới nhất, dù dòng đó còn trong bảng hay đã chuyển sang kho lạnh. core.audit_row đọc băm
-- trước từ đây và cập nhật dòng này mỗi lần ghi. Ở REPEATABLE READ hay SERIALIZABLE, snapshot cũ có thể không thấy
-- dòng vừa ghi; trước kia ràng buộc UNIQUE trên prev_hash chặn lại, nhưng dòng trùng có thể đã bị xóa khỏi bảng
-- (#97). Cập nhật dòng đầu chuỗi mà giao dịch khác đã đổi sau snapshot thì PostgreSQL báo lỗi tuần tự hóa (40001),
-- nên chuỗi vẫn không rẽ nhánh.
CREATE TABLE core.audit_head (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    hash      bytea NOT NULL
);
INSERT INTO core.audit_head (hash)
SELECT coalesce((
    SELECT t.hash FROM (
        (SELECT l.id, l.hash FROM core.audit_log l ORDER BY l.id DESC LIMIT 1)
        UNION ALL
        (SELECT s.last_id, s.last_hash FROM core.audit_segments s ORDER BY s.last_id DESC LIMIT 1)
    ) t ORDER BY t.id DESC LIMIT 1), '\x'::bytea);

-- Xóa các dòng của một đoạn vừa ghi nhận; trả số dòng đã xóa. Số dòng phải bằng số dòng ghi trong đoạn, nếu không
-- cả giao dịch hủy và đoạn không được ghi nhận.
CREATE FUNCTION core.audit_purge(segment bigint) RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    expected bigint;
    deleted  bigint;
BEGIN
    IF current_setting('is_superuser') <> 'on' THEN
        RAISE EXCEPTION 'Chỉ make archive (tài khoản postgres) được xóa nhật ký đã lưu trữ (ADR 0014)';
    END IF;
    SELECT s.rows INTO expected FROM core.audit_segments s WHERE s.id = segment AND s.created_at = now();
    IF expected IS NULL THEN
        RAISE EXCEPTION 'Đoạn % không được ghi nhận trong giao dịch này; chỉ xóa được ngay khi lưu trữ (ADR 0014)',
            segment;
    END IF;
    PERFORM set_config('mortise.audit_purge', segment::text, true);
    DELETE FROM core.audit_log l USING core.audit_segments s
    WHERE s.id = segment AND l.id BETWEEN s.first_id AND s.last_id;
    GET DIAGNOSTICS deleted = ROW_COUNT;
    PERFORM set_config('mortise.audit_purge', '', true);
    IF deleted <> expected THEN
        RAISE EXCEPTION 'Đoạn % ghi % dòng nhưng CSDL có % dòng để xóa; không xóa gì', segment, expected, deleted;
    END IF;
    RETURN deleted;
END
$$;

CREATE OR REPLACE FUNCTION core.audit_row() RETURNS trigger
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
    head       bytea;
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

    -- Ghi lần lượt (khóa đã lấy ở core.audit_lock; lấy lại ở đây không tốn gì). Băm trước lấy từ core.audit_head,
    -- không từ dòng mới nhất của bảng: sau khi đoạn cuối bị xóa khỏi bảng (#97), lấy riêng bảng thì chuỗi bắt đầu
    -- lại từ rỗng. Ở READ COMMITTED, câu SELECT sau thấy đầu chuỗi mà giao dịch trước vừa commit; ở mức cô lập cao
    -- hơn, lệnh UPDATE core.audit_head bên dưới báo lỗi tuần tự hóa nếu snapshot đã cũ.
    PERFORM pg_advisory_xact_lock(hashtext('core.audit_log'));
    SELECT h.hash INTO prev FROM core.audit_head h;
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
                                TG_OP, key, before_row, after_row, actor, actor_role, session_user::text))
        RETURNING core.audit_log.hash INTO head;
        UPDATE core.audit_head SET hash = head;
    EXCEPTION WHEN unique_violation THEN
        -- Mã 40001 (serialization_failure): thư viện và người gọi hiểu là "chạy lại giao dịch".
        RAISE EXCEPTION 'Ghi nhật ký trùng lúc với giao dịch khác ở mức cô lập REPEATABLE READ/SERIALIZABLE; chạy lại giao dịch'
            USING ERRCODE = '40001';
    END;
    RETURN NULL;
END
$$;

-- Kiểm chuỗi như trước (ADR 0009), nhưng dòng đầu tiên sau một đoạn đã xóa khỏi bảng nối vào băm cuối của đoạn
-- thay vì vào dòng còn lại ngay trước nó. Chuỗi bên trong các đoạn do `make cold-verify` kiểm, từ tệp.
CREATE OR REPLACE FUNCTION core.audit_verify(anchor_id bigint DEFAULT NULL, anchor_hash bytea DEFAULT NULL)
RETURNS TABLE (id bigint, problem text)
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
    WITH chain AS (
        SELECT l.id, l.hash, l.prev_hash,
               lag(l.id) OVER (ORDER BY l.id) AS live_prev_id,
               lag(l.hash) OVER (ORDER BY l.id) AS live_prev_hash,
               core.audit_hash(l.hash_version, l.prev_hash, l.id, l.at, l.tenant_id, l.table_name, l.op, l.row_key,
                               l.before, l.after, l.actor, l.actor_role, l.db_role) AS recomputed
        FROM core.audit_log l
    ), linked AS (
        -- Dòng liền trước trong chuỗi là dòng còn trong bảng ngay trước, hay dòng cuối của đoạn đã lưu trữ nằm
        -- giữa hai dòng đó: dòng đầu tiên sau một đoạn đã xóa khỏi bảng phải nối vào băm cuối của đoạn.
        SELECT c.*, CASE WHEN s.last_id > coalesce(c.live_prev_id, 0) THEN s.last_hash
                         ELSE coalesce(c.live_prev_hash, '\x'::bytea) END AS expected_prev
        FROM chain c
        LEFT JOIN LATERAL (
            SELECT g.last_id, g.last_hash FROM core.audit_segments g WHERE g.last_id < c.id
            ORDER BY g.last_id DESC LIMIT 1
        ) s ON true
    )
    SELECT c.id, CASE
        WHEN c.prev_hash <> c.expected_prev THEN 'chuỗi đứt: thiếu hoặc chèn dòng ngay trước dòng này'
        ELSE 'nội dung dòng này đã bị sửa'
    END
    FROM linked c
    WHERE c.prev_hash <> c.expected_prev OR c.recomputed <> c.hash
    UNION ALL
    -- Neo trùng dòng cuối của một đoạn thì đối chiếu với băm cuối ghi trong core.audit_segments. Neo nằm giữa
    -- một đoạn đã xóa khỏi bảng thì hàm này không đọc được tệp: trả một dòng riêng (COLD_ANCHOR) để người gọi
    -- đối chiếu qua tệp, không coi là khớp; scripts/audit-verify.sh làm việc đó (cold-archive verify --anchor).
    SELECT anchor_id, CASE WHEN cold.inside THEN 'neo nằm trong đoạn đã lưu trữ: đối chiếu bằng make cold-verify'
                           ELSE 'không khớp băm ghi trong bản sao lưu: dòng bị sửa, bị xóa, hoặc chuỗi bị tính lại' END
    FROM (SELECT EXISTS (
              SELECT FROM core.audit_segments s WHERE anchor_id BETWEEN s.first_id AND s.last_id
                AND s.last_id <> anchor_id AND NOT EXISTS (SELECT FROM core.audit_log l WHERE l.id = anchor_id)
          ) AS inside) cold
    WHERE anchor_id IS NOT NULL
      AND NOT EXISTS (SELECT FROM core.audit_log l WHERE l.id = anchor_id AND l.hash = anchor_hash)
      AND NOT EXISTS (SELECT FROM core.audit_segments s WHERE s.last_id = anchor_id AND s.last_hash = anchor_hash)
    ORDER BY 1
$$;

-- migrate:down
CREATE OR REPLACE FUNCTION core.audit_verify(anchor_id bigint DEFAULT NULL, anchor_hash bytea DEFAULT NULL)
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

CREATE OR REPLACE FUNCTION core.audit_row() RETURNS trigger
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

DROP TRIGGER audit_log_append_only ON core.audit_log;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON core.audit_log
    FOR EACH ROW EXECUTE FUNCTION core.audit_refuse();
DROP FUNCTION core.audit_purge(bigint);
DROP FUNCTION core.audit_log_guard();
DROP TABLE core.audit_head;
DROP TRIGGER audit_segments_superuser_only ON core.audit_segments;
DROP FUNCTION core.audit_segments_guard();
DROP INDEX core.audit_segments_last_id;
