<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0054. Sửa dòng và thêm dòng con từ màn hình danh mục, so cột version để không ghi đè

- Trạng thái: Đề xuất
- Ngày: 2026-11-27

## Bối cảnh

Danh mục chỉ đọc ([ADR 0023](0023-package-pages-in-the-web-shell.md)). Cơ sở, tòa, phòng chỉ vào được qua dữ liệu
demo hay gọi thẳng GraphQL, dù quyền insert, update của gói xã đã có trong `hasura/tables.yaml`. Biểu mẫu
([ADR 0030](0030-form-component.md)) chỉ khởi tạo quy trình hay thêm một dòng từ menu; nó không biết dòng nào đang
được xem.

Ví dụ: cán bộ phụ trách mở cơ sở "TS-A1", bấm "Sửa", đổi địa chỉ rồi lưu. Cùng lúc một người khác đã sửa cơ sở đó.
Lần lưu thứ hai phải được báo, không được ghi đè. Ở bảng "Tòa nhà" bấm "Thêm tòa": mã cơ sở điền sẵn, không sửa được.

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Biểu mẫu nằm ở đâu | Mục menu `form` riêng, danh mục trỏ tới bằng id | Mục hiện trên menu mà mở từ menu thì không có dòng nào để sửa |
| | Tệp `forms/*.yaml`, danh mục trỏ tới bằng đường dẫn | Bộ cài phải ghép tệp vào cấu hình của mục menu; cấu hình lưu khác cấu hình đã kiểm |
| | Khai ngay trong cấu hình danh mục, `$ref` tới `form.schema.json` | Một nguồn, một dạng; giống cách `detail.documents` trỏ tới `documents.schema.json` |
| Phát hiện hai người sửa | So mọi cột đọc lúc mở với giá trị hiện tại | Câu where dài theo số trường, cột numeric so dạng chữ dễ lệch |
| | Cột `updated_at` do trigger đặt, nằm trong where của lệnh update | Một cột; CSDL đặt nên lệnh sửa từ nơi khác cũng làm giá trị đổi |
| Vai trò của lệnh ghi | Theo vai trò mạnh nhất của token | Không đoán trước được; check-fast không biết kiểm vai trò nào |
| | `form.role`, mặc định `user`, header luôn gửi | Như ADR 0030; check-fast kiểm đúng vai trò đó |

## Quyết định

- **Hợp đồng `form` có thêm đích `submit.update`** (đúng một trong `process`, `insert`, `update`), đi cùng
  `submit.version` là cột thời điểm sửa cuối. Biểu mẫu sửa chỉ mở được từ màn hình chi tiết của danh mục; đặt trên
  menu thì trang báo cấu hình sai, `make check-fast` cũng báo.
- **Hợp đồng `catalog` có `detail.edit` và `add` của đối tượng con**, mỗi nút gồm chữ trên nút và một biểu mẫu theo
  `contracts/form.schema.json`, khai ngay trong tệp danh mục. Nút sửa nằm ở chỗ việc chính của đầu trang, cạnh nút
  khởi tạo quy trình. Nút thêm đứng cạnh tiêu đề bảng con. Biểu mẫu mở trong hộp thoại.
- **Sửa:**
  - Lúc mở, biểu mẫu đọc lại dòng theo khóa bằng vai trò của biểu mẫu (`network-only`): khóa, các trường và cột
    version. Không lấy dòng của màn hình chi tiết, vì dòng đó có thể đã cũ.
  - Giá trị version giữ nguyên chuỗi Hasura trả, không đổi qua `Date` (mất phần micro giây).
  - Gửi `update_<bảng>(where: {khóa, version}, _set: …)` chỉ với cột đã đổi; ô bị xóa trắng gửi `null`; không đổi gì
    thì không gửi.
  - Lệnh không khớp dòng nào thì hiện "Dòng này đã có người sửa hoặc bạn không còn quyền sửa", đọc lại dòng và điền
    lại giá trị mới. Hai lý do (người khác đã sửa, quyền theo dòng không còn cho sửa) không tách được qua một lệnh
    update, nên cùng một lời báo.
