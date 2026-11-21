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
hasura/tables.yaml   bảng đăng ký, quan hệ và quyền theo tenant và phân công, cùng định dạng với core/hasura/
catalog/             cấu hình thành phần danh mục (cơ sở → tòa → phòng) theo contracts/catalog.schema.json
bpmn/                quy trình BPMN của gói, deploy cho từng tenant khi cài
workflows/           khai báo bước của từng quy trình theo contracts/workflow.schema.json
rules/               luật ngưỡng của số đo thiết bị theo contracts/threshold-rule.schema.json
tests/smoke.sh       kiểm qua cổng: cách ly tenant, tenant lấy từ token, phân công, khóa ngoại ghép, RESTRICT,
                     nhật ký, phần vượt; mở việc kiểm tra kho khi độ ẩm vượt ngưỡng (số đo gửi qua MQTT)
```

## Dữ liệu

Lược đồ `app_facilities_commune`.

| Bảng | Nội dung | Ràng buộc chính |
|---|---|---|
| `facilities` | Cơ sở nhà, đất của một xã; `status` là `in_use` (đang dùng) hoặc `surplus` (dôi dư, không còn dùng) | `UNIQUE (tenant_id, code)`; `tenant_id` tham chiếu `core.tenants` |
| `buildings` | Tòa trong một cơ sở | Khóa ngoại ghép `(tenant_id, facility_id)`, `ON DELETE RESTRICT` |
| `rooms` | Phòng, với `clear_area_m2` (thông thủy) và `area_type`: `working`, `shared`, `specialized` | Khóa ngoại ghép `(tenant_id, building_id)`, `ON DELETE RESTRICT` |
| `working_area_norms` | Phụ lục mức m² theo chức danh của NĐ 369/2026/NĐ-CP, STT 1–10, chép nguyên văn cả ghi chú; dữ liệu chung, không đăng ký trong Hasura | Khóa chính `row_no` (STT) |
| `staffing` | Biên chế được giao của xã: chức danh, dòng phụ lục (`norm_row`), số người | `UNIQUE (tenant_id, position)`; `norm_row` tham chiếu `working_area_norms` |
| `specialized_allowances` | Diện tích chuyên dùng do cấp có thẩm quyền quyết định, kèm căn cứ | `UNIQUE (tenant_id, name)` |
| `staffing_allowances` (view) | Mỗi dòng biên chế kèm mức m², diện tích được phép và trích dẫn dòng phụ lục | Chỉ đọc |
| `area_summary` (view) | Mỗi xã một dòng: làm việc, sử dụng chung, chuyên dùng, được phép, đang dùng, dôi dư, phần vượt | Chỉ đọc |
| `facility_assignments` | Phân công: `user_id` (`sub` của cán bộ trong token) phụ trách (`custodian`) hay duyệt (`approver`) một cơ sở | Khóa ngoại ghép `(tenant_id, facility_id)`, `ON DELETE CASCADE`; `UNIQUE (tenant_id, facility_id, user_id, duty)` |
| `area_rollup` (view) | Mỗi xã có tenant cha một dòng, lấy nguyên số của `area_summary`, kèm `parent_tenant_id` và tên xã | Chỉ đọc; chỉ vai trò `rollup_reader` của tenant cha đọc ([ADR 0016](../../docs/adr/0016-parent-tenant-rollup.md)) |

Khóa ngoại ghép kèm `tenant_id` làm CSDL tự chặn việc nối tòa, phòng hay phân công vào cơ sở của xã khác, dù lớp
API có lọt. Mọi quyền Hasura lọc theo tenant trong token trước, rồi xét phân công
([ADR 0015](../../docs/adr/0015-assignment-as-data.md)):

| Vai trò | Được làm |
|---|---|
| `user` | Thấy cơ sở có phân công của mình cùng tòa, phòng của nó; nhiệm vụ `custodian` sửa cơ sở, thêm, sửa, xóa tòa và phòng; đọc phân công của chính mình |
| `manager` | Chỉ đọc toàn xã |
| `tenant_admin` | Đọc, ghi toàn xã; thêm, xóa phân công |

Vai trò khác `user` gửi kèm header `X-Hasura-Role`. Cột `tenant_id` không nhận từ dữ liệu gửi lên mà gán từ token.
Mọi bảng xã nhập gắn nhật ký thay đổi (`core.audit_attach`, ADR 0009): mỗi thao tác qua Hasura ghi lại `sub` của
token và vai trò.

Biên chế, diện tích chuyên dùng và hai view diện tích không gắn với cơ sở nên không xét phân công: mọi vai trò
trong xã đọc được; `user` và `tenant_admin` sửa được biên chế, diện tích chuyên dùng.

## Diện tích được phép và phần vượt

Căn cứ: Nghị định 155/2025/NĐ-CP, sửa đổi, bổ sung bởi Nghị định 369/2026/NĐ-CP (hiệu lực 11/11/2026). View
`area_summary` tính cho từng xã:

- Làm việc: tổng số người theo biên chế nhân mức m² của dòng phụ lục (Điều 5; phụ lục của NĐ 369 thay Phụ lục I, II
  của NĐ 155). Chức danh nào thuộc dòng nào do xã xác định theo Quy định 368-QĐ/TW hoặc văn bản của cấp có thẩm
  quyền (Điều 3 khoản 2, sửa bởi NĐ 369): phụ lục không ghi tên chức danh cấp xã, nên gói không tự suy ra.
- Sử dụng chung: bằng phần làm việc, mức tối đa 100% (Điều 6 khoản 2 điểm a, sửa bởi NĐ 369). Phần bù theo diện tích
  tối thiểu của Tiêu chuẩn quốc gia (điểm b) chưa tính.
- Chuyên dùng: tổng các dòng `specialized_allowances` (Điều 7).
- Đang dùng: tổng diện tích thông thủy các phòng của mọi cơ sở `in_use` (Điều 3 khoản 3, sửa bởi NĐ 369: tính trên
  tổng các trụ sở). Cơ sở `surplus` cộng riêng vào `surplus_m2`.
- Phần vượt: đang dùng trừ được phép, không âm.

Bản gốc đã đối chiếu (tải ngày 2026-11-19 từ cổng văn bản của Chính phủ; không lưu trong repo):

| Văn bản | Tệp | SHA-256 |
|---|---|---|
| NĐ 155/2025/NĐ-CP | https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/6/155-cp.signed.pdf | `b5cf65d96ea278c83150db0490d57b9522dd0a505a6c6e369c650499fff4765b` |
| NĐ 369/2026/NĐ-CP | https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/9/369_2026_nd-cp_25092026-signed.signed.pdf | `83bb37181f6a8f2c3bcc9a7824321a6501817af8b19e146a18edf6949c918500` |

## Cài và gỡ

Cần lõi đang chạy và đã `make seed`. Lệnh cài gói đầy đủ (quy trình, menu) thuộc Sprint 2; hiện cài lược đồ và
quyền:

```bash
make app-install APP=facilities-commune                  # migrate rồi áp hasura/tables.yaml
make seed-demo                                           # dữ liệu demo ba xã (seed/demo.yaml), qua cổng
make app-smoke APP=facilities-commune                    # kiểm qua cổng
make app-status APP=facilities-commune                   # migration nào đã áp
make app-uninstall APP=facilities-commune CONFIRM=yes    # XÓA dữ liệu của gói ở mọi tenant; lõi vẫn qua smoke
```

Gói đã cài thì `make seed` áp lại quyền của gói và `make smoke` báo lệch nếu ai sửa tay trên Hasura, như bảng của
lõi. CI cài gói, chạy smoke của gói, chạy `make seed` và `make smoke` khi gói đang cài, rồi gỡ gói và chạy lại
`make smoke`.

## Kiểm tra kho lưu trữ

Luật `rules/archive-humidity.yaml` (ADR 0018): độ ẩm (`humidity`) của một thiết bị trong xã lớn hơn 75% liên tục 5
phút thì lõi mở quy trình `archive-inspection` cho xã đó; người duyệt (`manager`) của xã thấy việc "Kiểm tra kho lưu
trữ" trên bảng việc và ghi kết quả kiểm tra. Còn việc chưa xử lý thì không mở thêm. Ngưỡng 75% và 5 phút là số minh
họa, không lấy từ quy định hay tiêu chuẩn nào.

Thử trên bản cài demo (đã chạy ngày 2026-11-21: sau khoảng 5 phút `manager.a` có việc "Kiểm tra kho lưu trữ:
archive-01"):

```bash
make simulate ARGS="--set xa-a/archive-01:humidity=78"   # giữ độ ẩm kho xã A ở 78%, dừng bằng Ctrl+C
```

## Chưa có

Quy trình rà soát (#108); phần bù diện tích sử dụng chung theo Tiêu chuẩn quốc gia; diện tích sử dụng chung khi
nhiều cơ quan chung một trụ sở (Điều 6 khoản 2 điểm a, sửa bởi NĐ 369).

## Dữ liệu demo

`seed/demo.yaml` là dữ liệu hư cấu của ba xã thuộc "Tỉnh Mẫu": tổng diện tích thông thủy của cơ sở đang dùng là
1.000 m² (xã A), 730 m² (xã B), 460 m² (xã C); xã C còn một cơ sở dôi dư 250 m². Biên chế hư cấu chỉ dùng hai dòng
phụ lục có ghi thẳng chức danh (STT 9 chuyên viên chính 20 m², STT 10 chuyên viên 15 m²); kết quả: xã A được phép
580 m², vượt 420 m²; xã B được phép 600 m², vượt 130 m²; xã C được phép 480 m², không vượt. `make seed-demo` nạp qua
cổng bằng tài khoản quản trị của từng xã (`admin.*`, `seed/load.py`) rồi phân công `user.*` phụ trách mọi cơ sở của
xã mình; chạy lại không tạo bản trùng; smoke của gói kiểm các số này khi đã nạp.

Mục `menu` `facilities` trong `app.yaml` khai cấu hình danh mục, được `make check-fast` kiểm theo schema. Cài gói
thì mục "Cơ sở nhà, đất" hiện trên menu của giao diện và mở danh sách cơ sở → tòa → phòng dựng từ
`catalog/facilities.yaml`; gói không có mã giao diện riêng. Cán bộ thấy cơ sở mình được phân công; giao diện chưa
chọn vai trò khác `user`, nên quản trị xã và lãnh đạo xã trên giao diện cũng chỉ thấy như cán bộ.
