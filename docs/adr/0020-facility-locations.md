<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0020. Tọa độ cơ sở là hai cột số; tenant cha thấy vị trí trụ sở đang dùng của tenant con qua view

- Trạng thái: Chấp nhận
- Ngày: 2026-11-21

## Bối cảnh

Bản đồ trụ sở (#113) cần ba thứ mà gói cơ sở vật chất xã chưa có:

- **Vị trí của từng cơ sở.** Bảng `facilities` chỉ có địa chỉ dạng chữ.
- **Màu theo phần vượt.** Phần vượt tính cho cả xã (view `area_summary`), không cho từng cơ sở.
- **Tỉnh thấy cả ba xã.** [ADR 0016](0016-parent-tenant-rollup.md) chỉ cho tenant cha đọc số đã gộp, mỗi tenant con
  một dòng (`area_rollup`), không có vị trí nào.

Cách lưu tọa độ đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Cột `geography` của PostGIS | Image CSDL của lõi là `pgvector/pgvector`, không có PostGIS; thêm vào là đổi image và extension của lõi cho mọi bản cài, trong khi gói chỉ lưu và đọc một điểm |
| `jsonb` dạng GeoJSON | Kiểm miền giá trị phải đào vào cấu trúc JSON trong CHECK; thêm một định dạng phải đọc cho một điểm |
| Hai cột `numeric` vĩ độ, kinh độ | CHECK miền giá trị và cặp đủ hai vế ngay trong CSDL; Hasura trả số, bản đồ web đọc thẳng |

Cách cho tỉnh thấy vị trí đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Thêm tọa độ trung bình các trụ sở vào `area_rollup` | Giữ đúng "mỗi xã một dòng" của ADR 0016, nhưng điểm trung bình của hai trụ sở xa nhau không phải nơi nào có thật |
| View mới, mỗi trụ sở đang dùng của tenant con một dòng | Tỉnh thấy đúng nơi đặt trụ sở; mở thêm cho tỉnh mã, tên và tọa độ của từng cơ sở đang dùng |
| Không cho tỉnh xem bản đồ | Không đạt mục tiêu của #113 |

## Quyết định

- **Tọa độ là hai cột của `facilities`:** `latitude numeric(8,6)`, `longitude numeric(9,6)`, độ thập phân theo
  WGS 84 (hệ của GPS và bản đồ web).
  - CHECK vĩ độ trong -90..90, kinh độ trong -180..180, và hai cột cùng có hoặc cùng trống.
  - Cho phép trống: cơ sở nhập trước, đo vị trí sau; bản đồ bỏ qua cơ sở chưa có tọa độ.
  - Cột thuộc quyền đọc và ghi sẵn có của cơ sở: `custodian` và `tenant_admin` sửa, mọi vai trò thấy cơ sở thì thấy
    tọa độ.
- **Quan hệ `summary` từ cơ sở tới `area_summary` theo `tenant_id`.** Mỗi cơ sở đọc được phần vượt của xã mình để
  tô màu, qua quyền sẵn có của view; không có view mới phải chép lại luật phân công của ADR 0015.
- **View `facility_rollup` cho tenant cha.** Mỗi cơ sở đang dùng (`in_use`) của tenant con một dòng:
  `parent_tenant_id`, `tenant_id`, tên xã, mã, tên cơ sở, tọa độ, và `excess_m2` của cả xã lấy nguyên từ
  `area_summary`.
  - Chỉ vai trò `rollup_reader` đọc, lọc `parent_tenant_id` bằng tenant trong token, như `area_rollup`.
  - Không có tòa, phòng, diện tích từng cơ sở, phân công, hay cơ sở dôi dư.
  - Cơ sở chưa có tọa độ vẫn có dòng, để tỉnh biết xã nào còn thiếu.
- **Dữ liệu demo hư cấu cả vị trí.** Ban đầu mọi cơ sở nằm trong vài km quanh điểm vĩ độ 0, kinh độ 0, giữa biển.
  Sửa ngày 2026-11-27 (#226), khi bản đồ có nền OpenStreetMap thật ([ADR 0056](0056-self-hosted-osm-basemap.md)):
  - Nền là một vùng nông thôn đồng bằng có thật, khung `106.37,20.405,106.46,20.475` ghim trong
    `platform/web/basemap.pins`; lý do chọn vùng ở ADR 0056. Bản đồ của bản demo không có chữ địa danh nào.
  - Ranh giới và tên ba xã của "Tỉnh Mẫu" là đa giác tự vẽ trong cấu hình bản đồ của gói
    (`map-layers/facilities.yaml`, mục `areas` của `contracts/map.schema.json`), không theo ranh giới hành chính nào có
    thật; kiểu vẽ của nền bỏ ranh giới hành chính thật để hai bộ ranh giới không chồng nhau.
  - Mỗi cơ sở trong `seed/demo.yaml` nằm trong ranh giới của xã mình, cách cạnh ranh giới ít nhất 300 m, và theo dữ
    liệu của tệp nền (tile mức 15, đo ngày 2026-11-27): cách 15 tới 30 m một con đường không phải ngõ xóm (OpenStreetMap
    ghi `unclassified` hay `tertiary`); không có ngõ xóm (`residential`, `service`) trong vòng 120 m và không quá năm
    đoạn đường trong vòng 250 m, tức không nằm giữa một cụm dân cư; không có nhà, điểm quan tâm hay khu đất (trường học,
    công nghiệp, khu dân cư) nào trong vòng 500 m; cách sông, kênh ít nhất 40 m. Từng vị trí được xem lại trên ảnh
    chụp ở mức phóng 15,5: nằm ven đường giữa đồng.
  - Bản đồ luôn ghi dưới khung rằng ranh giới, tên xã và vị trí trụ sở là hư cấu.

## Hệ quả

- **Tỉnh thấy nhiều hơn ADR 0016 cho phép trước đây:** mã, tên và vị trí của trụ sở đang dùng, không chỉ số gộp. ADR
  0016 vẫn giữ nguyên cho `area_rollup`. Thêm cột vào `facility_rollup` là mở thêm dữ liệu cho tenant cha, nên phải
  review như đổi quyền.
- **CSDL không tính được khoảng cách hay vùng.** Cần phép tính không gian (cơ sở trong ranh giới xã, cơ sở gần nhau)
  thì phải quyết định lại về PostGIS bằng một bản ghi mới.
- **Bản cài đã nạp demo trước đây** nhận tọa độ khi chạy lại `make seed-demo`: `seed/load.py` ghi tọa độ cho cơ sở đã
  có khi khác `demo.yaml`.
- **Chưa có bản đồ trên giao diện.** Thành phần bản đồ Tầng 2 đọc các cột và view này là bước sau của #113.
- **"Chỗ trống" chỉ đúng theo dữ liệu OpenStreetMap.** Vùng nông thôn này có rất ít nhà được vẽ trên OpenStreetMap,
  nên một vị trí không có nhà trong dữ liệu vẫn có thể trùng nhà hay công trình có thật ngoài thực địa. Hình sông,
  đường của vùng cũng có thể được người quen vùng nhận ra (ADR 0056); vì vậy mọi tên và vị trí demo trên nền chỉ là
  hư cấu.
