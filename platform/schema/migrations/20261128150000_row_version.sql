-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Cột thời điểm sửa cuối do CSDL đặt, cho gói khai báo (ADR 0067). Biểu mẫu sửa của danh mục (ADR 0054) đọc cột này
-- lúc mở và đặt vào where của lệnh sửa (submit.version), để người sửa sau được báo thay vì ghi đè lần sửa của người
-- khác. Giá trị phải do máy chủ đặt ở mọi lệnh UPDATE; gói khai báo không được tự viết trigger (ADR 0022), nên gói
-- gọi platform.row_version_attach() trong migration của mình, như platform.empty_guard_attach() (ADR 0062).

-- migrate:up

-- clock_timestamp() thay vì now(): hai lệnh sửa cùng dòng trong một giao dịch vẫn ra hai giá trị khác nhau. Tên cột
-- đến từ tham số của trigger, nên một hàm dùng được cho mọi bảng; jsonb_populate_record đặt cột theo tên mà không
-- phải ghép chuỗi SQL.
CREATE FUNCTION platform.row_version_touch() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], clock_timestamp()));
    RETURN NEW;
END
$$;

-- Gắn cho một bảng đã có cột `version_column` kiểu timestamptz NOT NULL DEFAULT now() (gói tự khai cột trong CREATE
-- TABLE, để cột nằm trong lược đồ và quyền Hasura của gói). Cột trống thì Hasura không so được bằng _eq, dòng đó sửa
-- được mà không ai biết đã có người sửa trước, nên hàm từ chối cột cho phép NULL. Gỡ bảng hay lược đồ thì trigger đi
-- theo, nên không có hàm gỡ riêng.
CREATE FUNCTION platform.row_version_attach(target regclass, version_column text DEFAULT 'updated_at') RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM pg_attribute
        WHERE attrelid = target AND attname = version_column AND NOT attisdropped AND attnotnull
          AND atttypid = 'timestamptz'::regtype
    ) THEN
        RAISE EXCEPTION 'row_version_attach: % cần cột % kiểu timestamptz NOT NULL', target, version_column;
    END IF;
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %s
                    FOR EACH ROW EXECUTE FUNCTION platform.row_version_touch(%L)',
                   left('row_version_' || version_column, 63), target, version_column);
END
$$;

-- migrate:down
DROP FUNCTION platform.row_version_attach(regclass, text);
DROP FUNCTION platform.row_version_touch();
