<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Mortise DX

Nền tảng chuyển đổi số nguồn mở theo kiến trúc DX-OS Open-Core: một lõi chạy ngầm, không giao diện, cung cấp định
danh, cổng API, dữ liệu và quy trình dùng chung; phía trên là các thành phần cấu hình được, để mỗi tổ chức tự lắp
thành hệ thống của mình mà không phải viết lại phần nền.

> **Trạng thái:** đang phát triển. Mục [Trạng thái](#trạng-thái) chỉ ghi những gì
> đã chạy thật và đã có kiểm tra tự động.

## Giới thiệu

Tổ chức chuyển đổi số hay rơi vào một trong hai cực: mua nhiều phần mềm rời rạc nên dữ liệu bị chia cắt, hoặc mua
một hệ thống nguyên khối và phụ thuộc một nhà cung cấp. Mortise DX tách ba tầng:

1. **Lõi (Tầng 1):** dịch vụ dùng chung cho mọi ứng dụng, chỉ có API.
2. **Thành phần dùng chung (Tầng 2):** danh mục, biểu mẫu, bảng việc, theo dõi hồ sơ, lưu trữ tài liệu, bản đồ, báo
   cáo, trợ lý AI; cấu hình bằng khai báo, không chứa nghiệp vụ của ngành nào.
3. **Gói nghiệp vụ (Tầng 3):** cấu hình và phần mở rộng cho một lĩnh vực; cài vào hoặc gỡ ra mà lõi vẫn chạy.

Mã nguồn mở và dữ liệu nằm trên máy chủ của tổ chức. Một bản cài phục vụ nhiều đơn vị (tenant) với dữ liệu tách
biệt.

## Trạng thái

| Năng lực | Trạng thái | Kiểm chứng |
|---|---|---|
| Giấy phép từng tệp, kiểm tra shell và YAML | Đã chạy | `make check-fast`, CI |
| Kiểm phụ thuộc: image, thư viện, mô hình ghim đúng phiên bản; giấy phép thư viện Python và image theo danh sách cho phép và bảng [Thành phần đang chạy](#thành-phần-đang-chạy); báo bản mới, không tự nâng cấp ([ADR 0039](docs/adr/0039-dependency-check-script.md)) | Đã chạy ở máy; báo cáo hằng tuần vào issue theo dõi đã cấu hình, chưa chạy | `make check-fast` (ghim, giấy phép), `make deps-check` (thêm bản mới) |
| Định danh / SSO (Keycloak, OIDC) | Đã chạy | `make smoke` |
| Cổng API duy nhất (APISIX), chặn yêu cầu không token hoặc token giả | Đã chạy | `make smoke` |
| Console quản trị không lộ qua cổng | Đã chạy | `make smoke` |
| API dữ liệu tự sinh (Hasura CE), cách ly dữ liệu theo tenant | Đã chạy | `make smoke` |
| Workflow BPMN (Flowable sau lớp workflow-api): cách ly tenant, phân quyền theo vai trò, quy tắc bốn mắt | Đã chạy | `make smoke`, `make test` |
| Bảng phân cấp thẩm quyền theo tenant: vai trò của một bước chọn lúc lập hồ sơ theo ngưỡng của hồ sơ; quản trị tenant cha sửa bảng của tenant con, hồ sơ lập sau đi theo bảng mới; bước đọc bảng cần OTP với mọi vai trò ([ADR 0028](docs/adr/0028-step-authority-table.md)) | Đã chạy | `make smoke` (quy trình mẫu `core-authority`), `make test`, `make check-fast` |
| Tệp qua cổng (`/v1/files`, SeaweedFS): tải lên, tải xuống theo tenant, giới hạn cỡ, quét mã độc trước khi lưu (ClamAV) | Đã chạy | `make smoke` (tệp thử EICAR), `make test` |
| Đăng nhập hai bước (OTP) cho người có quyền duyệt; workflow-api từ chối duyệt khi token không có bước OTP | Đã chạy | `make smoke`, `make test`, `make e2e` |
| Dữ liệu thiết bị: nhận số đo qua MQTT trong mạng riêng (mỗi thiết bị một tài khoản, chỉ gửi vào chủ đề của mình), giữ theo NGSI-LD (Scorpio), đọc trạng thái và lịch sử số đo qua `/v1/context` chỉ thấy thiết bị của đơn vị mình; bộ giả lập thiết bị (`make simulate`); số đo vượt ngưỡng liên tục đủ lâu thì tự mở hồ sơ trên bảng việc của đúng đơn vị theo luật khai báo (`contracts/threshold-rule.schema.json`), không mở trùng khi hồ sơ cũ còn mở | Đã chạy | `make smoke` (gồm bộ giả lập, luật mẫu), `make test` |
| Chính sách đăng nhập theo tenant: người vận hành bắt mọi tài khoản của một tenant nhập OTP (`make tenant-login`), tenant khác không đổi ([ADR 0040](docs/adr/0040-tenant-login-policy.md)) | Đã chạy | `make smoke` (tenant `tinh-khac`: thiếu mã bị từ chối, đổi về mặc định thì chỉ cần mật khẩu; xã A vẫn chỉ cần mật khẩu) |
| Đăng nhập bằng Passkey theo tenant (`make tenant-login POLICY=passkey`); người có `otp_required` vẫn nhập OTP sau Passkey ([ADR 0042](docs/adr/0042-passkey-login.md)) | Đã chạy | `make e2e` (bộ xác thực ảo: `user.c` thêm Passkey trên web rồi đăng nhập bằng nó, amr `hwk`; `manager.c` bị hỏi thêm OTP, amr `hwk`, `otp`; tenant chưa bật thì bị từ chối), `make smoke` (cấu hình realm) |
| Phân quyền chi tiết theo vai trò và đơn vị | Kế hoạch | |
| Nhật ký thay đổi: ai sửa gì, lúc nào, trước và sau; chuỗi băm phát hiện sửa lén, đối chiếu băm trong bản sao lưu | Đã chạy | `make smoke`, `make audit-verify` |
| Kho lạnh cho nhật ký: xuất dòng cũ sang Parquet trên SeaweedFS có kiểm băm từng dòng rồi xóa khỏi CSDL trong cùng giao dịch, chuỗi băm nối qua phần đã xóa, truy vấn gộp bằng DuckDB; chạy theo lịch là kế hoạch | Đã chạy | `make smoke`, `make archive`, `make cold-verify`, `make cold-query` |
| Chỉ số trỏ về bản ghi nguồn, chỉ số chất lượng dữ liệu | Kế hoạch | |
| Sao lưu và khôi phục toàn bộ lõi; diễn tập khôi phục trên máy trắng có đo thời gian từng giai đoạn ([docs/restore-drill.md](docs/restore-drill.md)) | Đã chạy | CI: `make restore-drill` (sao lưu trong lúc tải tệp lên → xóa cả volume, image, bộ đệm build → khôi phục không dựng lõi trước → `make smoke`) |
| Tự phục hồi: tiến trình chính của một dịch vụ thoát thì Docker dựng lại container (`restart: unless-stopped`); container còn chạy mà unhealthy, hay bị dừng bằng tay, thì không | Đã chạy | CI: `make heal-check SERVICE=workflow-api` (RestartCount tăng đúng 1, khỏe lại, `make smoke`) |
| Phát hành theo tag: CI kiểm, dựng image lên GitHub Container Registry, kéo lại không đăng nhập để smoke, tạo GitHub Release từ mục CHANGELOG kèm gói mã nguồn tar.gz và `SHA256SUMS` ([ADR 0036](docs/adr/0036-pull-based-gitops-with-compose.md)) | Đã chạy: [`v0.1.0`](https://github.com/clauki-org/mortise-dx/releases/tag/v0.1.0) | `.github/workflows/release.yml` trên tag `v0.1.0`: CI, e2e, diễn tập khôi phục, kéo image về máy trắng không đăng nhập, `make smoke`, `make heal-check` |
| Máy chủ demo tự kéo tag phát hành mới về (systemd timer), dựng, smoke, lỗi thì quay về tag trước; CSDL không tự khôi phục ([deploy/README.md](deploy/README.md)) | Chưa cài trên máy chủ | `deploy/pull-deploy.sh` đã thử trên bản sao với tag giả: bản tốt, bản smoke lỗi, bản chưa có image |
| Giám sát cho người vận hành (profile `observability`, [ADR 0037](docs/adr/0037-observability-profile.md)): Grafana chỉ ở 127.0.0.1, đòi đăng nhập, có dashboard số yêu cầu, lỗi 5xx, độ trễ p95 theo route của cổng, sức khỏe từng dịch vụ, đăng nhập lỗi và log của mọi dịch vụ (Prometheus, Loki, Alloy) | Đã chạy | CI: `make obs-up`, `make obs-check` (mọi đích của Prometheus lấy được, mọi dịch vụ trả lời blackbox, có số liệu cổng và log trong Loki, cổng 9080 không trả số liệu) |
| Truy vết phân tán, mặc định tắt (`MORTISE_TRACING=on` trong `.env`, [ADR 0038](docs/adr/0038-distributed-tracing.md)): một yêu cầu qua cổng tới dịch vụ tự viết rồi Flowable, Scorpio, CSDL hiện đủ các chặng trong Grafana (OpenTelemetry, Jaeger trong profile `observability`); chuỗi truy vấn, user-agent, địa chỉ người gọi bị bỏ trước khi lưu, header không được ghi; log của cổng mang mã vết | Đã chạy | CI: `make obs-check` khi bật truy vết (vết của `GET /v1/workflow/tasks` có cổng → workflow-api → Flowable, không chứa token, chuỗi truy vấn, tên người dùng; log của cổng trong Loki mang mã vết), `make smoke` khi bật |
| Khung giao diện Tầng 2: đăng nhập Authorization Code + PKCE, gọi API bằng token, header bảo mật | Đã chạy | `make smoke` (cổng, CSP, luồng PKCE), `make web-check`, `make e2e` |
| Bảng việc: danh sách việc đang chờ người đăng nhập theo hạn; màn hình xử lý với biểu mẫu và nút theo khai báo của bước | Đã chạy | `make e2e` (trình duyệt: duyệt, bốn mắt, cách ly đơn vị), `make web-check` |
| Menu dựng từ các gói đã cài; mục của gói mở thành phần danh mục (danh sách, tìm, lọc, chi tiết cha–con) theo cấu hình của gói, không có mã giao diện riêng của gói | Đã chạy | `make e2e` (trình duyệt: cán bộ xã A mở danh mục cơ sở từ menu, không thấy cơ sở của xã B; mọi mục menu của các gói đã cài mở được trang theo cấu hình), `make web-check` |
| Xuất danh sách của danh mục ra CSV, Excel (.xlsx) và PDF: mọi dòng khớp tìm, lọc đang xem, bằng quyền của người xuất, đầu tệp ghi nguồn, đơn vị, thời điểm, người xuất; CSV chặn công thức trong ô, Excel ghi ô chữ là chữ; mở tệp bằng Excel, LibreOffice chưa kiểm | Đã chạy | `make e2e` (trình duyệt: tệp CSV và Excel tải về khớp màn hình và giá trị API trả cho người xuất, không có dòng ngoài quyền; tệp PDF tải về được), `make web-check` |
| Trợ lý hỏi dữ liệu: câu mẫu của gói chạy câu GraphQL chỉ đọc qua guard (một thao tác query, chỉ bảng, cột gói khai, có limit, không introspection), bằng token người hỏi qua Hasura; kết quả là bảng kèm câu truy vấn đã chạy, mỗi câu có dòng nhật ký không kèm dòng dữ liệu; câu hỏi gõ tự do (mô hình viết câu) là kế hoạch | Đã chạy | `make test` (bảng ca của guard), `make check-fast` (câu mẫu qua guard), `make smoke`, `make e2e`, smoke gói xã (cách ly xã, lời chèn lệnh trong tên cơ sở) |
| Thành phần bản đồ: lớp điểm theo cấu hình của gói trên nền trơn (không tải tile), tô màu theo giá trị, chú giải và danh sách điểm; lớp khai vai trò chỉ truy vấn khi token có vai trò đó | Đã chạy | `make web-check` |
| Thành phần biểu mẫu nhập liệu: trường và danh sách chọn theo cấu hình của gói, khởi tạo quy trình (Idempotency-Key) hoặc thêm một dòng vào bảng của gói bằng token người dùng; `make check-fast` kiểm biểu mẫu với quy trình, khai báo bước và quyền Hasura của gói | Đã chạy | `make check-fast` (biểu mẫu sai bị từ chối), `make web-check`; `make e2e` (trình duyệt: cán bộ xã A lập đề nghị cấp vật tư, bấm đúp chỉ một hồ sơ, người duyệt xã A thấy kèm giá trị đã điền, xã B không thấy; quản trị xã A thêm vật tư, dòng thuộc xã A, xã B không thấy) |
| Theo dõi hồ sơ cho người lập: danh sách hồ sơ mình đã lập, bước đang chờ cùng vai trò hay đơn vị xử lý, các bước đã qua (kể cả bước chờ hẹn giờ) và kết quả; chỉ người lập thấy, không thấy ý kiến, quyết định hay danh tính người xử lý ([ADR 0032](docs/adr/0032-case-tracking-for-initiators.md)) | Đã chạy | `make smoke` (người cùng xã, xã khác, tỉnh nhận 404), `make test`, `make web-check`, smoke hai gói; `make e2e` (trình duyệt: cán bộ xã A lập đề nghị, theo dõi tới khi được duyệt, không thấy ý kiến; quản trị cùng xã và xã B không mở được) |
| Thành phần bảng điều hành: thẻ số và biểu đồ cột ngang theo cấu hình của gói, số đọc qua GraphQL là cột do gói tính sẵn (không tính trên trình duyệt), khối chính nổi bật, cách tính và câu truy vấn đã gửi trong mục thu gọn, biểu đồ ghi số trên thanh, luôn kèm bảng số liệu (thu gọn); khối khai vai trò chỉ truy vấn khi token có vai trò đó; `make check-fast` kiểm bảng, cột với quyền Hasura của gói ([ADR 0033](docs/adr/0033-dashboard-component.md), [ADR 0045](docs/adr/0045-readable-dashboard.md)) | Đã chạy | `make check-fast` (cấu hình sai bị từ chối), `make web-check` |
| Số hồ sơ và số đo thiết bị trên bảng điều hành: workflow-api đếm hồ sơ của một quy trình trong tenant (còn mở, đã kết thúc, bước quá hạn, theo bước), chỉ người có vai trò của một bước xem được, không trả biến hay tên người; khối việc đang chờ người xem; khối số đo mới nhất của thiết bị qua context-api ([ADR 0035](docs/adr/0035-case-counts-and-device-readings-on-dashboards.md)) | Đã chạy | `make test`, `make smoke` (số đổi khi lập và duyệt hồ sơ, tenant khác không đổi, vai trò ngoài quy trình nhận 404), `make check-fast`, `make web-check` |
| Gói minh họa `apps/facilities-commune`: bảng cơ sở, tòa, phòng cách ly theo tenant, cán bộ chỉ thấy và sửa cơ sở được phân công (xã tự sửa phân công), có nhật ký; cài vào, gỡ ra bằng `make app-install`, `make app-uninstall`, kèm menu của gói; quy trình, khai báo bước và luật ngưỡng của gói nạp cùng lúc bằng bộ nạp chung với `make seed` | Đã chạy | CI: cài gói → smoke gói (gồm menu theo tenant) → `make seed`, `make smoke` khi gói đang cài → gỡ gói → `make smoke` |
| Gói minh họa: dữ liệu demo ba xã của "Tỉnh Mẫu" (hư cấu), nạp qua cổng bằng `make seed-demo` | Đã chạy | CI: `make seed-demo`, smoke gói kiểm tổng diện tích từng xã |
| Gói minh họa: diện tích được phép và phần vượt tiêu chuẩn, định mức của từng xã theo NĐ 155/2025 sửa bởi NĐ 369/2026, mức m² có trích dẫn | Đã chạy | CI: smoke gói kiểm kết quả ba xã |
| Gói minh họa: tỉnh xem tổng hợp diện tích của các xã (tenant cha, vai trò `rollup_reader`), và mã, tên, tọa độ trụ sở đang dùng của từng xã kèm phần vượt; không đọc được bảng cơ sở, tòa, phòng của xã | Đã chạy | CI: smoke gói kiểm tỉnh thấy đúng ba xã, số khớp số của xã, thấy trụ sở đang dùng có tọa độ, không đọc được bảng cơ sở, phòng |
| Gói minh họa: độ ẩm kho lưu trữ vượt ngưỡng (ngưỡng minh họa) liên tục 5 phút thì người duyệt của xã có việc "Kiểm tra kho lưu trữ" | Đã chạy | CI: smoke gói gửi số đo qua MQTT, kiểm việc mở đúng xã, không mở trùng |
| Gói minh họa: quy trình rà soát hồ sơ: cán bộ lập hồ sơ từ màn hình chi tiết của cơ sở trên web, bốn mắt, phần vượt trên ngưỡng thì công khai có hẹn giờ rồi trình người có thẩm quyền, bước quyết định tới vai trò theo bảng phân cấp của xã; ngưỡng và thời hạn là settings của gói | Đã chạy | CI: smoke gói chạy quy trình qua API (thời hạn công khai 20 giây; tỉnh đổi bảng phân cấp thì hồ sơ lập sau tới vai trò mới); `make e2e` (trình duyệt: lập hồ sơ từ cơ sở, hồ sơ hiện trên bảng việc người duyệt cùng xã, không hiện ở xã khác) |
| Giấy tờ đính kèm trên màn hình chi tiết của danh mục (`detail.documents`): danh sách tệp theo quyền Hasura của bảng nối của gói, tải xuống, đính kèm qua `/v1/files`, tệp bị quét mã độc từ chối thì báo tiếng Việt và không gắn; `make check-fast` kiểm bảng, cột với quyền của gói ([ADR 0041](docs/adr/0041-documents-on-catalog-records.md)) | Đã chạy | `make check-fast` (cấu hình sai bị từ chối), `make web-check`; smoke gói (`tests/documents.sh`); `make e2e` (`documents.spec.ts`: cán bộ xã A đính kèm biên bản, người duyệt xã A tải về, xã B nhận 404, EICAR bị từ chối) |
| Gói minh họa: bản đồ trụ sở tô theo phần vượt của xã; tỉnh thấy trụ sở đang dùng của các xã con | Đã chạy | `make e2e` (trình duyệt: cán bộ xã A thấy trụ sở mình phụ trách, không thấy xã B; `leader.tinh` thấy trụ sở của hai xã) |
| Gói minh họa: bảng điều hành của xã (diện tích được phép, đang dùng, phần vượt, dôi dư; số cơ sở theo trạng thái; diện tích theo loại; biên chế; lãnh đạo thấy cơ sở chưa được phân công, số hồ sơ rà soát theo bước và số hồ sơ kiểm tra kho do luật ngưỡng mở; việc đang chờ người xem; độ ẩm thiết bị); tỉnh thấy số của từng xã con | Đã chạy | Smoke gói kiểm số của các view với dữ liệu demo và số hồ sơ rà soát (tăng khi lập, xã B không đổi, vai trò trong bảng phân cấp xem được); `make e2e` (trình duyệt: số của cán bộ xã A bằng số Hasura trả cho chính tài khoản đó, xã B không thấy số của xã A, `leader.tinh` thấy dòng của xã A bằng đúng số đó, lãnh đạo xã A thấy khối phân công, số hồ sơ rà soát và việc đang chờ mình bằng số API trả, cán bộ không thấy khối số hồ sơ) |
| Gói minh họa: tỉnh duyệt bước được phân cấp: hồ sơ rà soát vượt ngưỡng minh họa của dòng `scope: parent` có bước quyết định ở người duyệt của tỉnh; tỉnh chỉ thấy bước đó, không thấy bước khác hay trạng thái hồ sơ; xã khác, tỉnh khác nhận 404 ([ADR 0029](docs/adr/0029-parent-completes-delegated-step.md)) | Đã chạy | CI: smoke gói (thời hạn công khai 20 giây: `manager.tinh` ghi nhận quyết định của hồ sơ xã A); `make smoke` (quy trình mẫu `core-authority`, gồm đổi tạm tenant cha của xã A); `make test` |
| Gói thứ hai `apps/supplies-commune` (kho vật tư xã) chỉ gồm tệp khai báo, không có mã chạy: kho và vật tư cách ly theo tenant, cán bộ và lãnh đạo xã chỉ đọc, quản trị xã ghi, có nhật ký; danh mục kho → vật tư trên menu; đề nghị cấp vật tư lập trên web tới người duyệt của xã, bốn mắt; quản trị xã thêm vật tư bằng biểu mẫu; dữ liệu demo nạp bằng bộ nạp chung; gỡ ra thì lõi và gói xã vẫn chạy | Đã chạy | `make check-fast` (gói không có tệp mã); CI: cài cùng gói xã → `make seed-demo` → smoke hai gói → `make e2e` → gỡ gói kho → `make smoke`, smoke gói xã |

## Chạy từ mã nguồn

Yêu cầu: Linux hoặc macOS, Docker Engine 24+ với Compose v2, `make`, `curl`, `jq`, `openssl` và
[`uv`](https://docs.astral.sh/uv/) (`make smoke` dùng nó để kiểm token theo hợp đồng). Khuyến nghị 8 GB RAM trở lên;
riêng ClamAV dùng khoảng 1 GB. Phát triển giao diện cần thêm Node.js 26.

```bash
make up      # tạo .env với bí mật ngẫu nhiên, dựng lõi, chờ sẵn sàng
make seed    # tài khoản demo cho 3 xã của "Tỉnh Mẫu" (hư cấu) và quyền dữ liệu
make smoke   # kiểm tra đầu-cuối qua cổng
make e2e     # kịch bản demo trên trình duyệt (cần Node và hai gói: make app-install APP=facilities-commune, APP=supplies-commune)
```

| Địa chỉ | Dịch vụ |
|---|---|
| `http://localhost:9080/` | Giao diện (đăng nhập bằng tài khoản demo bên dưới) |
| `http://localhost:9080/auth/...` | Đăng nhập, cấp token (qua cổng) |
| `http://localhost:9080/v1/graphql` | API dữ liệu, bắt buộc token |
| `http://localhost:9080/v1/workflow/...` | API quy trình, bắt buộc token |
| `http://localhost:9080/v1/files` | API tệp, bắt buộc token |
| `http://localhost:9080/v1/context/entities` | Dữ liệu thiết bị (NGSI-LD), chỉ đọc, bắt buộc token |
| `http://localhost:9080/v1/assistant/questions` | Trợ lý hỏi văn bản, bắt buộc token; trả lời cần bật profile `ai` hay khai API |
| `http://localhost:9080/v1/assistant/data-queries` | Trợ lý hỏi dữ liệu: câu GraphQL chỉ đọc qua guard, bắt buộc token; không cần mô hình |
| `http://127.0.0.1:8081/auth/admin` | Quản trị Keycloak (chỉ máy chủ) |
| `http://127.0.0.1:8082/console` | Quản trị Hasura (chỉ máy chủ) |
| `http://127.0.0.1:8083/flowable-rest/docs` | REST API của Flowable (chỉ máy chủ) |
| `http://127.0.0.1:9090/ngsi-ld/v1/...` | API NGSI-LD của Scorpio, không xác thực (chỉ máy chủ) |
| `http://127.0.0.1:3000` | Grafana: số liệu, log, sức khỏe dịch vụ (chỉ máy chủ, sau `make obs-up`) |

Trang quản trị Keycloak, Hasura, Flowable và Grafana là công cụ kỹ thuật cho người vận hành, chỉ mở trong máy chủ; lõi không có giao
diện cho người dùng nghiệp vụ. Cách gọi API kèm ví dụ và ý nghĩa mã lỗi: [docs/api.md](docs/api.md).

Sao lưu và khôi phục (đã kiểm: sao lưu trong lúc đang tải tệp lên, xóa sạch lõi, dựng lại, khôi phục, `core.files`
khớp kho tệp, `make smoke` qua):

```bash
make backup                                       # CSDL, tệp, .env → ~/.local/share/mortise-dx/backups/<thời điểm>
make restore FROM=<thư mục sao lưu> CONFIRM=yes   # GHI ĐÈ dữ liệu hiện tại
```

Trong lúc sao lưu, các dịch vụ ghi dữ liệu dừng, kể cả cổng: người dùng và thiết bị không gọi được lõi cho tới khi sao
lưu xong. Nhờ vậy CSDL, CSDL của Scorpio và kho tệp trong bản sao lưu cùng một thời điểm. Diễn tập khôi phục trên máy
trắng và kết quả đo: [docs/restore-drill.md](docs/restore-drill.md).

Bản phát hành là một tag `vX.Y.Z`; máy chủ demo chạy image CI đã dựng cho tag đó và tự kéo bản mới về: cài đặt, ghim
bản, quay về và khôi phục ở [deploy/README.md](deploy/README.md).

Tài khoản demo: `user.a`, `manager.a`, `admin.a` (tenant `xa-a`), tương tự `.b` cho `xa-b` và `.c` cho `xa-c`, ba xã
của "Tỉnh Mẫu", tỉnh hư cấu; ở tenant cha `tinh-mau` có `leader.tinh` (đọc tổng hợp của ba xã), `admin.tinh` (quản trị
tỉnh, sửa bảng phân cấp thẩm quyền của các xã) và `manager.tinh` (người duyệt của tỉnh, làm các bước thuộc thẩm
quyền của tỉnh trong hồ sơ của xã); tenant `tinh-khac` ("Tỉnh Khác", không có xã) có `manager.k` và `user.k`; mật
khẩu là `DEMO_USER_PASSWORD` trong `.env`. `admin.*` có vai trò `tenant_admin` (quản trị xã); `admin2.a` cũng là
quản trị xã A nhưng có thêm `otp_required`, nhận được bước mà workflow-api gán cho `tenant_admin` theo bảng phân cấp.
Người duyệt (`manager.*`), `admin2.a` và mọi tài khoản của `tinh-khac` (tenant có chính sách bắt buộc OTP, nên cả
`user.k`) nhập thêm mã OTP: `make otp` in mã hiện tại và khóa để nhập vào ứng dụng OTP trên điện thoại
([ADR 0011](docs/adr/0011-approver-mfa.md), [ADR 0040](docs/adr/0040-tenant-login-policy.md)). Thiết bị demo nằm
trong `devices/simulator/devices.yaml`, mật khẩu MQTT `DEMO_DEVICE_PASSWORD`; `make simulate` gửi số đo giả cho chúng.
Thiết bị khác cấp tài khoản bằng `make device-add TENANT=<tenant> DEVICE=<thiết bị>`. Mọi lệnh khác: `make help`.

Mô hình ngôn ngữ của trợ lý hỏi văn bản chạy tại chỗ bằng Ollama, tách khỏi lõi trong profile `ai`: `make ai-up` chạy
Ollama, tải mô hình đã ghim (lần đầu cần mạng) và dừng nếu trọng số khác digest đã ghim
([ADR 0021](docs/adr/0021-document-assistant.md)). Trợ lý chạy cùng lõi; chưa bật profile thì câu hỏi cần mô hình
nhận 503 kèm cách bật. Muốn gọi một API tương thích OpenAI thay cho Ollama, khai
`ASSISTANT_LLM_PROVIDER=openai-compatible` cùng `ASSISTANT_LLM_BASE_URL`, `ASSISTANT_LLM_MODEL`, `ASSISTANT_LLM_API_KEY`
trong `.env` rồi chạy `make up`; câu hỏi và các câu đã tìm khi đó rời máy chủ (bổ sung của ADR 0021).

Giám sát cũng tách khỏi lõi, trong profile `observability`: `make obs-up` chạy Prometheus, Loki, Alloy và Grafana ở
`http://127.0.0.1:3000` (tài khoản `admin`, mật khẩu `GRAFANA_ADMIN_PASSWORD` trong `.env`), `make obs-check` kiểm
chúng, `make obs-down` dừng mà giữ số liệu và log ([ADR 0037](docs/adr/0037-observability-profile.md)). RAM mà
profile này cần chưa được đo. Truy vết phân tán mặc định tắt: đặt `MORTISE_TRACING=on` trong `.env`, chạy `make up` và
`make obs-up`, rồi xem vết trong Grafana, mục Explore, nguồn Jaeger ([ADR 0038](docs/adr/0038-distributed-tracing.md)).

## Kiến trúc

```
Tầng 3  gói nghiệp vụ (cấu hình + mở rộng)    ── cài vào / gỡ ra
Tầng 2  thành phần dùng chung + giao diện      ── chỉ gọi lõi qua cổng
          │ HTTPS + access token
Tầng 1  APISIX (cổng duy nhất, kiểm JWT, giới hạn tần suất)
          ├─ Keycloak   định danh, SSO, vai trò, tenant
          ├─ Hasura CE  API GraphQL tự sinh, quyền theo dòng
          ├─ workflow-api → Flowable  quy trình BPMN theo tenant và vai trò
          ├─ files-api → SeaweedFS    tệp theo tenant, giới hạn cỡ, quét mã độc (ClamAV)
          ├─ context-api → Scorpio    dữ liệu thiết bị theo NGSI-LD, chỉ đọc, theo tenant
          │    ↑ iot-bridge ← Mosquitto (MQTT, mạng ot riêng) ← thiết bị
          │      └→ workflow-api khi số đo vượt ngưỡng (luật của gói)
          ├─ PostgreSQL dữ liệu có cấu trúc (+ pgvector)
          └─ SeaweedFS  dữ liệu phi cấu trúc (S3)
```

Lý do chọn từng thành phần và kiểm tra giấy phép: [ADR 0002](docs/adr/0002-core-components.md). Bố cục ba tầng
trong repo: [ADR 0003](docs/adr/0003-three-tier-layout.md) và [AGENTS.md](AGENTS.md#2-bố-cục). Vì sao Flowable
đứng sau một lớp kiểm soát quyền: [ADR 0004](docs/adr/0004-workflow-access-control.md).

### Thành phần đang chạy

| Vai trò | Thành phần | Phiên bản | Giấy phép |
|---|---|---|---|
| Định danh, SSO | Keycloak | 26.7.5 | Apache-2.0 |
| Cổng API | Apache APISIX (standalone) | 3.19.0 | Apache-2.0 |
| CSDL | PostgreSQL + pgvector | 17 + 0.8.7 | PostgreSQL License |
| API dữ liệu tự sinh | Hasura GraphQL Engine CE | 2.51.4 | Apache-2.0 |
| Lưu trữ đối tượng | SeaweedFS | 4.52 | Apache-2.0 |
| Migration lược đồ CSDL | dbmate | 2.37.0 | MIT |
| Động cơ quy trình | Flowable REST | 7.2.0 | Apache-2.0 |
| Quét mã độc ([ADR 0010](docs/adr/0010-upload-malware-scan.md)) | ClamAV | 1.5.4 | GPL-2.0 (tiến trình riêng, không liên kết mã) |
| Broker NGSI-LD, dữ liệu thiết bị ([ADR 0012](docs/adr/0012-device-context-ngsi-ld.md)) | Scorpio (bản native) | 6.0.2 | BSD-3-Clause |
| CSDL của Scorpio | PostgreSQL + PostGIS | 17 + 3.6 | PostgreSQL License / GPL-2.0 (tiến trình riêng) |
| Nhận số đo thiết bị (MQTT) | Eclipse Mosquitto | 2.1.2 | EPL-2.0 / EDL-1.0 |
| Lớp kiểm quyền quy trình (tự viết) | Python 3.13, FastAPI, HTTPX, PyJWT, pg8000, OpenTelemetry | khóa trong `core/workflow-api/uv.lock` | Python-2.0.1 / MIT / BSD-3-Clause / Apache-2.0 / MIT-0 / MPL-2.0 (certifi) |
| API tệp (tự viết) | Python 3.13, FastAPI, boto3, pg8000, PyJWT, OpenTelemetry | khóa trong `core/files-api/uv.lock` | Python-2.0.1 / MIT / BSD-3-Clause / Apache-2.0 / MIT-0 |
| Lớp đọc dữ liệu thiết bị (tự viết) | Python 3.13, FastAPI, HTTPX, PyJWT, OpenTelemetry | khóa trong `core/context-api/uv.lock` | Python-2.0.1 / MIT / BSD-3-Clause / Apache-2.0 / MIT-0 / MPL-2.0 (certifi) |
| Cầu nối MQTT sang NGSI-LD (tự viết) | Python 3.13, paho-mqtt, HTTPX, pg8000 | khóa trong `core/iot-bridge/uv.lock` | Python-2.0.1 / EPL-2.0 / EDL-1.0 (paho-mqtt) / BSD-3-Clause / MIT / MIT-0 / Apache-2.0 / MPL-2.0 (certifi) |
| Truy vấn kho lạnh ([ADR 0014](docs/adr/0014-cold-audit-archive.md)) | DuckDB | 2.0.0 | MIT |
| Công cụ kho lạnh (tự viết) | Python 3.13, DuckDB, pg8000, boto3 | khóa trong `core/cold-archive/uv.lock` | Python-2.0.1 / MIT / BSD-3-Clause / Apache-2.0 / MIT-0 |
| Chạy mô hình ngôn ngữ tại chỗ, tùy chọn: profile `ai` ([ADR 0021](docs/adr/0021-document-assistant.md)) | Ollama | 0.40.16 | MIT |
| Mô hình ngôn ngữ, tải khi `make ai-up` | Qwen3.5 4B | digest trọng số ghim trong `core/ollama/models.txt` | Apache-2.0 |
| Lấy và lưu số liệu, tùy chọn: profile `observability` ([ADR 0037](docs/adr/0037-observability-profile.md)) | Prometheus | 3.16.0 | Apache-2.0 |
| Trang xem số liệu và log, profile `observability` | Grafana | 13.3.1 | AGPL-3.0 (image chính thức, không sửa, tiến trình riêng) |
| Lưu log, profile `observability` | Grafana Loki | 3.7.10 | AGPL-3.0 (image chính thức, không sửa, tiến trình riêng) |
| Thu log container, profile `observability` | Grafana Alloy | 1.22.0 | Apache-2.0 |
| Hỏi sức khỏe dịch vụ, profile `observability` | Blackbox exporter | 0.29.1 | Apache-2.0 |
| Lưu vết phân tán, profile `observability` ([ADR 0038](docs/adr/0038-distributed-tracing.md)) | Jaeger | 2.20.0 | Apache-2.0 |
| Cho Alloy đọc Docker, chặn lệnh ghi, profile `observability` | docker-socket-proxy (Tecnativa) | 0.5.0 | Apache-2.0 (HAProxy bên trong: GPL-2.0-or-later) |
| Trợ lý hỏi văn bản và dữ liệu (tự viết) | Python 3.13, FastAPI, HTTPX, PyJWT, pg8000, OpenTelemetry | khóa trong `platform/services/assistant/uv.lock` | Python-2.0.1 / MIT / BSD-3-Clause / Apache-2.0 / MIT-0 / MPL-2.0 (certifi) |
| Phân tích câu GraphQL cho guard của trợ lý dữ liệu ([ADR 0027](docs/adr/0027-data-assistant-guarded-graphql.md)) | graphql-core | 3.3.2 | MIT |
| Phục vụ giao diện | nginx | 1.30.6 | BSD-2-Clause |
| Giao diện Tầng 2 (tự viết) | React, Mantine, oidc-client-ts, urql, React Router, TanStack Query, rjsf, Tabler Icons (`@tabler/icons-react`) ([ADR 0006](docs/adr/0006-frontend-stack.md)) | khóa trong `platform/web/package-lock.json` | MIT / Apache-2.0 |
| Vẽ bản đồ trong giao diện ([ADR 0024](docs/adr/0024-map-component.md)) | MapLibre GL JS | 6.18.0 | BSD-3-Clause |
| Đọc nền bản đồ PMTiles trong giao diện ([ADR 0056](docs/adr/0056-self-hosted-osm-basemap.md)) | pmtiles | 4.5.0 | BSD-3-Clause |
| Kiểu vẽ nền bản đồ (bỏ chữ, khối nhà, ranh giới) | `@protomaps/basemaps` | 5.7.2 | BSD-3-Clause |
| Cắt nền bản đồ lúc cài, chỉ chạy khi `make basemap` | go-pmtiles | 1.31.2 | BSD-3-Clause |
| Dữ liệu nền bản đồ, tải khi `make basemap`, không nằm trong repo | OpenStreetMap qua bản dựng Protomaps | bản dựng ghim trong `platform/web/basemap.pins` | ODbL-1.0 (ghi nguồn trên bản đồ; tệp cắt ra là cơ sở dữ liệu phái sinh, chia sẻ lại thì theo ODbL) |
| Phông chữ nền bản đồ, chỉ khi `make basemap LABELS=on` | Noto Sans (glyph PBF của basemaps-assets) | commit ghim trong `platform/web/basemap.pins` | OFL-1.1 |
| Phông chữ của giao diện, đóng gói cùng tệp tĩnh ([ADR 0048](docs/adr/0048-bento-tokens-status-tones-font.md)) | Be Vietnam Pro (`@fontsource/be-vietnam-pro`) | 5.3.0 | OFL-1.1 |
| Ghi tệp Excel khi xuất danh sách ([ADR 0052](docs/adr/0052-catalog-export.md)) | write-excel-file | 4.1.1 | MIT |
| Dựng tệp PDF khi xuất danh sách, kèm font Roboto ([ADR 0052](docs/adr/0052-catalog-export.md)) | pdfmake | 0.3.14 | MIT (font Roboto: Apache-2.0; sax: BlueOak-1.0.0) |

Từng thành phần và công cụ phát triển làm gì, cấu hình ở đâu, xem thế nào: [docs/tools.md](docs/tools.md).

## Bố cục repo hiện tại

```
compose.yaml          các dịch vụ lõi và cách nối với nhau
Makefile              lối vào duy nhất: dựng, kiểm tra, sao lưu
contracts/            hợp đồng API giữa các tầng: claim token, app.yaml, khai báo bước, cấu hình thành phần, OpenAPI
core/                 Tầng 1: cấu hình lõi và dịch vụ tự viết của lõi
  apisix/ keycloak/ postgres/
  hasura/             bảng Hasura đăng ký và quyền theo vai trò (khai báo)
  postgres/migrations/  migration lược đồ của lõi (dbmate)
  workflow-api/       kiểm quyền trước Flowable (Python)
  files-api/          API tệp trước SeaweedFS (Python)
  context-api/        đọc dữ liệu thiết bị trước Scorpio (Python)
  iot-bridge/         nhận số đo qua MQTT, ghi vào Scorpio, mở hồ sơ khi vượt ngưỡng (Python)
  mosquitto/          cấu hình Mosquitto
  cold-archive/       xuất nhật ký cũ sang kho lạnh, truy vấn bằng DuckDB (Python, lệnh của người vận hành)
  ollama/             mô hình Ollama tải về, ghim theo digest trọng số
  observability/      cấu hình giám sát: Prometheus, Loki, Alloy, blackbox, Jaeger, nguồn dữ liệu và dashboard Grafana
  workflow/fixtures/  quy trình mẫu chỉ dùng để kiểm thử lõi
platform/             Tầng 2
  web/                khung giao diện (React, Vite), phục vụ bằng nginx sau cổng
  services/assistant/ trợ lý: hỏi văn bản (tìm đoạn theo quyền người hỏi, sinh tại chỗ hay qua API, kiểm câu trích)
                      và hỏi dữ liệu (câu GraphQL chỉ đọc qua guard) (Python)
  schema/migrations/  migration lược đồ `platform` (dbmate): khai báo bước của quy trình, menu của gói
apps/facilities-commune/  Tầng 3: gói cơ sở vật chất xã (app.yaml, migration, quyền Hasura, smoke của gói)
apps/supplies-commune/    Tầng 3: gói kho vật tư xã, chỉ gồm tệp khai báo (ADR 0022)
devices/simulator/    bộ giả lập và danh sách thiết bị demo (Python)
deploy/               máy chủ demo: script kéo tag phát hành mới, unit systemd, hướng dẫn
scripts/              tạo .env, seed, smoke, tạo migration, cài và gỡ gói, sao lưu, khôi phục, diễn tập khôi phục,
                      kiểm tự phục hồi, ghi chú phát hành, hook pre-push
docs/                 quyết định kiến trúc (adr/), API của lõi (api.md), công cụ (tools.md), diễn tập khôi phục
.github/              CI, phát hành theo tag, kiểm phụ thuộc hằng tuần, mẫu issue và pull request
```

## Giấy phép

Mã nguồn của dự án phát hành theo [Apache-2.0](LICENSE). Mỗi tệp có header SPDX; kiểm tra bằng `make check-fast`
(công cụ [REUSE](https://reuse.software)). Thành phần bên thứ ba chạy dưới dạng container chính thức, không sửa mã,
và giữ giấy phép riêng (bảng trên và ADR 0002); `make check-fast` đối chiếu bảng với image trong `compose.yaml`.

## Đóng góp

Xem [CONTRIBUTING.md](CONTRIBUTING.md) và [quy tắc ứng xử](CODE_OF_CONDUCT.md); quy tắc làm việc ở
[AGENTS.md](AGENTS.md). Báo lỗi tại mục Issues, lỗ hổng bảo mật theo [SECURITY.md](SECURITY.md).
