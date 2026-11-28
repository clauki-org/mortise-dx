<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Một gói gồm những gì

Tóm tắt cách các tệp của một gói nối với nhau, cho người viết gói và cho trợ lý soạn bản nháp cấu hình gói
([ADR 0071](adr/0071-package-config-drafts.md)), dịch vụ đó đọc nguyên văn tệp này. Luật chi tiết của từng tệp nằm ở
`contracts/`; lý do của bố cục ở [ADR 0022](adr/0022-declarative-packages.md) và
[ADR 0061](adr/0061-block-composition.md).

## Tệp và cách nối

- Gói là thư mục `apps/<id>/`; `id` trong `app.yaml` trùng tên thư mục.
- `app.yaml` (`contracts/app.schema.json`) khai tên, phiên bản, lược đồ CSDL, quy trình, menu và khối của gói.
- Mỗi mục `menu` có `id`, `label`, `component` (tên một thành phần Tầng 2) và `config`: đường dẫn tới tệp cấu hình
  của mục, viết theo `contracts/<component>.schema.json`. Thành phần đọc tệp đó để vẽ màn hình; gói không có mã giao
  diện.
- Mục `blocks` có cùng dạng nhưng không lên menu: khối chỉ hiện trên một trang (thành phần `page`) của chính gói, trang
  trỏ tới khối hay mục menu bằng `id`. `id` của mục menu và khối không trùng nhau.
- Bảng của gói nằm trong lược đồ `database.schema` (bắt đầu bằng `app_`), tạo bằng migration trong thư mục
  `database.migrations`. Cấu hình thành phần đọc bảng qua GraphQL bằng tên `<lược đồ>_<bảng>`, ví dụ bảng `stores`
  của lược đồ `app_supplies_commune` là `app_supplies_commune_stores`.
- Quyền đọc, ghi từng bảng khai trong thư mục `hasura`; mọi quyền lọc theo tenant trong token.
- Quy trình là tệp BPMN khai ở `workflows`. Biểu mẫu (`submit.process`) và nút trên chi tiết danh mục
  (`detail.actions[].process`) khởi tạo quy trình bằng khóa của nó trong tệp BPMN của chính gói.

## Chữ cho máy và chữ cho người

- Chữ máy đọc viết chữ thường không dấu, số và gạch: `id` của gói, mục menu, khối; đường dẫn tệp; tên lược đồ, bảng,
  cột, trường; khóa quy trình; giá trị lưu của một lựa chọn. Chúng nằm trong đường dẫn, câu truy vấn và CSDL;
  `contracts/` chỉ nhận ký tự ASCII ở mọi chỗ trên trừ giá trị lựa chọn, giá trị đó phải trùng đúng từng chữ với dữ
  liệu trong bảng.
- Chữ người dùng đọc trên màn hình viết tiếng Việt chuẩn, có dấu, đúng chính tả: `name`, `description` của gói;
  `label`, `title`, `description`, `message` của mục menu, cột, trường, nút; nhãn của một lựa chọn. `contracts/`
  nhận mọi chữ Unicode ở đó.

## Kiểm và cài

- `make check-fast` kiểm mọi gói: schema của từng tệp, luật nhiều tệp của `app.yaml` (tệp được khai có thật, `id` không
  trùng), cấu hình thành phần với BPMN và quyền Hasura của gói.
- `make app-install APP=<id>` kiểm lại như trên, chạy migration, nạp quyền Hasura, quy trình và menu.
