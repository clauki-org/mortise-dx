<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0037. Giám sát trong profile `observability`: Prometheus, Loki, Grafana chỉ ở 127.0.0.1, log container đọc qua proxy chỉ đọc

- Trạng thái: Chấp nhận
- Ngày: 2026-11-24

## Bối cảnh

Người vận hành cần xem trên một trang: số yêu cầu, lỗi và độ trễ qua cổng, tình trạng từng dịch vụ, và log của mọi
dịch vụ ở một chỗ (#170). Trang này là công cụ kỹ thuật, chỉ mở trong máy chủ như trang quản trị Keycloak, Hasura.
Lõi phải chạy đủ khi không bật giám sát, như profile `ai` (ADR 0021).

Thành phần nào có số liệu dạng Prometheus, kiểm ngày 2026-11-24 trên đúng phiên bản ghim trong `compose.yaml`:

| Thành phần | Số liệu |
|---|---|
| APISIX 3.19.0 | Plugin `prometheus`: số yêu cầu theo route và mã trả về, histogram độ trễ; xuất ở cổng riêng 9091, mặc định chỉ nghe 127.0.0.1 trong container |
| Keycloak 26.7.5 | Có khi bật `KC_METRICS_ENABLED`, ở cổng quản lý 9000 (`/auth/metrics`) |
| Hasura CE 2.51.4 | Không có số liệu Prometheus ở bản CE; có `/healthz` |
| Flowable REST 7.2.0 | Không có endpoint Prometheus; endpoint sức khỏe đòi mật khẩu quản trị |
| workflow-api, files-api, context-api, assistant (tự viết) | Không có `/metrics`; có `/healthz` |

Cách thu log container đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Driver log Loki cài vào Docker của máy chủ | Đổi cấu hình Docker của cả máy chủ, ảnh hưởng container ngoài dự án; không dựng được bằng compose |
| Alloy gắn thẳng socket Docker | Alloy có toàn quyền Docker: tạo container, gắn thư mục máy chủ, tức quyền root trên máy chủ |
| Alloy hỏi Docker qua docker-socket-proxy chỉ cho đọc | Chặn mọi lệnh ghi; vẫn đọc được thông tin container (xem Hệ quả) |

## Quyết định

**Thành phần.** Profile `observability` của compose, chạy bằng `make obs-up`, dừng bằng `make obs-down` (giữ số liệu
và log). Mọi image là image chính thức, không sửa, ghim phiên bản:

| Thành phần | Phiên bản | Giấy phép | Vai trò |
|---|---|---|---|
| Prometheus | 3.16.0 | Apache-2.0 | Lấy và lưu số liệu |
| Grafana | 13.3.1 | AGPL-3.0 | Trang xem số liệu và log |
| Loki | 3.7.10 | AGPL-3.0 | Lưu log |
| Grafana Alloy | 1.22.0 | Apache-2.0 | Thu log container, đẩy vào Loki |
| Blackbox exporter | 0.29.1 | Apache-2.0 | Hỏi endpoint sức khỏe của dịch vụ không có số liệu riêng |
| docker-socket-proxy (Tecnativa) | 0.5.0 | Apache-2.0 (HAProxy bên trong: GPL-2.0-or-later, tiến trình riêng) | Cho Alloy đọc Docker, chặn mọi lệnh ghi |

**Chỉ Grafana mở cổng, và chỉ ở 127.0.0.1** (`GRAFANA_PORT`, mặc định 3000). Prometheus, Loki, Alloy, blackbox không
mở cổng ra máy chủ; Grafana hỏi chúng trong mạng nội bộ. Grafana đòi đăng nhập: tài khoản `admin`, mật khẩu
`GRAFANA_ADMIN_PASSWORD` do `make env` sinh; tắt truy cập ẩn danh, tự đăng ký, gửi thống kê và hỏi bản mới. Nguồn
dữ liệu (uid cố định `prometheus`, `loki`) và dashboard `mortise-overview` nạp từ `core/observability/grafana/`, không
sửa được trên giao diện.

**Thay đổi ở lõi, luôn bật.** APISIX bật plugin `prometheus` cho mọi route bằng `global_rules` và xuất số liệu ở
`0.0.0.0:9091` trong mạng nội bộ; `compose.yaml` không mở 9091 ra máy chủ, và không route nào ở cổng 9080 trả số liệu.
Keycloak bật `KC_METRICS_ENABLED`; cổng 9000 vẫn không mở ra máy chủ hay qua APISIX.

**Sức khỏe dịch vụ.** Blackbox hỏi `/healthz` của workflow-api, files-api, context-api, assistant, `/healthz` của
Hasura, `/auth/health/ready` ở cổng 9000 của Keycloak, trạng thái cụm của SeaweedFS, danh sách kiểu của Scorpio và
trang `/` của web. Flowable không có ở đây vì blackbox không giữ bí mật nào.

**Log.** Alloy tìm container theo nhãn `com.docker.compose.project=mortise`, vì máy chủ còn chạy container khác ngoài
dự án; nhãn `service` của log là tên dịch vụ compose, trùng nhãn `service` của số liệu. Proxy chỉ bật
`CONTAINERS` và `NETWORKS` (Alloy liệt kê cả mạng khi tìm container), `POST=0`, gắn socket chỉ đọc, và chỉ nằm trong
mạng `docker-api` riêng (`internal: true`) cùng Alloy.

**Thời gian giữ.** Prometheus 15 ngày, Loki 7 ngày; là điểm xuất phát, chưa đo dung lượng đĩa. Log giữ ngắn vì chứa
địa chỉ IP, mã và tên người dùng (log truy cập của cổng, sự kiện đăng nhập của Keycloak).

**Kiểm tra.** `make obs-check` hỏi qua Grafana: Grafana chạy, chỉ mở ở 127.0.0.1, từ chối yêu cầu không đăng nhập,
dashboard đã nạp; mọi đích của Prometheus lấy được; mọi dịch vụ trả lời blackbox; có số liệu route `graphql` của cổng;
Loki có log của `apisix` trong 5 phút qua; cổng 9080 không trả số liệu. CI chạy `make obs-up`, `make obs-check`, `make
obs-down` sau `make smoke` trên máy trắng.

## Hệ quả

- **Socket Docker.** Proxy chặn mọi lệnh ghi, nhưng đọc thông tin một container (`GET /containers/{id}/json`) trả cả
  biến môi trường, gồm mật khẩu CSDL và bí mật của lõi. Ai điều khiển được Alloy, hay một container khác trong mạng
  `docker-api`, đọc được các bí mật đó. Giảm bớt: mạng `docker-api` chỉ có proxy và Alloy, không ra internet; cấu hình
  Alloy chỉ đọc từ repo; Alloy không mở cổng ra máy chủ. Rủi ro còn lại được chấp nhận vì profile chỉ bật khi người
  vận hành chạy `make obs-up`; bản triển khai lên máy chủ thật xét lại cách thu log.
- **AGPL-3.0.** Grafana và Loki chạy bằng image chính thức, không sửa, là tiến trình riêng; mã Apache-2.0 của dự án
  không liên kết với chúng. Nghĩa vụ cung cấp mã nguồn cho người dùng qua mạng của AGPL-3.0 chỉ phát sinh với bản đã
  sửa; ai sửa Grafana hay Loki thì phải cung cấp mã nguồn bản sửa.
- **RAM và đĩa chưa đo.** Khuyến nghị RAM trong README chưa tính profile này; đo trước khi ghi con số.
- **Chưa phủ hết.** Hasura CE và Flowable không có số liệu riêng: thấy qua số liệu route `graphql` và `workflow` ở
  cổng, blackbox (Hasura) và log; lỗi của Flowable hiện thành 5xx của route `workflow`. Dịch vụ tự viết chỉ có sức khỏe
  và log, chưa có số liệu riêng.
- **Ai vào Grafana thì thấy log của mọi tenant.** Grafana là công cụ của người vận hành như trang quản trị Keycloak,
  Hasura; không mở qua cổng 9080.
- **Lần đầu bật,** Alloy đọc log của mỗi container từ lúc container khởi động (đã thử trên dự án compose tạm ngày
  2026-11-24); Loki bỏ dòng cũ hơn một tuần (giới hạn mặc định của Loki 3.7.10). Số liệu và log không nằm trong `make
  backup`.
- **Mật khẩu Grafana** chỉ áp dụng khi volume `grafanadata` còn trống; đổi `GRAFANA_ADMIN_PASSWORD` sau đó không đổi
  mật khẩu đã lưu.
- `make down` và `make reset` dừng và xóa cả container, volume của profile `observability`; không gồm profile `ai`, để
  `make reset` không xóa mô hình đã tải.
- Bản cài cũ chạy `make up` (thêm biến mới vào `.env`, dựng lại Keycloak với số liệu) rồi `docker compose restart
  apisix` để cổng nạp cấu hình mới.
