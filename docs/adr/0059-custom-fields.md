<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0059. Trường tùy chỉnh: giá trị jsonb, định nghĩa theo tenant gốc, CSDL kiểm

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27

## Bối cảnh

Quản trị của một org cần thêm thông tin cho bảng của gói mà gói không khai, ví dụ một trường lựa chọn bắt buộc cho
một loại bản ghi, mà không sửa tệp, không chạy migration. Giá trị phải được kiểm ở CSDL, vì API GraphQL nhận ghi trực
tiếp, không chỉ qua biểu mẫu.

Các cách đã xét:

- **Cột thật bằng DDL lúc chạy.** Kiểu, NOT NULL, lọc và sắp có sẵn. Nhưng một thao tác trên web phải chạy
  `ALTER TABLE` trên bảng của gói, đổi metadata Hasura và quyền theo cột. Vai trò Hasura của người dùng không được có
  quyền đó. Cột thêm ngoài migration cũng làm lệch lịch sử migration của gói (ADR 0005): gỡ gói, lùi migration không
  biết về chúng.
- **Bảng giá trị riêng (EAV), mỗi giá trị một dòng.** Kiểu kiểm được bằng cột theo kiểu. Nhưng đọc một bản ghi phải
  nối thêm một bảng, và quyền của bảng giá trị phải chép lại quyền theo dòng của từng bảng gói (phân công, tenant).
- **Một cột `custom jsonb` trên bảng của gói, trigger kiểm theo định nghĩa.** Giá trị đi cùng dòng nên quyền đọc,
  ghi chính là quyền của dòng. Hasura không đổi metadata khi thêm trường.

## Quyết định

Chọn cách thứ ba.

- **Gói bật cho bảng của mình** trong migration: `SELECT platform.custom_fields_attach('<lược đồ>.<bảng>', '<gói>')`.
  - Hàm thêm cột `custom jsonb NOT NULL DEFAULT '{}'` và trigger kiểm. Bảng được ghi vào
    `platform.custom_field_tables`.
  - Gói khai báo không tự viết được trigger (ADR 0022), nên nền tảng cung cấp hàm này, như `core.audit_attach`.
  - Phần down gọi `platform.custom_fields_detach(...)`: xóa định nghĩa của bảng (có nhật ký), trigger và cột.
  - Gói thêm `custom` vào cột select, insert, update ở `hasura/tables.yaml`.
  - Đã bật: cơ sở và phòng của `facilities-commune`, vật tư của `supplies-commune`.
- **Định nghĩa ở `platform.custom_fields`**, một bộ cho mỗi tenant gốc, áp cho mọi tenant con.
  - Cột: tenant gốc, gói, bảng, mã, nhãn, kiểu (`text`, `number`, `date`, `choice`), danh sách lựa chọn (mảng chuỗi,
    chỉ với `choice`), bắt buộc.
  - Mã, kiểu và bảng (`source`) bất biến: đổi thì giá trị đã ghi thành khóa lạ hay sai kiểu. Muốn đổi thì xóa trường, tạo
    trường mới.
  - Có nhật ký (ADR 0009), tenant ghi là tenant gốc.
- **Tenant gốc** lấy từ view `platform.tenant_roots`: đi ngược `parent_id` (ADR 0016) tới tenant không có cha.
  - Quyền Hasura đi qua một quan hệ tới view này. Không cần so nhiều tầng bằng `_or`, mà `make check-fast` không coi
    là lọc theo tenant.
  - Cấu hình khác đặt theo tenant gốc dùng lại view này.
- **Quyền (Hasura):**
  - Mọi tenant cùng gốc đọc định nghĩa (`user`, `tenant_admin`).
  - Chỉ `tenant_admin` của chính tenant gốc (tenant không có cha) thêm, sửa nhãn, lựa chọn, bắt buộc, và xóa.
  - Tenant gốc lấy từ token (`set`), không nhận từ dữ liệu gửi lên. CSDL cũng từ chối định nghĩa đặt ở tenant có cha.
- **Trigger kiểm `custom`** theo định nghĩa của tenant gốc của dòng. Sai thì trả `check_violation` kèm lời báo tiếng
  Việt, có nhãn và mã trường.
  - `custom` phải là đối tượng JSON. Khóa không có định nghĩa bị từ chối.
  - Kiểu được kiểm: chữ (tối đa 2000 ký tự), số JSON, ngày `YYYY-MM-DD` có thật, lựa chọn trong danh sách. `null` là
    ô bỏ trống.
  - Trường bắt buộc xét khi INSERT và khi `custom` đổi. Sửa cột khác của dòng cũ không bị chặn khi org vừa thêm một
    trường bắt buộc.
  - Khóa giữ nguyên giá trị so với trước không bị kiểm lại. Xóa một trường hay bỏ một lựa chọn vì vậy không khóa dòng
    cũ, nhưng không ghi được giá trị mới vào khóa đó.

## Hệ quả

- Org thêm trường mà không có DDL, không đổi metadata Hasura. Gỡ gói thì định nghĩa đi theo bảng.
- Giới hạn:
  - Chưa lọc, chưa sắp theo trường tùy chỉnh trong danh mục.
  - Không có quyền theo từng trường: ai đọc, ghi được dòng thì đọc, ghi được mọi trường tùy chỉnh của dòng.
  - Không có kiểu và ràng buộc của cột thật: không UNIQUE, không khóa ngoại, không chỉ mục theo trường.
  - Dòng cũ có thể còn giữ khóa của trường đã xóa. Giao diện bỏ qua khóa không có định nghĩa.
- Định nghĩa gắn với bảng bằng `source`, tên GraphQL của bảng (`<lược đồ>_<bảng>`), là chuỗi mà cấu hình danh mục, biểu
  mẫu đã có: giao diện đọc `platform_custom_fields` lọc theo `source` và thêm trường bằng chính chuỗi đó.
- **Giao diện** (`customFields.ts`, `CustomFieldsDialog.tsx`):
  - Định nghĩa đọc như một kênh riêng, không trộn vào `fields` của cấu hình gói. Bảng có định nghĩa thì câu đọc thêm cột
    `custom`; câu đọc dòng chờ định nghĩa về trước để không đọc hai lần.
  - Danh mục (bảng, thẻ), chi tiết và tệp xuất có thêm cột, ô sau các trường của gói. Biểu mẫu sửa, thêm dòng có thêm
    ô theo kiểu; lệnh sửa gộp giá trị lên `custom` vừa đọc lại và chỉ gửi khi một ô tùy chỉnh đổi.
  - Lời từ chối của trigger hiện nguyên lý do, cả ở biểu mẫu của gói.
  - Quản trị org định nghĩa trường trong hộp thoại "Trường tùy chỉnh" mở từ danh sách ngoài cùng của danh mục. Hộp thoại
    liệt kê mọi bảng của danh mục vì trình duyệt không đọc được `platform.custom_field_tables`; bảng chưa bật bị khóa
    ngoại từ chối, lời báo nói rõ.
  - Kanban, Lịch và nạp từ tệp chưa có trường tùy chỉnh; trường bắt buộc làm mọi dòng của tệp nạp bị từ chối.
- `make smoke` chạy `platform/schema/tests/custom_fields.sql` (trigger, ràng buộc, tenant gốc, trong giao dịch rồi
  ROLLBACK). Smoke của `facilities-commune` kiểm quyền qua cổng (`tests/custom-fields.sh`).
