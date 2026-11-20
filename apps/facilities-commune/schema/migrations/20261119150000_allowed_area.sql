-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Diện tích được phép theo tiêu chuẩn, định mức và phần vượt của từng xã. Căn cứ: Nghị định 155/2025/NĐ-CP sửa đổi,
-- bổ sung bởi Nghị định 369/2026/NĐ-CP (hiệu lực 11/11/2026); nguồn, ngày tải và SHA-256 của bản gốc ghi ở README
-- của gói. Ba phần của diện tích nhà làm việc (Điều 4 khoản 1 NĐ 155): làm việc của các chức danh (Điều 5), sử dụng
-- chung (Điều 6), chuyên dùng (Điều 7). Tiêu chuẩn tính trên tổng diện tích của mọi trụ sở xã đang dùng (Điều 3
-- khoản 3 NĐ 155, sửa bởi Điều 2 NĐ 369).

-- migrate:up

-- Phụ lục "Tiêu chuẩn, định mức sử dụng diện tích làm việc của các chức danh" ban hành kèm NĐ 369/2026/NĐ-CP, thay
-- Phụ lục I, Phụ lục II của NĐ 155 (Điều 10 khoản 4 NĐ 369). Một dòng mỗi STT, chức danh chép nguyên văn. Dữ liệu
-- chung cho mọi xã, không theo tenant, nên không đăng ký trong Hasura; xã đọc mức qua view staffing_allowances.
CREATE TABLE app_facilities_commune.working_area_norms (
    row_no  smallint PRIMARY KEY,
    title   text NOT NULL,
    -- NULL: "Được bố trí theo yêu cầu công tác" (STT 1, 2), không tính vào tổng (Điều 5 khoản 3, sửa bởi NĐ 369).
    max_m2  numeric(6, 2),
    source  text NOT NULL,
    -- Ghi chú của phụ lục, chép nguyên văn: mức của STT 3–8 đã gồm diện tích tiếp khách; thiếu ghi chú thì người
    -- xếp chức danh vào các dòng này dễ hiểu sai mức.
    note    text
);

