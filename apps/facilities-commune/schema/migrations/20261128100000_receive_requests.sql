-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Tin công khai phần diện tích vượt và đăng ký nhận của đơn vị khác (ADR 0069), theo NĐ 155/2025/NĐ-CP Điều 3a khoản 3
-- (bổ sung bởi Điều 3 NĐ 369/2026/NĐ-CP). Hồ sơ rà soát (bpmn/facilities-review.bpmn20.xml) vào bước chờ `publication`
-- thì workflow-api ghi hạn vào core.case_deadlines (ADR 0053); các trigger ở đây đọc dòng hạn đó, nên chỉ CSDL quyết
-- định tin còn nhận đăng ký hay không, không tin trình duyệt. Ai đọc, ai ghi được dòng nào nằm ở hasura/tables.yaml;
-- view đọc chéo xã và mẫu tin ở 20261128100100_notice_board.sql.

-- migrate:up
-- Bậc ưu tiên của đơn vị đăng ký theo quan hệ với xã đăng tin (thứ tự thứ hai, thứ ba của điểm c). Là dữ liệu của gói,
-- không viết cứng trong view, để đổi bậc là đổi dòng ở migration sau. Cây tenant có hai cấp (tỉnh, xã), nên thứ tự thứ
-- tư (cùng tỉnh) trùng với thứ ba: cơ quan quản lý cấp trên của xã là tỉnh. Thứ tự thứ năm (tỉnh khác) cần đề nghị của
-- Chủ tịch UBND tỉnh, ngoài phạm vi: trigger dưới đây từ chối đăng ký từ tỉnh khác. Không đăng ký trong Hasura.
CREATE TABLE app_facilities_commune.priority_tiers (
    relation text PRIMARY KEY CHECK (relation IN ('own_scope', 'superior_scope')),
    tier     smallint NOT NULL UNIQUE CHECK (tier BETWEEN 2 AND 5),
    label    text NOT NULL,
    basis    text NOT NULL
);
INSERT INTO app_facilities_commune.priority_tiers (relation, tier, label, basis) VALUES
    ('own_scope', 2, 'Thuộc phạm vi quản lý của đơn vị tiếp nhận',
     'NĐ 155/2025/NĐ-CP Điều 3a khoản 3 điểm c: "Các cơ quan, tổ chức, đơn vị thuộc phạm vi quản lý của cơ quan, tổ '
     'chức, đơn vị tiếp nhận."'),
    ('superior_scope', 3, 'Thuộc phạm vi quản lý của cơ quan quản lý cấp trên',
     'NĐ 155/2025/NĐ-CP Điều 3a khoản 3 điểm c: "Các cơ quan, tổ chức, đơn vị thuộc phạm vi quản lý của cơ quan quản '
     'lý cấp trên (nếu có) của cơ quan, tổ chức, đơn vị tiếp nhận."');

-- Một tin cho một hồ sơ đang công khai, do người duyệt của xã chủ đăng qua Hasura trong thời hạn công khai. Các trường
-- là nội dung điểm a đòi: địa chỉ, công năng, phần diện tích dự kiến bố trí, sơ đồ mặt bằng hay tài liệu hiện trạng,
-- thông tin khác. portal_url là đường dẫn tới tin trên Cổng thông tin điện tử của UBND tỉnh, nơi công khai theo luật;
-- tin ở đây là bản sao.
CREATE TABLE app_facilities_commune.notices (
    -- Mã hồ sơ (process instance) trong Flowable, như core.case_deadlines.
    case_id     text PRIMARY KEY,
    tenant_id   text NOT NULL REFERENCES core.tenants (id) ON DELETE RESTRICT,
    facility_id uuid NOT NULL,
    -- Chép từ cơ sở lúc đăng: tin đã đăng không đổi theo khi sửa địa chỉ cơ sở sau đó.
    address     text,
    usage       text NOT NULL CHECK (btrim(usage) <> '' AND length(usage) <= 500),
    offered_m2  numeric(12, 2) NOT NULL CHECK (offered_m2 > 0),
    layout      text NOT NULL CHECK (btrim(layout) <> '' AND length(layout) <= 2000),
    other_info  text CHECK (length(other_info) <= 2000),
    portal_url  text CHECK (portal_url ~ '^https?://[^[:space:]]+$' AND length(portal_url) <= 1000),
    -- Đầu và cuối thời hạn công khai, chép từ dòng hạn của lõi lúc đăng; trigger nhận đăng ký vẫn đọc lại lõi.
    opened_at   timestamptz NOT NULL,
    due_at      timestamptz NOT NULL,
    created_by  text NOT NULL CHECK (created_by <> ''),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    -- Khóa ngoại ghép: tin chỉ nói về cơ sở của chính xã đăng tin.
    FOREIGN KEY (tenant_id, facility_id) REFERENCES app_facilities_commune.facilities (tenant_id, id)
        ON DELETE RESTRICT
);