- **Thêm dòng con:** cột `via` nhận khóa của dòng cha. Cột này không là trường của biểu mẫu nên không sửa được; hộp
  thoại hiện một ô chỉ đọc mang giá trị của dòng cha (`add.parent`, bỏ trống là tiêu đề), nhãn là tên bảng cha.
- **Vai trò:** mọi lệnh đọc, ghi của biểu mẫu gửi `X-Hasura-Role: form.role` (bỏ trống là `user`), như ADR 0030. Nút
  chỉ hiện khi token có vai trò đó. Đây chỉ là lối vào; Hasura vẫn là nơi chặn cuối.
- **Kiểm theo gói lúc `make check-fast`** (`scripts/check-form-config.py`, chạy cho mọi gói, đọc cả biểu mẫu trong
  danh mục):
  - Biểu mẫu sửa trỏ đúng bảng của danh sách. Mọi trường nằm trong cột của quyền update của vai trò, không trường nào
    là cột tenant hay cột version.
  - Vai trò đọc được khóa, cột version và mọi trường. Hasura chỉ cho where dùng cột vai trò đọc được.
  - Cột version không nằm trong quyền update.
  - Biểu mẫu thêm dòng con trỏ đúng bảng con, vai trò ghi được cột `via`, `via` không là trường.
  - Biểu mẫu trong danh mục không dùng `done.menu`.
  - `scripts/form_permissions.py` đọc thêm `update_permissions`.
  - Thành phần kiểm lại lúc chạy mọi tên nó ghép vào câu GraphQL.
- **Gói xã:**
  - Migration `20261127180000_row_updated_at.sql` thêm `updated_at timestamptz NOT NULL DEFAULT now()` cho cơ sở, tòa,
    phòng. Trigger `BEFORE UPDATE` đặt cột bằng `clock_timestamp()`; nhật ký (trigger AFTER) giữ nguyên và ghi cả giá
    trị mới.
  - Cột này nằm trong quyền đọc của mọi vai trò, không nằm trong quyền ghi.
  - Danh mục có ba nút sửa (cơ sở, tòa, phòng) và hai nút thêm (tòa, phòng), vai trò `user`. Quyền của vai trò này
    chỉ cho cán bộ phụ trách (custodian) ghi.

## Hệ quả

- Gói thêm nút sửa, thêm dòng con cho một loại đối tượng bằng một cột version, một trigger và vài dòng cấu hình,
  không viết giao diện.
- Người duyệt được phân công (approver) có vai trò `user` nên thấy nút "Sửa". Lần lưu của họ không khớp dòng nào và
  nhận lời báo trên.
- Ở gói xã, quản trị xã (`tenant_admin`) chỉ thấy cơ sở trên danh mục khi được phân công, vì danh mục đọc bằng vai trò
  `user` ([ADR 0041](0041-documents-on-catalog-records.md)). Biểu mẫu khai `role: user` nên quản trị xã chưa phân
  công không sửa được từ danh mục.
- Thêm cơ sở mới (chỉ `tenant_admin` có quyền) và biểu mẫu phân công (cần danh bạ người dùng) chưa có.
- Biểu mẫu thêm dòng không có Idempotency-Key, như ADR 0030.
- Cấu hình danh mục dài hơn vì biểu mẫu khai lồng; gói dùng YAML anchor khi biểu mẫu thêm và sửa có cùng trường.
- **Chưa kiểm** khi ghi quyết định này: hộp thoại trên trình duyệt thật, `e2e/catalog-edit.spec.ts` (sửa, sửa đồng
  thời, thêm tòa), axe, smoke của gói sau migration. Kiểm tự động đã chạy: `make check-fast` (schema, ví dụ sai, luật
  theo gói) và `make web-check` (câu truy vấn, cột đã đổi, lời báo, nút hiện theo vai trò).