INSERT INTO app_facilities_commune.working_area_norms (row_no, title, max_m2, source) VALUES
    (1, 'Tổng Bí thư, Chủ tịch nước, Thủ tướng Chính phủ, Chủ tịch Quốc hội, Thường trực Ban Bí thư.', NULL,
        'Phụ lục NĐ 369/2026/NĐ-CP, STT 1'),
    (2, 'Ủy viên Bộ Chính trị, Ủy viên Ban Bí thư, Chủ tịch Ủy ban Trung ương Mặt trận Tổ quốc Việt Nam, Chủ nhiệm '
        'Ủy ban Kiểm tra Trung ương, Trưởng ban đảng ở Trung ương, Chánh Văn phòng Trung ương Đảng, Giám đốc Học viện '
        'Chính trị quốc gia Hồ Chí Minh, Phó Chủ tịch nước, Phó Thủ tướng Chính phủ, Phó Chủ tịch Quốc hội, Chánh án '
        'Tòa án nhân dân tối cao, Viện trưởng Viện Kiểm sát nhân dân tối cao.', NULL,
        'Phụ lục NĐ 369/2026/NĐ-CP, STT 2'),
    (3, 'Các chức danh, chức vụ tại Nhóm II Danh mục vị trí chức danh, nhóm chức danh, chức vụ lãnh đạo của hệ thống '
        'chính trị ban hành kèm theo Quy định số 368-QĐ/TW (được điều chỉnh theo Kết luận số 31-KL/TW).', 65,
        'Phụ lục NĐ 369/2026/NĐ-CP, STT 3'),
    (4, 'Các chức danh, chức vụ tại Nhóm III Danh mục vị trí chức danh, nhóm chức danh, chức vụ lãnh đạo của hệ thống '
        'chính trị ban hành kèm theo Quy định số 368-QĐ/TW (được điều chỉnh theo Kết luận số 31-KL/TW).', 55,
        'Phụ lục NĐ 369/2026/NĐ-CP, STT 4'),
    (5, 'Các chức danh, chức vụ tại Bậc 1 Nhóm IV Danh mục vị trí chức danh, nhóm chức danh, chức vụ lãnh đạo của hệ '
        'thống chính trị ban hành kèm theo Quy định số 368-QĐ/TW (được điều chỉnh theo Kết luận số 31-KL/TW).', 50,
        'Phụ lục NĐ 369/2026/NĐ-CP, STT 5'),
    (6, 'Các chức danh, chức vụ tại Bậc 2 Nhóm IV Danh mục vị trí chức danh, nhóm chức danh, chức vụ lãnh đạo của hệ '
        'thống chính trị ban hành kèm theo Quy định số 368-QĐ/TW (được điều chỉnh theo Kết luận số 31-KL/TW).', 45,
        'Phụ lục NĐ 369/2026/NĐ-CP, STT 6'),
    (7, 'Các chức danh, chức vụ tại Bậc 3, Bậc 4 Nhóm IV Danh mục vị trí chức danh, nhóm chức danh, chức vụ lãnh đạo '
        'của hệ thống chính trị ban hành kèm theo Quy định số 368-QĐ/TW (được điều chỉnh theo Kết luận số 31-KL/TW).',
        40, 'Phụ lục NĐ 369/2026/NĐ-CP, STT 7'),
    (8, 'Các chức danh, chức vụ tại Bậc 5, Bậc 6 Nhóm IV Danh mục vị trí chức danh, nhóm chức danh, chức vụ lãnh đạo '
        'của hệ thống chính trị ban hành kèm theo Quy định số 368-QĐ/TW (được điều chỉnh theo Kết luận số 31-KL/TW).',
        30, 'Phụ lục NĐ 369/2026/NĐ-CP, STT 8'),
    (9, '- Các chức danh, chức vụ tại Bậc 7, Bậc 8, Bậc 9, Bậc 10 Nhóm IV Danh mục vị trí chức danh, nhóm chức danh, '
        'chức vụ lãnh đạo của hệ thống chính trị ban hành kèm theo Quy định số 368-QĐ/TW (được điều chỉnh theo Kết '
        'luận số 31-KL/TW). - Chuyên viên cao cấp, chuyên viên chính và các chức danh tương đương.', 20,
        'Phụ lục NĐ 369/2026/NĐ-CP, STT 9'),
    (10, '- Chuyên viên và các chức danh tương đương. - Cán sự và các chức danh tương đương. - Nhân viên. - Cá nhân ký '
        'hợp đồng lao động theo quy định của Chính phủ về hợp đồng thực hiện công việc trong đơn vị sự nghiệp công '
        'lập.', 15, 'Phụ lục NĐ 369/2026/NĐ-CP, STT 10');

UPDATE app_facilities_commune.working_area_norms SET note =
    'Đối với chức danh từ STT 3 đến STT 4 thì diện tích tối đa nêu trên bao gồm diện tích làm việc, diện tích tiếp '
    'khách, ngoài ra các chức danh này được bố trí diện tích cần thiết khác (nếu có) và diện tích này không tính vào '
    'tổng diện tích của cơ quan, tổ chức, đơn vị quy định tại khoản 3 Điều 5 Nghị định này.'
WHERE row_no BETWEEN 3 AND 4;
UPDATE app_facilities_commune.working_area_norms SET note =
    'Đối với chức danh từ STT 5 đến STT 8 thì diện tích tối đa nêu trên bao gồm diện tích làm việc, diện tích tiếp '
    'khách.'
WHERE row_no BETWEEN 5 AND 8;

-- Biên chế được giao của xã theo chức danh (Điều 5 khoản 2 NĐ 155). Chức danh nào thuộc STT nào của phụ lục do xã
-- xác định theo Quy định 368-QĐ/TW hoặc văn bản của cấp có thẩm quyền (Điều 3 khoản 2, sửa bởi NĐ 369); gói không
-- tự suy ra, vì phụ lục không ghi tên chức danh cấp xã.
CREATE TABLE app_facilities_commune.staffing (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text NOT NULL REFERENCES core.tenants (id) ON DELETE RESTRICT,
    position   text NOT NULL,
    norm_row   smallint NOT NULL REFERENCES app_facilities_commune.working_area_norms (row_no),
    headcount  integer NOT NULL CHECK (headcount > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, position)
);

