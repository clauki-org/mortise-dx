-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Đọc chéo xã cho tin công khai và đăng ký nhận (ADR 0069): mỗi view nhân một dòng thành nhiều dòng, mỗi dòng một tenant
-- được đọc (reader_tenant_id). Quyền Hasura chỉ so reader_tenant_id với tenant của token, vì scripts/hasura-metadata.py
-- không nhận `_or`. Thêm cột hay thêm người đọc ở đây là mở dữ liệu cho tenant khác, nên phải review như đổi quyền.
-- Mẫu tin công khai sinh ở đây từ dữ liệu của tin, không tính trên trình duyệt.

-- migrate:up
-- Số kiểu Việt Nam: dấu chấm ngăn nghìn, dấu phẩy thập phân, hai chữ số sau dấu phẩy như cột numeric(12, 2).
CREATE FUNCTION app_facilities_commune.vn_number(value numeric) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$ SELECT translate(to_char(value, 'FM999,999,999,990.00'), ',.', '.,') $$;

-- Giờ Việt Nam: gói phục vụ đơn vị hành chính Việt Nam, cổng tỉnh đăng giờ theo múi này.
CREATE FUNCTION app_facilities_commune.vn_time(value timestamptz) RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$ SELECT to_char(value AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI "ngày" DD/MM/YYYY') $$;

-- Mẫu tin công khai: đủ năm nội dung của NĐ 155/2025/NĐ-CP Điều 3a khoản 3 điểm a, thời hạn, nội dung văn bản đề nghị
-- theo điểm b, nơi đăng tải theo luật. Cùng dữ liệu thì cùng chữ (không có mô hình ngôn ngữ nào tham gia).
CREATE FUNCTION app_facilities_commune.notice_text(n app_facilities_commune.notices, owner_name text,
                                                   facility_name text) RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$
    SELECT concat_ws(E'\n',
        'THÔNG TIN VỀ PHẦN DIỆN TÍCH DỰ KIẾN BỐ TRÍ CHO CƠ QUAN, TỔ CHỨC, ĐƠN VỊ CÓ NHU CẦU TIẾP NHẬN',
        'Căn cứ: Điều 3a khoản 3 Nghị định số 155/2025/NĐ-CP (bổ sung bởi Điều 3 Nghị định số 369/2026/NĐ-CP).',
        '',
        'Đơn vị tiếp nhận: ' || owner_name,
        'Cơ sở: ' || facility_name,
        '1. Địa chỉ trụ sở làm việc, cơ sở hoạt động sự nghiệp: ' || coalesce(n.address, '(cơ sở chưa ghi địa chỉ)'),
        '2. Công năng sử dụng: ' || n.usage,
        '3. Phần diện tích dự kiến bố trí cho đơn vị có nhu cầu tiếp nhận: '
            || app_facilities_commune.vn_number(n.offered_m2) || ' m²',
        '4. Sơ đồ mặt bằng hoặc tài liệu thể hiện hiện trạng bố trí sử dụng: ' || n.layout,
        '5. Thông tin khác: ' || coalesce(n.other_info, 'không có'),
        '',
        'Thời hạn đăng tải: từ ' || app_facilities_commune.vn_time(n.opened_at) || ' đến '
            || app_facilities_commune.vn_time(n.due_at) || '.',
        'Trong thời hạn đăng tải, cơ quan, tổ chức, đơn vị có nhu cầu tiếp nhận gửi văn bản đề nghị đến đơn vị tiếp '
            || 'nhận, thuyết minh rõ: mục đích sử dụng; diện tích theo tiêu chuẩn, định mức của đơn vị mình; diện tích '
            || 'đề nghị tiếp nhận và sự phù hợp giữa diện tích đề nghị tiếp nhận với diện tích dự kiến bố trí.',
        '',
        'Nơi đăng tải theo quy định: Cổng thông tin điện tử của Ủy ban nhân dân tỉnh'
            || coalesce(', ' || n.portal_url, ' (chưa ghi đường dẫn).'),
        'Bản này sinh từ dữ liệu của hồ sơ, là bản sao của tin trên cổng tỉnh.')
$$;

-- Người đọc một tin: xã đăng tin, các xã cùng cha (gồm chính nó) và tenant cha. So cha bằng `=`: tenant không có cha
-- (tỉnh khác) không khớp xã nào.
CREATE VIEW app_facilities_commune.notice_board AS
SELECT r.reader_tenant_id,
       n.case_id,
       n.tenant_id,
       o.name AS tenant_name,
       f.code AS facility_code,
       f.name AS facility_name,
       n.address,
       n.usage,
       n.offered_m2,
       n.layout,
       n.other_info,
       n.portal_url,
       n.opened_at,
       n.due_at,
       CASE WHEN now() < n.due_at THEN 'open' ELSE 'closed' END AS status,
       app_facilities_commune.notice_text(n, o.name, f.name) AS notice_text
FROM app_facilities_commune.notices n
JOIN core.tenants o ON o.id = n.tenant_id
JOIN app_facilities_commune.facilities f ON f.tenant_id = n.tenant_id AND f.id = n.facility_id
CROSS JOIN LATERAL (
    SELECT n.tenant_id
    UNION SELECT o.parent_id WHERE o.parent_id IS NOT NULL
    UNION SELECT s.id FROM core.tenants s WHERE s.parent_id = o.parent_id
) r (reader_tenant_id);

-- Đăng ký xếp theo thứ tự ưu tiên của điểm c. Tiêu chí thứ nhất đứng trước bậc: đăng ký người của xã đăng tin ghi là
-- phù hợp cả công năng lẫn diện tích, rồi đăng ký chưa ghi, rồi đăng ký có một mặt không phù hợp; không loại đăng ký
-- nào. Trong cùng mức đó, bậc nhỏ hơn trước (bảng priority_tiers), rồi đăng ký sớm hơn. Cách sắp này là diễn giải
-- "lọc theo tiêu chí 1 rồi xếp theo bậc"; văn bản không nói rõ (ADR 0069).
CREATE VIEW app_facilities_commune.request_board AS
WITH requests AS (
    SELECT r.id, r.case_id, r.owner_tenant_id, o.parent_id AS owner_parent_id, r.tenant_id, t.name AS tenant_name,
           coalesce(r.unit_name, t.name) AS unit, r.unit_name, r.purpose, r.requested_m2, n.offered_m2, n.usage,
           r.standard_m2, r.explanation, r.created_at, p.tier, p.label AS tier_label,
           a.purpose_fit, a.area_fit, a.note AS assessment_note,
           CASE WHEN a.request_id IS NULL THEN 1 WHEN a.purpose_fit = 'fit' AND a.area_fit = 'fit' THEN 0 ELSE 2 END
               AS fit_order
    FROM app_facilities_commune.receive_requests r
    JOIN app_facilities_commune.notices n ON n.case_id = r.case_id
    JOIN core.tenants o ON o.id = r.owner_tenant_id
    JOIN core.tenants t ON t.id = r.tenant_id
    -- accept_request chỉ nhận xã đăng tin, tenant cha và xã cùng cha, nên mọi dòng khác xã đăng tin là bậc cấp trên.
    JOIN app_facilities_commune.priority_tiers p
        ON p.relation = CASE WHEN r.tenant_id = r.owner_tenant_id THEN 'own_scope' ELSE 'superior_scope' END
    LEFT JOIN app_facilities_commune.request_assessments a ON a.request_id = r.id
), ranked AS (
    SELECT q.*, row_number() OVER (PARTITION BY q.case_id ORDER BY q.fit_order, q.tier, q.created_at, q.id) AS rank
    FROM requests q
)
-- deciding: xã đăng tin và tenant cha (người quyết định của tỉnh) thấy mọi đăng ký kèm thứ tự và đánh giá. Đơn vị đăng
-- ký khác chỉ thấy dòng của chính mình, không thấy thứ tự (lộ số đơn vị cạnh tranh) hay đánh giá.
SELECT v.reader_tenant_id,
       k.id, k.case_id, k.owner_tenant_id, k.tenant_id, k.tenant_name, k.unit, k.unit_name, k.purpose,
       k.requested_m2, k.offered_m2, k.usage, k.standard_m2, k.explanation, k.created_at, k.tier, k.tier_label,
       CASE WHEN v.deciding THEN k.rank END AS rank,
       CASE WHEN v.deciding THEN k.purpose_fit END AS purpose_fit,
       CASE WHEN v.deciding THEN k.area_fit END AS area_fit,
       CASE WHEN v.deciding THEN k.assessment_note END AS assessment_note,
       'Đề nghị ' || app_facilities_commune.vn_number(k.requested_m2) || ' m², dự kiến bố trí '
           || app_facilities_commune.vn_number(k.offered_m2) || ' m²' AS areas,
       -- Nhãn của ô chọn đơn vị nhận ở bước trình (workflows/facilities-review.yaml), và giá trị ghi vào hồ sơ: đọc
       -- được mà không cần mở CSDL, mang đủ thứ tự, bậc và tiêu chí thứ nhất lúc chọn.
       -- Chỉ người quyết định có nhãn này: nó mang thứ tự.
       CASE WHEN v.deciding THEN
           concat(k.rank, '. ', k.unit, CASE WHEN k.unit_name IS NOT NULL THEN ' (' || k.tenant_name || ')' END,
                  ': ', k.purpose, '; đề nghị ', app_facilities_commune.vn_number(k.requested_m2),
                  ' m², dự kiến bố trí ', app_facilities_commune.vn_number(k.offered_m2), ' m²; bậc ', k.tier,
                  '; tiêu chí 1: ',
                  CASE k.fit_order WHEN 0 THEN 'phù hợp' WHEN 1 THEN 'chưa ghi' ELSE 'không phù hợp' END,
                  '; mã ', left(k.id::text, 8))
       END AS choice
FROM ranked k
CROSS JOIN LATERAL (
    SELECT k.owner_tenant_id, true
    UNION SELECT k.owner_parent_id, true WHERE k.owner_parent_id IS NOT NULL
    UNION SELECT k.tenant_id, false WHERE k.tenant_id <> k.owner_tenant_id
                                     AND k.tenant_id IS DISTINCT FROM k.owner_parent_id
) v (reader_tenant_id, deciding);

-- Hồ sơ của xã đang ở bước công khai mà chưa có tin: danh sách chọn của biểu mẫu đăng tin (forms/notice.yaml). Hồ sơ
-- chỉ mang mã trong lõi, không mang tên cơ sở, nên nhãn là phần đầu mã và hạn.
CREATE VIEW app_facilities_commune.publication_cases AS
SELECT d.tenant_id,
       d.case_id,
       max(d.due_at) AS due_at,
       'Hồ sơ ' || left(d.case_id, 8) || ', công khai đến ' || app_facilities_commune.vn_time(max(d.due_at)) AS label
FROM core.case_deadlines d
WHERE d.process = 'facilities-review' AND d.activity_id = 'publication'
  AND NOT EXISTS (SELECT 1 FROM app_facilities_commune.notices n WHERE n.case_id = d.case_id)
GROUP BY d.tenant_id, d.case_id
HAVING now() < max(d.due_at);

-- migrate:down
DROP VIEW app_facilities_commune.publication_cases;
DROP VIEW app_facilities_commune.request_board;
DROP VIEW app_facilities_commune.notice_board;
DROP FUNCTION app_facilities_commune.notice_text(app_facilities_commune.notices, text, text);
DROP FUNCTION app_facilities_commune.vn_time(timestamptz);
DROP FUNCTION app_facilities_commune.vn_number(numeric);
