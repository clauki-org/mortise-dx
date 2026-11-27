<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0024. Thành phần bản đồ: nền trơn, điểm là nút HTML, vai trò Hasura khai theo lớp

- Trạng thái: Chấp nhận
- Ngày: 2026-11-21

## Bối cảnh

Thành phần bản đồ Tầng 2 hiện các lớp điểm do gói khai (#113). Ví dụ đầu tiên là trụ sở của xã tô theo phần vượt,
và tỉnh thấy trụ sở của các xã con ([ADR 0020](0020-facility-locations.md)). Ba việc chưa được quyết định:

- **Nền bản đồ.** [ADR 0006](0006-frontend-stack.md) chọn MapLibre GL JS và để việc chọn nguồn nền tới lúc làm thành
  phần này, với điều kiện không tải tile trực tiếp khối lượng lớn từ máy chủ của OpenStreetMap.
- **Cách vẽ điểm** sao cho người dùng trình đọc màn hình và kiểm thử trên trình duyệt đọc được.
- **Vai trò khi truy vấn.** Theo [ADR 0023](0023-package-pages-in-the-web-shell.md), giao diện không gửi `X-Hasura-Role`, nên mọi truy
  vấn chạy với vai trò `user`. Tỉnh chỉ đọc được `facility_rollup` với vai trò `rollup_reader`
  ([ADR 0016](0016-parent-tenant-rollup.md)).

Nguồn nền đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Tile của `tile.openstreetmap.org` | Chính sách tile của OSMF (`operations.osmfoundation.org/policies/tiles`, đọc ngày 2026-11-21) đòi trình duyệt gửi header Referer và cấm đặt Referrer-Policy chặn nó. Giao diện gửi `Referrer-Policy: same-origin`, nên trình duyệt không gửi Referer sang site khác. Cách này cũng cần internet và phải mở thêm `img-src`, `connect-src` trong CSP |
| Một dịch vụ tile vector công cộng khác | Cần internet. CSP không còn là chuỗi tĩnh, mà phải sinh theo cấu hình của từng bản cài |
| Tệp tile tự lưu trữ (PMTiles) | Chạy không cần internet, nhưng phải tải và phục vụ một tệp dữ liệu lớn, thêm một thư viện đọc tệp |
| Nền trơn | Không cần internet, không đổi CSP. Dữ liệu demo có tọa độ hư cấu (ADR 0020): đặt lên nền thật thì điểm rơi vào một nơi có thật |

## Quyết định

- **Nền trơn.** Một lớp nền một màu lấy từ theme, không tải ảnh hay dữ liệu bản đồ từ máy chủ nào. Thêm nguồn nền là
  một quyết định sau, kèm cách cấu hình CSP theo bản cài. Được sửa theo [ADR 0056](0056-self-hosted-osm-basemap.md):
  bản cài chạy `make basemap` có nền OpenStreetMap dạng PMTiles cùng origin, CSP không đổi; chưa có thì vẫn nền trơn.
- **MapLibre GL JS 6.18.0 (BSD-3-Clause)** dùng trực tiếp, không qua lớp bọc React. Mã của nó chỉ được nạp khi mở
  trang bản đồ.
- **Worker của MapLibre chạy cùng origin.** Vite build tệp worker của MapLibre thành một module ES trong `assets/`,
  và mã gọi `setWorkerUrl` trỏ tới tệp đó. Nhờ vậy `worker-src 'self'` của CSP giữ nguyên, không phải mở `blob:` như
  ADR 0006 đã dự liệu.
  - Không dùng tệp `.mjs` gốc của gói npm: nginx của giao diện không có kiểu MIME cho `.mjs`, trả
    `application/octet-stream`, và trình duyệt từ chối chạy worker module như vậy khi có `nosniff`.
- **Điểm là nút HTML** (marker của MapLibre), không phải lớp vẽ trên canvas. Mỗi nút có nhãn đọc được (tên điểm và
  nhãn màu), bấm được bằng bàn phím, và bài kiểm trên trình duyệt đọc được.
  - Trang có thêm chú giải màu và danh sách điểm của từng lớp, để người không xem được bản đồ vẫn đọc đủ.
  - Mỗi lớp có trần số điểm (`limit`, mặc định 200, tối đa 1000), vì mỗi điểm là một phần tử của trang.
- **Màu là tên trong bảng màu của Mantine,** không nhận mã CSS tự do: màu theo theme của bản cài, và cấu hình không
  đưa được chuỗi tùy ý vào thuộc tính `style`.
- **Vai trò khai theo lớp** (`role` trong cấu hình bản đồ):
  - Giao diện chỉ truy vấn lớp đó khi `realm_access.roles` trong token có vai trò này, và gửi kèm `X-Hasura-Role`.
  - Khai vai trò không cấp quyền gì: Hasura vẫn từ chối vai trò không có trong token và vẫn lọc dòng theo quyền của
    vai trò đó.
  - `graphql.ts` thêm header bằng một exchange của urql đọc `context.role`, để giữ header `Authorization` của client.
    Truy vấn không có `role` gửi như trước.
  - Bộ nhớ đệm của urql không phân biệt vai trò, nên truy vấn của bản đồ luôn đọc lại từ máy chủ.
  - Các trang khác vẫn như ADR 0023: chưa có cách chọn vai trò chung cho mọi thành phần.

Đã chạy thử ngày 2026-11-21 với bản build thật, phục vụ bằng nginx 1.30.6 với `security-headers.conf` của repo. Riêng
`connect-src` có thêm địa chỉ cổng, vì bản thử chạy ở một origin khác cổng. Kết quả:

- `leader.tinh` thấy bốn trụ sở đang dùng của ba xã, ba màu đỏ và một màu xanh, đúng phần vượt của từng xã. Chỉ
  truy vấn của lớp tổng hợp mang `X-Hasura-Role: rollup_reader`.
- `user.a` không gửi truy vấn nào tới `facility_rollup`.
- Console không có lỗi CSP; tệp worker được trả với `Content-Type: application/javascript`.

## Hệ quả

- Bản đồ chạy được không cần internet, nhưng không cho thấy đường, địa danh hay ranh giới. Người xem định hướng nhờ
  vị trí tương đối giữa các điểm và danh sách điểm.
- Gói khai vai trò ở lớp là mở một cách đọc dữ liệu bằng vai trò khác `user` trên giao diện. Review như đổi quyền.
- Cấu hình bản đồ của gói được `make check-fast` kiểm theo `contracts/map.schema.json`, như cấu hình danh mục.
- MapLibre làm phần mã của trang bản đồ lớn thêm, nhưng chỉ tải khi mở trang đó.