-- Đăng ký nhận (văn bản đề nghị của điểm b): tenant_id là đơn vị đăng ký, lấy từ token; owner_tenant_id là xã đăng
-- tin, trigger đặt từ tin. Lưu owner_tenant_id trên dòng để quyền đọc, sửa lọc thẳng bằng một cột so với tenant của
-- token (scripts/hasura-metadata.py không nhận `_or`). Không có quyền sửa hay xóa: đơn đã gửi là hồ sơ.
CREATE TABLE app_facilities_commune.receive_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         text NOT NULL REFERENCES app_facilities_commune.notices (case_id) ON DELETE RESTRICT,
    owner_tenant_id text NOT NULL REFERENCES core.tenants (id) ON DELETE RESTRICT,
    tenant_id       text NOT NULL REFERENCES core.tenants (id) ON DELETE RESTRICT,
    -- Đơn vị thuộc xã đăng tin (bậc 2) đăng ký từ chính tenant của xã, nên phải ghi tên đơn vị; xã khác để trống thì
    -- tên là tên của xã đó.
    unit_name       text CHECK (btrim(unit_name) <> '' AND length(unit_name) <= 200),
    purpose         text NOT NULL CHECK (btrim(purpose) <> '' AND length(purpose) <= 500),
    requested_m2    numeric(12, 2) NOT NULL CHECK (requested_m2 > 0),
    -- Diện tích theo tiêu chuẩn, định mức của đơn vị đăng ký, do đơn vị tự kê.
    standard_m2     numeric(12, 2) CHECK (standard_m2 > 0),
    explanation     text NOT NULL CHECK (btrim(explanation) <> '' AND length(explanation) <= 4000),
    created_by      text NOT NULL CHECK (created_by <> ''),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX receive_requests_case ON app_facilities_commune.receive_requests (case_id);

