<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Gói kho (`supplies-commune`)

Gói Tầng 3 dùng chung, không gắn ngành: mỗi đơn vị là một tenant quản lý các kho của mình, mặt hàng trong từng kho,
phiếu nhập, phiếu xuất và tồn kho do CSDL tính; đề nghị cấp vật tư cần người duyệt của đơn vị. Cùng gói cài cho chính
quyền (các xã của "Tỉnh Mẫu") và cho doanh nghiệp (mẫu cài `dien-mat-troi` của #244). Gói chỉ gồm tệp khai báo,
không có mã chạy ([ADR 0022](../../docs/adr/0022-declarative-packages.md)): `make check-fast` kiểm vì gói nằm trong
`DECLARATIVE_APPS` của Makefile. Trang danh mục và các biểu mẫu trên giao diện dựng từ cấu hình của gói
([ADR 0023](../../docs/adr/0023-package-pages-in-the-web-shell.md)).

Mã gói, lược đồ và tên bảng giữ như bản đầu (gói kho vật tư xã) để bản cài, mẫu cài và kiểm thử đang trỏ tới chúng
không phải đổi; lý do ở [ADR 0062](../../docs/adr/0062-shared-warehouse-package.md).

## Bố cục

```
app.yaml             khai báo gói theo contracts/app.schema.json: lược đồ, Hasura, quy trình, menu
schema/migrations/   migration dbmate của gói; bảng theo dõi public.supplies_commune_schema_migrations (ADR 0005)
hasura/tables.yaml   bảng đăng ký và quyền theo tenant, cùng định dạng với core/hasura/
catalog/             cấu hình thành phần danh mục theo contracts/catalog.schema.json: kho → tồn kho, mặt hàng;
                     phiếu nhập → dòng hàng; phiếu xuất → dòng hàng
forms/               biểu mẫu lập đề nghị, lập phiếu nhập, lập phiếu xuất, thêm mặt hàng (contracts/form.schema.json)
cases/               trang đề nghị đã lập theo contracts/cases.schema.json
bpmn/                quy trình đề nghị cấp vật tư, deploy cho từng tenant khi cài
workflows/           khai báo bước của quy trình theo contracts/workflow.schema.json
seed/demo.yaml       dữ liệu demo hư cấu của hai xã theo contracts/seed.schema.json, nạp bằng bộ nạp chung
seed/dien-mat-troi.yaml  dữ liệu demo hư cấu của tenant `dmt` (doanh nghiệp), cùng định dạng; mẫu cài nạp
tests/smoke.sh       kiểm qua cổng; chỉ CI và người phát triển chạy, bộ cài gói không đọc tests/
```

## Dữ liệu và quyền

Lược đồ `app_supplies_commune`.

| Bảng, view | Nội dung | Ràng buộc chính |
|---|---|---|
| `stores` | Kho của một đơn vị: mã, tên, vị trí | `UNIQUE (tenant_id, code)`; `tenant_id` tham chiếu `core.tenants` |
| `items` | Mặt hàng trong một kho; `kind` là `consumable` (hàng tiêu hao) hoặc `equipment` (thiết bị); `quantity` là tồn đầu, không âm | Khóa ngoại ghép `(tenant_id, store_code)` tới kho, `ON DELETE RESTRICT`; `UNIQUE (tenant_id, store_code, code)` |
| `receipts`, `issues` | Phiếu nhập, phiếu xuất (dòng cha): số phiếu, ngày, bên giao hay bên nhận, ghi chú | `UNIQUE (tenant_id, code)` |
| `receipt_lines`, `issue_lines` | Dòng của phiếu (dòng con): kho, mặt hàng, số lượng dương | Khóa ngoại ghép tới phiếu và tới `(tenant_id, store_code, code)` của mặt hàng, `RESTRICT`; mỗi mặt hàng một dòng trên một phiếu |
| `stock` (view) | Tồn của từng mặt hàng: tồn đầu, đã nhập, đã xuất, tồn | Chỉ đọc |
| `stock_shortfalls` (view) | Mặt hàng có tồn âm; luôn rỗng | Lệnh ghi làm view có dòng bị từ chối |

Mặt hàng nối về kho, dòng nối về phiếu bằng mã, không bằng `id`, để dữ liệu demo và cấu hình danh mục không phải
biết `id` sinh tự động. Khóa ngoại ghép kèm `tenant_id` chặn việc ghi vào kho, phiếu hay mặt hàng của đơn vị khác dù
lớp API có lọt. Mọi bảng gắn nhật ký thay đổi (`core.audit_attach`, ADR 0009).

**Không xuất quá tồn.** Gói khai báo không tự viết trigger, nên migration gọi `platform.empty_guard_attach` của nền
tảng (ADR 0062) cho `issue_lines`, `receipt_lines` và `items`: lệnh thêm, sửa, xóa nào làm `stock_shortfalls` có
dòng của đơn vị đó thì CSDL từ chối, kể cả khi gọi thẳng GraphQL. Hai lệnh xuất đồng thời cho cùng đơn vị chạy lần
lượt, nên không cùng qua. Bỏ một dòng nhập hay hạ tồn đầu xuống dưới số đã xuất cũng bị từ chối.

| Vai trò | Được làm |
|---|---|
| `user`, `manager` | Chỉ đọc kho, mặt hàng, phiếu, tồn kho của đơn vị mình |
| `tenant_admin` | Đọc, thêm, sửa, xóa kho, mặt hàng, phiếu của đơn vị mình; thêm, xóa dòng phiếu (không sửa: ghi sai thì xóa rồi thêm lại); mã kho, mã mặt hàng, số phiếu không sửa được |

## Phiếu nhập, phiếu xuất

Quản trị lập phiếu bằng mục menu "Lập phiếu nhập" hay "Lập phiếu xuất", rồi mở phiếu trong danh mục "Phiếu nhập" hay
"Phiếu xuất" và bấm "Thêm dòng": số phiếu điền sẵn, chọn kho rồi chọn mặt hàng trong kho đó, ghi số lượng. Dòng xuất
vượt tồn bị CSDL từ chối; lời báo trên giao diện chưa kiểm trên trình duyệt. Tồn của từng kho xem ở bảng "Tồn kho"
trong danh mục "Kho"; mặt hàng mới thêm bằng nút "Thêm mặt hàng" ở bảng "Mặt hàng" của kho hay mục menu "Thêm mặt hàng".

## Đề nghị cấp vật tư

Quy trình `supply-request`: cán bộ mở mục menu "Lập đề nghị cấp vật tư" (biểu mẫu `forms/supply-request.yaml`), chọn
kho rồi chọn mặt hàng trong kho đó, ghi số lượng và lý do rồi gửi. Biểu mẫu khởi tạo quy trình với các biến `title`,
`storeCode`, `itemCode`, `quantity`, `reason`, như khi gọi thẳng `POST /v1/workflow/processes/supply-request/instances`.
Người có vai trò `manager` của đơn vị thấy việc "Duyệt đề nghị cấp vật tư" trên bảng việc kèm các giá trị đó (`details`
trong `workflows/supply-request.yaml`), ghi ý kiến rồi duyệt hoặc từ chối. Người lập không tự duyệt được (bốn mắt).

Người lập theo dõi đề nghị của mình ở mục menu "Đề nghị đã lập" (`cases/supply-requests.yaml`, thành phần `cases`,
[ADR 0032](../../docs/adr/0032-case-tracking-for-initiators.md)): đề nghị đang chờ người duyệt nào, kết quả duyệt
hay từ chối và các giá trị đã điền; ý kiến của người duyệt không hiện.

Gói không có mã nên duyệt xong không tự lập phiếu xuất; quản trị lập phiếu xuất sau khi giao.

Người lập không đặt sẵn được `approved` lúc lập đề nghị: workflow-api từ chối khởi tạo kèm biến mà điều kiện
sau bước duyệt đọc ([ADR 0025](../../docs/adr/0025-decision-variables.md)).

## Cài và gỡ

Cần lõi đang chạy và đã `make seed`.

```bash
make app-install APP=supplies-commune                  # migrate, áp quyền, deploy quy trình, nạp menu
make seed-demo APP=supplies-commune                    # dữ liệu demo (seed/demo.yaml), qua cổng
make app-smoke APP=supplies-commune                    # kiểm qua cổng
make app-uninstall APP=supplies-commune CONFIRM=yes    # XÓA dữ liệu của gói ở mọi tenant
```

CI cài gói này cùng gói `facilities-commune`, chạy smoke của cả hai, `make seed`, `make smoke` và bài kiểm trên trình
duyệt khi hai gói đang cài, rồi gỡ gói này và chạy lại `make smoke` và smoke của gói xã.

## Dữ liệu demo

`seed/demo.yaml` là dữ liệu hư cấu: xã A có hai kho với bốn mặt hàng, một phiếu nhập và một phiếu xuất; xã B một kho
với hai mặt hàng và một phiếu xuất. Smoke của gói kiểm các số này khi đã nạp, kể cả tồn giấy A4 ở KHO-A1.

`seed/dien-mat-troi.yaml` là dữ liệu hư cấu của "Công ty Điện mặt trời Mẫu" (tenant `dmt`, tài khoản `admin.dmt` do mẫu
cài `dien-mat-troi` tạo): hai kho, tấm pin, bộ biến tần, cáp điện một chiều, một phiếu nhập và một phiếu xuất. Tệp
không nằm trong `make seed-demo`. Nạp nó cần tenant `dmt` và bộ nạp nhận tệp dữ liệu thứ hai; cả hai đến từ mẫu cài
hai bản cài (#244), chưa có trên nhánh này.
