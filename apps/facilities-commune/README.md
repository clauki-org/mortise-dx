<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Gói cơ sở vật chất xã (`facilities-commune`)

Gói Tầng 3 minh họa: mỗi xã là một tenant quản lý các cơ sở nhà, đất (trụ sở) của mình, gồm cơ sở → tòa → phòng,
với diện tích thông thủy và loại diện tích của từng phòng để tính tiêu chuẩn, định mức. Gói chỉ gồm khai báo: tệp
`app.yaml`, lược đồ CSDL và metadata Hasura; không có mã chạy riêng.

## Bố cục

```
app.yaml             khai báo gói theo contracts/app.schema.json: lược đồ, thư mục migration và Hasura
schema/migrations/   migration dbmate của gói; bảng theo dõi public.facilities_commune_schema_migrations (ADR 0005)
hasura/tables.yaml   bảng đăng ký và quyền theo tenant cho vai trò `user`, cùng định dạng với core/hasura/
tests/smoke.sh       kiểm qua cổng: cách ly tenant, tenant lấy từ token, khóa ngoại ghép, RESTRICT, nhật ký
```

## Dữ liệu

Lược đồ `app_facilities_commune`.

| Bảng | Nội dung | Ràng buộc chính |
|---|---|---|
| `facilities` | Cơ sở nhà, đất của một xã; `status` là `in_use` (đang dùng) hoặc `surplus` (dôi dư, không còn dùng) | `UNIQUE (tenant_id, code)`; `tenant_id` tham chiếu `core.tenants` |
| `buildings` | Tòa trong một cơ sở | Khóa ngoại ghép `(tenant_id, facility_id)`, `ON DELETE RESTRICT` |
| `rooms` | Phòng, với `clear_area_m2` (thông thủy) và `area_type`: `working`, `shared`, `specialized` | Khóa ngoại ghép `(tenant_id, building_id)`, `ON DELETE RESTRICT` |

Khóa ngoại ghép kèm `tenant_id` làm CSDL tự chặn việc nối tòa hay phòng vào cơ sở của xã khác, dù lớp API có lọt.
Quyền Hasura cho vai trò `user`: chỉ đọc, thêm, sửa, xóa dòng có `tenant_id` bằng claim trong token; cột
`tenant_id` không nhận từ dữ liệu gửi lên mà gán từ token. Ba bảng gắn nhật ký thay đổi (`core.audit_attach`,
ADR 0009): mỗi thao tác qua Hasura ghi lại `sub` của token và vai trò.

## Cài và gỡ

Cần lõi đang chạy và đã `make seed`. Lệnh cài gói đầy đủ (quy trình, menu) thuộc Sprint 2; hiện dùng script:

```bash
scripts/app.sh facilities-commune install     # migrate rồi áp hasura/tables.yaml
apps/facilities-commune/tests/smoke.sh        # kiểm qua cổng
scripts/app.sh facilities-commune status      # migration nào đã áp
scripts/app.sh facilities-commune uninstall   # bỏ đăng ký Hasura rồi lùi migration; `make smoke` của lõi vẫn qua
```

Gói đã cài thì `make seed` áp lại quyền của gói và `make smoke` báo lệch nếu ai sửa tay trên Hasura, như bảng của
lõi. CI chạy đúng bốn bước trên sau smoke của lõi.

## Chưa có

Bảng định mức, biên chế và cách tính diện tích được phép; dữ liệu mẫu ba xã (`make seed-demo`); mục `menu` trong
`app.yaml` cho thành phần danh mục; quy trình rà soát. Theo dõi ở các issue của Sprint 1 và Sprint 2.