-- Tiêu chí thứ nhất của điểm c (mục đích phù hợp công năng, diện tích đề nghị phù hợp diện tích dự kiến bố trí) do
-- người của xã đăng tin ghi, không tự tính: văn bản không nêu cách đo sự phù hợp. Dòng thuộc xã đăng tin (tenant_id),
-- tách khỏi đăng ký để đơn vị đăng ký không đọc được đánh giá qua bảng của mình.
CREATE TABLE app_facilities_commune.request_assessments (
    request_id  uuid PRIMARY KEY REFERENCES app_facilities_commune.receive_requests (id) ON DELETE RESTRICT,
    tenant_id   text NOT NULL REFERENCES core.tenants (id) ON DELETE RESTRICT,
    purpose_fit text NOT NULL CHECK (purpose_fit IN ('fit', 'unfit')),
    area_fit    text NOT NULL CHECK (area_fit IN ('fit', 'unfit')),
    note        text CHECK (length(note) <= 2000),
    assessed_by text NOT NULL CHECK (assessed_by <> ''),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Hạn mới nhất của bước công khai của một hồ sơ, kèm xã của hồ sơ; không có dòng thì hồ sơ chưa từng vào bước đó.
-- Tên quy trình và bước là của BPMN trong gói này.
CREATE FUNCTION app_facilities_commune.publication_of(p_case text, OUT tenant_id text, OUT opened_at timestamptz,
                                                     OUT due_at timestamptz)
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
    SELECT d.tenant_id, d.recorded_at, d.due_at
    FROM core.case_deadlines d
    WHERE d.case_id = p_case AND d.process = 'facilities-review' AND d.activity_id = 'publication'
    ORDER BY d.due_at DESC
    LIMIT 1
$$;

-- Lỗi mang mã check_violation: Hasura chép thông điệp sau "Check constraint violation." nên người gửi đọc được lý do
-- (platform/web/src/formInsert.ts).
CREATE FUNCTION app_facilities_commune.open_notice() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    owner text;
    opened timestamptz;
    due timestamptz;
BEGIN
    SELECT p.tenant_id, p.opened_at, p.due_at INTO owner, opened, due
    FROM app_facilities_commune.publication_of(NEW.case_id) p;
    -- tenant của hồ sơ suy ra từ dòng hạn của lõi; tenant_id do quyền Hasura đặt từ token, nên khác nhau là người của
    -- xã khác đăng tin cho hồ sơ không phải của mình.
    IF owner IS NULL OR owner <> NEW.tenant_id THEN
        RAISE EXCEPTION 'Hồ sơ này chưa vào bước công khai của xã bạn: chỉ đăng tin cho hồ sơ đang công khai.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF now() >= due THEN
        RAISE EXCEPTION 'Đã hết thời hạn công khai của hồ sơ này: không đăng tin sau hạn.'
            USING ERRCODE = 'check_violation';
    END IF;
    NEW.opened_at := opened;
    NEW.due_at := due;
    SELECT f.address INTO NEW.address
    FROM app_facilities_commune.facilities f
    WHERE f.tenant_id = NEW.tenant_id AND f.id = NEW.facility_id;
    RETURN NEW;
END
$$;
CREATE TRIGGER open_notice BEFORE INSERT ON app_facilities_commune.notices
    FOR EACH ROW EXECUTE FUNCTION app_facilities_commune.open_notice();

-- Nhận đăng ký chỉ khi now() trước hạn của lõi, và chỉ từ xã đăng tin, xã cùng tỉnh hay chính tỉnh. Phép so tenant cha
-- bằng `=`: tỉnh khác không có cha, NULL không bằng gì, nên không bao giờ lọt.
CREATE FUNCTION app_facilities_commune.accept_request() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
    due timestamptz;
    owner_parent text;
    own_parent text;
BEGIN
    SELECT p.due_at INTO due FROM app_facilities_commune.publication_of(NEW.case_id) p;
    IF due IS NULL OR now() >= due THEN
        RAISE EXCEPTION 'Đã hết thời hạn công khai: không nhận đăng ký sau hạn.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT n.tenant_id INTO NEW.owner_tenant_id FROM app_facilities_commune.notices n WHERE n.case_id = NEW.case_id;
    IF NEW.owner_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Hồ sơ này chưa có tin công khai: chỉ đăng ký vào tin đã đăng.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT t.parent_id INTO owner_parent FROM core.tenants t WHERE t.id = NEW.owner_tenant_id;
    SELECT t.parent_id INTO own_parent FROM core.tenants t WHERE t.id = NEW.tenant_id;
    IF NOT coalesce(NEW.tenant_id = NEW.owner_tenant_id OR NEW.tenant_id = owner_parent OR own_parent = owner_parent,
                    false) THEN
        RAISE EXCEPTION 'Chỉ đơn vị trong cùng tỉnh với xã đăng tin đăng ký được; đơn vị tỉnh khác cần đề nghị của Chủ '
            'tịch UBND tỉnh, chưa hỗ trợ.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.tenant_id = NEW.owner_tenant_id AND NEW.unit_name IS NULL THEN
        RAISE EXCEPTION 'Đăng ký từ chính xã đăng tin phải ghi tên đơn vị thuộc xã có nhu cầu tiếp nhận.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER accept_request BEFORE INSERT ON app_facilities_commune.receive_requests
    FOR EACH ROW EXECUTE FUNCTION app_facilities_commune.accept_request();

-- Chỉ xã đăng tin ghi tiêu chí thứ nhất cho đăng ký vào tin của mình; tenant_id do quyền Hasura đặt từ token. Đổi
-- request_id khi sửa là chuyển đánh giá sang đăng ký khác, nên cũng bị chặn.
CREATE FUNCTION app_facilities_commune.check_assessment() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.request_id <> OLD.request_id THEN
        RAISE EXCEPTION 'Không chuyển đánh giá sang đăng ký khác.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app_facilities_commune.receive_requests r
                   WHERE r.id = NEW.request_id AND r.owner_tenant_id = NEW.tenant_id) THEN
        RAISE EXCEPTION 'Chỉ xã đăng tin ghi được tiêu chí phù hợp cho đăng ký vào tin của mình.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER check_assessment BEFORE INSERT OR UPDATE ON app_facilities_commune.request_assessments
    FOR EACH ROW EXECUTE FUNCTION app_facilities_commune.check_assessment();

-- Biểu mẫu sửa tin và sửa đánh giá so updated_at để không ghi đè lần sửa của người khác (ADR 0054).
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON app_facilities_commune.notices
    FOR EACH ROW EXECUTE FUNCTION app_facilities_commune.touch_updated_at();
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON app_facilities_commune.request_assessments
    FOR EACH ROW EXECUTE FUNCTION app_facilities_commune.touch_updated_at();

-- Người dùng ghi cả ba bảng qua Hasura, nên mọi thay đổi để lại nhật ký (ADR 0009).
SELECT core.audit_attach('app_facilities_commune.notices');
SELECT core.audit_attach('app_facilities_commune.receive_requests');
SELECT core.audit_attach('app_facilities_commune.request_assessments');

-- migrate:down
DROP TABLE app_facilities_commune.request_assessments;
DROP TABLE app_facilities_commune.receive_requests;
DROP TABLE app_facilities_commune.notices;
DROP FUNCTION app_facilities_commune.check_assessment();
DROP FUNCTION app_facilities_commune.accept_request();
DROP FUNCTION app_facilities_commune.open_notice();
DROP FUNCTION app_facilities_commune.publication_of(text);
DROP TABLE app_facilities_commune.priority_tiers;
