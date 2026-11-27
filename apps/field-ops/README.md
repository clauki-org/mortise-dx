<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Gói vận hành hiện trường (`field-ops`)

Gói Tầng 3 cho doanh nghiệp lắp đặt điện mặt trời: khách hàng, điểm lắp đặt trên bản đồ, thiết bị tại điểm, phiếu
công việc (khảo sát, lắp đặt, nghiệm thu, sửa chữa) có ảnh và biên bản đính kèm, nghiệm thu cần người điều phối xác
nhận, và hồ sơ sửa chữa tự mở khi sản lượng một điểm thấp quá lâu. Dữ liệu demo là của "Công ty Điện mặt trời Mẫu"
(tenant `dmt`, hư cấu). Gói chỉ gồm tệp khai báo, không có mã chạy
([ADR 0022](../../docs/adr/0022-declarative-packages.md)): `make check-fast` kiểm vì gói nằm trong `DECLARATIVE_APPS`
của Makefile. Các quyết định riêng của gói ở [ADR 0067](../../docs/adr/0067-field-operations-package.md).

## Bố cục

```
app.yaml             khai báo gói: lược đồ, Hasura, quy trình, luật ngưỡng, menu
schema/migrations/   migration dbmate; bảng theo dõi public.field_ops_schema_migrations (ADR 0005)
hasura/tables.yaml   bảng đăng ký và quyền theo tenant
catalog/             danh mục phiếu công việc; điểm lắp đặt → thiết bị, phiếu; khách hàng → điểm lắp đặt
forms/               lập phiếu công việc, thêm khách hàng
map-layers/          bản đồ điểm lắp đặt, mỗi giai đoạn một lớp màu
dashboards/          bảng điều hành: phiếu còn phải làm, quá hạn, công suất phát theo điểm, hồ sơ sửa chữa
bpmn/, workflows/    nghiệm thu bốn mắt (work-acceptance), sửa chữa do luật mở (site-repair)
rules/low-output.yaml  luật `below` trên công suất phát
cases/               trang đề nghị nghiệm thu đã lập
seed/dien-mat-troi.yaml  dữ liệu demo hư cấu của tenant `dmt`
tests/smoke.sh       kiểm qua cổng; bộ cài gói không đọc tests/
```

## Dữ liệu và quyền

Lược đồ `app_field_ops`. Bảng con nối về bảng cha bằng mã, khóa ngoại ghép kèm `tenant_id`; mọi bảng có nhật ký
(`core.audit_attach`, ADR 0009). `updated_at` do CSDL đặt ở mỗi lệnh sửa (`platform.row_version_attach`, ADR 0067),
để nút sửa trên danh mục báo khi người khác đã sửa trước (ADR 0054).

| Bảng, view | Nội dung |
|---|---|
| `customers` | Khách hàng: mã, tên, điện thoại, địa chỉ |
| `sites` | Điểm lắp đặt của một khách hàng: tọa độ (đủ cả hai hoặc trống cả hai), công suất lắp đặt kWp, giai đoạn (khảo sát, đang lắp đặt, đang vận hành, cần sửa chữa) |
| `devices` | Thiết bị tại điểm (công tơ, bộ biến tần, dãy tấm pin); `device_name` là tên trên MQTT, duy nhất trong tenant |
| `work_orders` | Phiếu công việc: loại việc, người thực hiện (chữ tự do), hạn, trạng thái (mới lập, đang làm, đã xong, đã hủy) |
| `work_order_documents` | Ảnh, biên bản gắn vào phiếu (ADR 0041) |
| `work_order_summary`, `work_orders_by_kind` (view) | Phiếu còn phải làm, quá hạn (còn phải làm, hạn trước hôm nay), đã xong |

| Vai trò | Được làm |
|---|---|
| `user`, `manager` | Đọc mọi dòng của tenant; lập phiếu, sửa trạng thái, người thực hiện, hạn, ghi chú của phiếu; gắn ảnh, biên bản |
| `tenant_admin` | Thêm, sửa, xóa khách hàng, điểm, thiết bị; xóa phiếu |

Không ai xóa được ảnh đã gắn; điểm của phiếu và các mã không sửa được.

## Nghiệm thu và sửa chữa

Trên chi tiết phiếu, nhân viên bấm "Đề nghị nghiệm thu": người có vai trò `manager` thấy việc "Xác nhận nghiệm thu"
trên bảng việc, ghi ý kiến rồi xác nhận hay trả lại; người đề nghị không tự xác nhận được (bốn mắt). Người đề nghị theo
dõi ở mục "Đề nghị nghiệm thu đã lập". Kết quả nằm ở hồ sơ, không tự đổi trạng thái của phiếu.

Luật `rules/low-output.yaml`: số đo `power` của một thiết bị dưới 1 kW liên tục 600 giây thì iot-bridge mở hồ sơ
"Sửa chữa điểm lắp đặt" cho người điều phối (`manager`) của tenant có thiết bị, kèm tên thiết bị, số đo và ngưỡng. Ngưỡng
là số minh họa. Giới hạn:

- Chưa phát hiện thiết bị mất kết nối: lõi chỉ xét luật khi có số đo tới.
- Hồ sơ do luật mở chưa gắn ảnh hay vật tư, và không tạo phiếu công việc; người điều phối tự lập phiếu sửa chữa.
- Luật không biết ngày đêm.

## Cài, dữ liệu demo, giả lập

```bash
make app-install APP=field-ops                         # migrate, áp quyền, deploy quy trình, nạp luật và menu
make app-smoke APP=field-ops                           # kiểm qua cổng
make app-uninstall APP=field-ops CONFIRM=yes           # XÓA dữ liệu của gói ở mọi tenant
```

Smoke chạy bằng `admin.dmt`, `user.dmt`, `manager.dmt` khi bản cài có các tài khoản đó, không thì bằng tài khoản xã A
(bản cài chính quyền, CI). `seed/dien-mat-troi.yaml` không mang tên `demo.yaml` nên `make seed-demo` không nạp nó;
nạp nó cần tenant `dmt` và bộ nạp nhận tệp dữ liệu thứ hai, cả hai đến từ mẫu cài hai bản cài (#244). Vị trí demo
nằm trong vùng nền bản đồ ghim nhưng không được chọn theo công trình có thật nào; bản đồ luôn ghi chúng là hư cấu.

Thiết bị demo của `dmt` ở `devices/simulator/dien-mat-troi.yaml` (công tơ `meter-d01` tới `meter-d03`, số đo `power`
và `energy`). `make seed` cấp tài khoản MQTT cho chúng khi tenant `dmt` đã có. Gửi số đo, và ép một điểm xuống thấp:

```bash
make simulate ARGS="--devices /srv/devices/dien-mat-troi.yaml --set dmt/meter-d03:power=0.2"
```

Chưa chạy trên trình duyệt hay trên bản cài thật: e2e `platform/web/e2e/field-ops.spec.ts` (cỡ điện thoại), smoke của
gói, nạp dữ liệu demo và lệnh giả lập trên.
