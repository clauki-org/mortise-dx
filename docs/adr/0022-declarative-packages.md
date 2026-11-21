<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0022. Gói chỉ gồm tệp khai báo: danh sách tệp được phép, dữ liệu demo nạp bằng bộ nạp chung

- Trạng thái: Chấp nhận
- Ngày: 2026-11-21

## Bối cảnh

[ADR 0003](0003-three-tier-layout.md) đặt gói Tầng 3 là cấu hình cho một lĩnh vực, ưu tiên khai báo. Gói đầu tiên,
`apps/facilities-commune`, đã khai báo phần lớn: lược đồ, quyền Hasura, danh mục, quy trình, luật ngưỡng. Nhưng nó
vẫn có mã riêng: bộ nạp dữ liệu demo `seed/load.py` và bài kiểm `tests/smoke.sh`. Muốn cho thấy nền tảng đủ để làm
một gói mà không viết mã, cần một gói không có tệp mã nào và một bước kiểm giữ nó như vậy (#112).

Ba việc phải quyết:

- **Thế nào là "không có mã".** Danh sách đuôi tệp bị cấm (`.py`, `.sh`, `.js`...) luôn thiếu: thêm một ngôn ngữ là
  lọt. Tệp `.sql` cũng chạy được mã trong CSDL (hàm, trigger, khối `DO`), dù đuôi tệp trông như khai báo.
- **Dữ liệu demo nạp bằng gì.** Thành phần danh mục chỉ đọc (`contracts/catalog.component.yaml`), nên gói không có
  dữ liệu thì trang trống. Mỗi gói tự viết bộ nạp như `facilities-commune` là mã trong gói.
- **Bài kiểm của gói đặt ở đâu.** Bài kiểm qua cổng là một script; không có nó thì CI không biết gói có chạy đúng
  không.

## Quyết định

**Danh sách tệp được phép, không phải danh sách bị cấm.** `scripts/check-declarative.sh`, gọi từ `make check-fast`
cho mỗi gói trong biến `DECLARATIVE_APPS` của Makefile, chỉ nhận:

- `app.yaml` và tệp `*.yaml` khác (cấu hình thành phần, khai báo bước, luật, dữ liệu demo, quyền Hasura);
- `*.md` (tài liệu);
- `*.bpmn20.xml` (quy trình) không có `scriptTask`, `serviceTask`, `sendTask`, `businessRuleTask`, listener hay
  thuộc tính `flowable:class`, `flowable:delegateExpression`, `flowable:expression`: các phần này chạy mã trong
  Flowable;
- `*.sql` chỉ trong thư mục migration mà `app.yaml` khai, và không có `CREATE FUNCTION`, `CREATE PROCEDURE`,
  `CREATE TRIGGER`, `CREATE RULE` hay khối `DO`. Gói vẫn gọi được hàm có sẵn của lõi như `core.audit_attach`.

Mọi tệp phải là tệp thường (không phải liên kết tượng trưng), không có bit thực thi hay dòng shebang. Thêm một loại tệp khai báo mới (ví dụ GeoJSON cho bản đồ) là sửa
danh sách này trong pull request đầu tiên cần nó.

**Thư mục `tests/` không bị kiểm.** Bộ cài gói (`scripts/app.sh`) không đọc `tests/`; chỉ CI và người phát triển
chạy nó. Bài kiểm của gói vẫn là `tests/smoke.sh`, gọi bằng `make app-smoke`, như gói đầu tiên.

**Dữ liệu demo là tệp khai báo, nạp bằng bộ nạp chung.** Gói không có `seed/load.py` khai dữ liệu demo ở
`seed/demo.yaml` theo `contracts/seed.schema.json`: mỗi tenant một tài khoản quản trị, mỗi bảng danh sách dòng và
các cột khóa. `make seed-demo` nạp tệp này bằng `scripts/app-seed.py`: qua cổng, bằng GraphQL với vai trò
`tenant_admin`, `tenant_id` do Hasura gán từ token, dòng trùng khóa giữ nguyên. Bảng con nối về bảng cha bằng mã
(cột chữ) thay vì `id` sinh tự động, để tệp dữ liệu không phải biết `id` của dòng cha. Gói đã có `seed/load.py` giữ
bộ nạp riêng.

**Danh sách gói phải kiểm nằm trong Makefile**, không thành trường trong `app.yaml`. Thêm trường là đổi hợp đồng
`contracts/app.schema.json` cho một điều chỉ CI đọc; gói đầu tiên có mã riêng nên không nằm trong danh sách.

## Hệ quả

- Gói khai báo không thể tự cập nhật dữ liệu khi quy trình chạy xong (ví dụ trừ số lượng khi một đề nghị được
  duyệt): việc đó cần mã. Nó phải chờ một thành phần dùng chung làm được, không viết trong gói.
- Bộ nạp chung chỉ thêm dòng, không sửa dòng đã có: đổi giá trị trong `seed/demo.yaml` không đổi dữ liệu đã nạp.
- Bộ nạp chung không biết quan hệ giữa các bảng; thứ tự bảng trong tệp quyết định thứ tự nạp, bảng cha phải đứng
  trước.
- Biểu thức điều kiện trên nhánh rẽ của BPMN (`${...}`) vẫn được dùng vì cổng rẽ nhánh cần nó; biểu thức này do
  Flowable tính, nên một biểu thức gọi phương thức vẫn lọt bước kiểm. Người duyệt pull request xem phần này.
- `make seed-demo` không có `APP=` nạp mọi gói có dữ liệu demo và dừng ở gói đầu tiên chưa cài; `APP=<gói>` nạp
  riêng một gói.
- Bước kiểm SQL đọc văn bản, không phân tích cú pháp; chú thích khối `/* */` có chữ như `CREATE FUNCTION` sẽ bị báo
  nhầm. Chú thích trong migration của gói viết bằng `--`.