-- Diện tích chuyên dùng do cấp có thẩm quyền quyết định (Điều 7 NĐ 155); ghi kèm căn cứ (số quyết định).
CREATE TABLE app_facilities_commune.specialized_allowances (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text NOT NULL REFERENCES core.tenants (id) ON DELETE RESTRICT,
    name       text NOT NULL,
    area_m2    numeric(10, 2) NOT NULL CHECK (area_m2 > 0),
    basis      text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

SELECT core.audit_attach('app_facilities_commune.staffing');
SELECT core.audit_attach('app_facilities_commune.specialized_allowances');

-- Mức của từng dòng biên chế kèm trích dẫn, để người dùng và trợ lý đọc mức m² từ cùng một nguồn với công thức.
CREATE VIEW app_facilities_commune.staffing_allowances AS
SELECT s.tenant_id, s.position, s.headcount, n.row_no AS norm_row, n.title AS norm_title, n.max_m2,
       coalesce(s.headcount * n.max_m2, 0) AS allowed_m2, n.source, n.note AS norm_note
FROM app_facilities_commune.staffing s
JOIN app_facilities_commune.working_area_norms n ON n.row_no = s.norm_row;

-- Một dòng mỗi xã. Sử dụng chung tối đa bằng 100% diện tích làm việc (Điều 6 khoản 2 điểm a, sửa bởi Điều 6 NĐ 369);
-- phần bù theo diện tích tối thiểu của Tiêu chuẩn quốc gia (điểm b) chưa tính. Thực tế chỉ cộng phòng của cơ sở
-- đang dùng; cơ sở dôi dư tính riêng, không vào phần vượt.
CREATE VIEW app_facilities_commune.area_summary AS
WITH working AS (
    SELECT tenant_id, sum(allowed_m2) AS m2 FROM app_facilities_commune.staffing_allowances GROUP BY tenant_id
), specialized AS (
    SELECT tenant_id, sum(area_m2) AS m2 FROM app_facilities_commune.specialized_allowances GROUP BY tenant_id
), actual AS (
    SELECT r.tenant_id,
           sum(r.clear_area_m2) FILTER (WHERE f.status = 'in_use') AS in_use_m2,
           sum(r.clear_area_m2) FILTER (WHERE f.status = 'surplus') AS surplus_m2
    FROM app_facilities_commune.rooms r
    JOIN app_facilities_commune.buildings b ON b.tenant_id = r.tenant_id AND b.id = r.building_id
    JOIN app_facilities_commune.facilities f ON f.tenant_id = b.tenant_id AND f.id = b.facility_id
    GROUP BY r.tenant_id
), totals AS (
    SELECT t.id AS tenant_id,
           coalesce(w.m2, 0) AS working_allowed_m2,
           coalesce(w.m2, 0) AS shared_allowed_m2,
           coalesce(s.m2, 0) AS specialized_allowed_m2,
           coalesce(a.in_use_m2, 0) AS in_use_m2,
           coalesce(a.surplus_m2, 0) AS surplus_m2
    FROM core.tenants t
    LEFT JOIN working w ON w.tenant_id = t.id
    LEFT JOIN specialized s ON s.tenant_id = t.id
    LEFT JOIN actual a ON a.tenant_id = t.id
)
SELECT tenant_id, working_allowed_m2, shared_allowed_m2, specialized_allowed_m2,
       working_allowed_m2 + shared_allowed_m2 + specialized_allowed_m2 AS allowed_m2,
       in_use_m2, surplus_m2,
       greatest(in_use_m2 - (working_allowed_m2 + shared_allowed_m2 + specialized_allowed_m2), 0) AS excess_m2
FROM totals;

-- migrate:down
DROP VIEW app_facilities_commune.area_summary;
DROP VIEW app_facilities_commune.staffing_allowances;
DROP TABLE app_facilities_commune.specialized_allowances;
DROP TABLE app_facilities_commune.staffing;
DROP TABLE app_facilities_commune.working_area_norms;
