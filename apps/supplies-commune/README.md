<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Gói kho vật tư xã (`supplies-commune`)

Gói Tầng 3 thứ hai: mỗi xã là một tenant quản lý các kho của mình, vật tư và thiết bị trong từng kho, và đề nghị cấp
vật tư cần người duyệt của xã. Gói chỉ gồm tệp khai báo, không có mã chạy
([ADR 0022](../../docs/adr/0022-declarative-packages.md)): `make check-fast` kiểm vì gói nằm trong `DECLARATIVE_APPS`
của Makefile. Trang danh mục trên giao diện dựng từ cấu hình của gói
([ADR 0023](../../docs/adr/0023-package-pages-in-the-web-shell.md)).

## Bố cục

```
app.yaml             khai báo gói theo contracts/app.schema.json: lược đồ, Hasura, quy trình, menu
schema/migrations/   migration dbmate của gói; bảng theo dõi public.supplies_commune_schema_migrations (ADR 0005)
hasura/tables.yaml   bảng đăng ký và quyền theo tenant, cùng định dạng với core/hasura/
catalog/stores.yaml  cấu hình thành phần danh mục (kho → vật tư) theo contracts/catalog.schema.json
bpmn/                quy trình đề nghị cấp vật tư, deploy cho từng tenant khi cài
workflows/           khai báo bước của quy trình theo contracts/workflow.schema.json
seed/demo.yaml       dữ liệu demo hư cấu theo contracts/seed.schema.json, nạp bằng bộ nạp chung
tests/smoke.sh       kiểm qua cổng; chỉ CI và người phát triển chạy, bộ cài gói không đọc tests/
```

## Dữ liệu và quyền

Lược đồ `app_supplies_commune`.

| Bảng | Nội dung | Ràng buộc chính |
|---|---|---|
| `stores` | Kho của một xã: mã, tên, vị trí | `UNIQUE (tenant_id, code)`; `tenant_id` tham chiếu `core.tenants` |
| `items` | Vật tư, thiết bị trong một kho; `kind` là `consumable` (tiêu hao) hoặc `equipment` (thiết bị); `quantity` không âm | Khóa ngoại ghép `(tenant_id, store_code)` tới kho, `ON DELETE RESTRICT`; `UNIQUE (tenant_id, store_code, code)` |

Vật tư nối về kho bằng mã kho, không bằng `id`, để dữ liệu demo và cấu hình danh mục không phải biết `id` sinh tự
động. Khóa ngoại ghép kèm `tenant_id` chặn việc đặt vật tư vào kho của xã khác dù lớp API có lọt. Cả hai bảng gắn
nhật ký thay đổi (`core.audit_attach`, ADR 0009).

| Vai trò | Được làm |
|---|---|
| `user`, `manager` | Chỉ đọc kho và vật tư của xã mình |
| `tenant_admin` | Đọc, thêm, sửa, xóa kho và vật tư của xã mình; mã kho, mã vật tư và kho của vật tư không sửa được |

## Đề nghị cấp vật tư

Quy trình `supply-request`: cán bộ lập đề nghị qua API quy trình (`POST /v1/workflow/processes/supply-request/instances`)
với các biến `title`, `storeCode`, `itemCode`, `quantity`, `reason`; người có vai trò `manager` của xã thấy việc
"Duyệt đề nghị cấp vật tư" trên bảng việc, ghi ý kiến rồi duyệt hoặc từ chối. Người lập không tự duyệt được (bốn
mắt). Giao diện chưa có màn hình lập đề nghị, nên đề nghị lập qua API.

Gói không có mã nên duyệt xong không tự trừ số lượng trong kho; quản trị xã cập nhật số lượng sau khi giao.

Giới hạn đã biết: biến gửi lúc lập đề nghị vào thẳng quy trình, kể cả `approved`. Người lập gửi sẵn
`"approved": true` thì người duyệt hoàn thành việc qua API mà không gửi `approved` cũng làm đề nghị kết thúc ở nhánh
đã duyệt. Bảng việc luôn gửi `approved` ở cả hai nút Duyệt và Từ chối nên duyệt trên giao diện không gặp. Lõi chặn
chung cho mọi quy trình là kế hoạch, theo dõi ở
[issue #145](https://github.com/clauki-org/mortise-dx/issues/145).

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

`seed/demo.yaml` là dữ liệu hư cấu: xã A có hai kho với bốn vật tư, xã B một kho với hai vật tư. Smoke của gói kiểm
các số này khi đã nạp.
