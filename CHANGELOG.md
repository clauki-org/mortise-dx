<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), đánh số
phiên bản theo [Semantic Versioning](https://semver.org/lang/vi/).

## [Unreleased]

### Added

- Tài khoản dịch vụ cho workflow-api (ADR 0017): client Keycloak `mortise-iot-bridge` (client credentials, secret
  `IOT_BRIDGE_CLIENT_SECRET`, tạo bằng `make seed`) mở quy trình thay cho tenant ghi ở header `X-Mortise-Tenant`, chỉ
  được khởi tạo; `Idempotency-Key` của dịch vụ chỉ khớp quy trình còn mở. Hợp đồng
  `contracts/service-token-claims.schema.json`. Bản cài cũ chạy `make env`, `make up` rồi `make seed` để có secret,
  cấu hình workflow-api và client.
- Tenant cha (ADR 0016): cột `core.tenants.parent_id`, vai trò `rollup_reader` để tenant cha đọc tổng hợp của
  tenant con qua view của gói; dữ liệu demo có tenant `tinh-mau` là cha của ba xã, tài khoản `leader.tinh` thấy
  diện tích được phép, đang dùng và phần vượt của ba xã (view `area_rollup`) mà không đọc được cơ sở, tòa, phòng.
- Phân công cán bộ theo cơ sở trong gói `facilities-commune` (ADR 0015): cán bộ chỉ thấy và sửa cơ sở mình được
  phân công; `manager` đọc toàn xã; `tenant_admin` (tài khoản demo `admin.a`, `admin.b`, `admin.c`) tạo cơ sở và tự
  sửa phân công qua GraphQL. `scripts/hasura-metadata.py` quản lý cả quan hệ Hasura.
- Gói `facilities-commune` tính diện tích được phép và phần vượt tiêu chuẩn, định mức của từng xã theo NĐ 155/2025
  sửa bởi NĐ 369/2026 (view `area_summary`), từ biên chế theo dòng phụ lục mức m² có trích dẫn và diện tích
  chuyên dùng; dữ liệu demo có biên chế, xã A vượt 420 m².
- `make app-install` nạp cả quy trình BPMN, khai báo bước và menu của gói cho mọi xã; menu đọc được qua GraphQL
  (`platform_menu_items`) kèm nội dung cấu hình. `make app-uninstall` xóa chúng, kể cả hồ sơ đang chạy theo quy
  trình của gói. Xã tạo sau khi cài gói thì chạy lại `make app-install`.
- `make seed-demo`: dữ liệu demo hư cấu của ba xã cho gói `facilities-commune` (cơ sở, tòa, phòng), nạp qua cổng bằng
  tài khoản của từng xã; chạy lại không tạo bản trùng.
- Khung giao diện Tầng 2 tại `/` của cổng (`platform/web/`, React, Mantine): đăng nhập Authorization Code + PKCE
  qua Keycloak, đăng xuất, tự làm mới token, đọc đơn vị của người dùng qua GraphQL. nginx phục vụ tệp tĩnh kèm
  Content-Security-Policy; đường sai dưới `/v1` trả 404. `make web-check` (Biome, kiểu, build, giấy phép phụ thuộc)
  chạy trong CI; `make seed` cho máy chủ phát triển giao diện (`localhost:5173`) đăng nhập được.
- Giấy phép Apache-2.0 và header SPDX cho mọi tệp, kiểm bằng `make check-fast`; hook pre-push qua `make hooks`;
  CI chạy đúng lệnh này với mọi pull request.
- Quy tắc làm việc (`AGENTS.md`), hướng dẫn đóng góp, quy tắc ứng xử, chính sách bảo mật, mẫu issue và pull
  request.
- ADR 0001 về quy ước dự án, ADR 0002 về chọn thành phần lõi và giấy phép, ADR 0003 về bố cục ba tầng.
- Lõi Tầng 1 chạy bằng Docker Compose: PostgreSQL + pgvector, Keycloak, APISIX (standalone), Hasura CE, SeaweedFS.
- Cổng APISIX chặn yêu cầu không token hoặc token giả, chặn console quản trị Keycloak, giới hạn tần suất API theo
  token (không theo IP, để người dùng sau cùng một NAT hay tunnel không chặn lẫn nhau).
- Hai tenant demo cách ly dữ liệu bằng claim `tenant` và quyền Hasura theo dòng.
- `make up`, `make seed`, `make smoke` (kiểm tra đầu-cuối); CI dựng lõi trên máy trắng và chạy smoke.
  `make env` tự thêm biến mới từ `.env.example` vào `.env` đã có.
- Tài liệu API của lõi (`docs/api.md`) kèm ví dụ và ý nghĩa mã lỗi.
- Workflow BPMN tại `/v1/workflow/*`: Flowable đứng sau `workflow-api`, cách ly tenant, chỉ vai trò ứng viên được
  hoàn thành task, quy tắc bốn mắt; quy trình mẫu `core-approval` deploy theo tenant bằng `make seed`. `make test`
  chạy kiểm thử đơn vị; ADR 0004 về lớp kiểm soát quyền trước Flowable.
- Tài liệu công cụ sử dụng (`docs/tools.md`): vai trò, cấu hình và cách xem của từng thành phần lõi và công cụ
  phát triển.
- `make backup` và `make restore`: sao lưu PostgreSQL (mọi CSDL và vai trò), SeaweedFS và `.env` kèm checksum;
  khôi phục ghi đè có xác nhận. CI kiểm cả vòng sao lưu, xóa sạch, khôi phục.
- `make up` chờ tới khi cổng APISIX đã nạp xong tuyến đường (healthcheck), không chỉ tới khi container chạy.
- CI bỏ qua bước dựng lõi khi pull request chỉ đổi tài liệu, chỉ chạy vòng sao lưu và khôi phục khi đổi phần nó
  phụ thuộc; push lên `main` luôn chạy đủ. Tên job và bước bằng tiếng Anh.
- Lược đồ CSDL của lõi quản lý bằng migration dbmate: `make up` áp migration chưa chạy, bản cài đã có dữ liệu nâng
  cấp không cần `make reset`; `make migrate-new`, `make migrate-status`. Tenant demo chuyển sang `make seed`.
- Hợp đồng API giữa các tầng trong `contracts/`: JSON Schema cho claim token và `app.yaml`, OpenAPI của
  workflow-api có schema phản hồi và lỗi; `make check-fast` báo lỗi khi lệch, `make smoke` kiểm token thật.
  Ví dụ sai trong `contracts/examples/invalid/` phải bị từ chối, mỗi tệp phạm đúng một luật.
- Task của API quy trình có thêm `process`, `step` và `due` để giao diện biết việc đang ở bước nào và hạn khi
  nào; khởi tạo quy trình nhận header `Idempotency-Key`, gửi lặp không tạo quy trình thứ hai.
- Định dạng khai báo bước của quy trình (`contracts/workflow.schema.json`): biểu mẫu, nút quyết định và hồ sơ
  liên quan của từng bước người làm; `make check-fast` kiểm mọi userTask trong BPMN của gói đều có khai báo.
- Gói Tầng 3 đầu tiên `apps/facilities-commune`: bảng cơ sở → tòa → phòng với khóa ngoại ghép kèm tenant, quyền
  Hasura theo tenant, nhật ký thay đổi, migration và bảng theo dõi riêng của gói; `make app-install`,
  `make app-uninstall` (bắt `CONFIRM=yes` vì xóa dữ liệu của gói), `make app-status`, `make app-smoke` đọc `app.yaml`
  để cài và gỡ gói trên lõi đang chạy; tệp quyền của gói chỉ được khai bảng trong lược đồ của gói. Gói đã cài thì
  `make seed` áp lại quyền và `make smoke` kiểm lệch như bảng của lõi. CI cài gói, chạy smoke của gói, seed và smoke
  khi gói đang cài, gỡ gói rồi kiểm lõi vẫn qua.
- Bảng `platform.workflow_steps` (Tầng 2, lịch sử migration riêng): khai báo bước của quy trình theo tenant, đọc
  qua GraphQL; `make seed` nạp khai báo của quy trình mẫu.
- Định dạng cấu hình của thành phần danh mục (`contracts/catalog.schema.json`, ADR 0013): bảng đọc, trường, cột
  của danh sách, ô tìm, ô lọc, thứ tự, cỡ trang và đối tượng con; `make check-fast` kiểm cấu hình danh mục của
  mọi gói trong `apps/`.
- Thành phần danh mục của giao diện (`platform/web/src/Catalog.tsx`): danh sách có tìm, lọc, sắp xếp, phân trang và
  màn hình chi tiết có bảng đối tượng con nhiều cấp, tất cả theo cấu hình của gói; việc làm được và giới hạn ghi ở
  `contracts/catalog.component.yaml`. Chưa có trang nào gọi thành phần. `make web-check` chạy thêm kiểm thử đơn vị
  (Vitest).
- Gói `apps/facilities-commune` khai cấu hình danh mục cơ sở → tòa → phòng (`catalog/facilities.yaml`, mục `menu`
  `facilities` trong `app.yaml`); chưa hiện trên giao diện cho tới khi có lệnh cài gói đầy đủ.
- Giao diện có menu bên trái và trang "Việc của tôi": các việc đang chờ người đăng nhập, việc gần hạn đứng đầu,
  lọc quá hạn, còn hạn hoặc không đặt hạn.
- Bảng việc hiện tên hồ sơ (trường `title` mới của khai báo bước), người gửi, hạn dạng "còn 3 ngày", "quá hạn 1
  ngày", và số việc của từng bộ lọc; trang đăng nhập và khung trang có nền và khung tách phần.
- Màn hình xử lý một việc: thông tin hồ sơ, biểu mẫu và các nút quyết định theo khai báo của bước; lỗi như quy tắc
  bốn mắt hiện đúng lý do. Mở đường dẫn tới một việc khi chưa đăng nhập thì đăng nhập xong quay lại đúng việc đó.
- API tệp `/v1/files` (files-api trước SeaweedFS): tải lên, xem thông tin, tải xuống theo tenant; giới hạn cỡ,
  băm SHA-256, thông tin tệp trong `core.files`. Thêm biến `FILES_DB_PASSWORD` (`make env` tự thêm); vai trò CSDL
  của dịch vụ được tạo mỗi lần `make up`, nên bản cài đã có dữ liệu nâng cấp không cần `make reset`.
- Quét mã độc tệp tải lên bằng ClamAV trước khi lưu (ADR 0010): tệp nhiễm trả 422 kèm tên mẫu nhận diện và không
  được lưu; chưa quét được thì 503. Tệp đã quét có trạng thái `clean`. Lỗi tham số của `/v1/files` giờ trả
  `{"error": "..."}` như mọi lỗi khác, thay cho `{"detail": [...]}`. Lõi cần thêm khoảng 1 GB RAM.
- `make e2e`: kịch bản demo chạy trên trình duyệt thật qua cổng (Playwright): duyệt hồ sơ trên web, quy tắc bốn mắt,
  người duyệt của đơn vị khác không thấy, không duyệt được; CI chạy trong job end-to-end và giữ ảnh chụp, dấu vết
  khi hỏng. Thêm tài khoản demo `manager.b` (người duyệt của tenant `xa-b`).
- Nhật ký thay đổi `core.audit_log` (ADR 0009): ghi ai sửa gì, lúc nào, trước và sau trên tệp, đơn vị, khai báo
  bước; chuỗi băm phát hiện sửa lén; `make audit-verify` chỉ ra chỗ bị sửa; `make backup` ghi băm cuối, `make restore`
  đối chiếu lại.
- Đăng nhập hai bước cho người duyệt (ADR 0011): vai trò `manager` nhập thêm mã OTP khi đăng nhập, lần đầu thì cài
  ứng dụng OTP qua mã QR; token có claim `amr`; workflow-api từ chối duyệt khi token không có bước OTP. Thêm biến
  `DEMO_OTP_SECRET` (`make env` tự thêm) và `make otp` cho tài khoản demo. Bản cài đã dựng cần `make reset` để nạp
  lại realm.
- Kho lạnh cho nhật ký thay đổi (ADR 0014): `make archive BEFORE=<ngày>` xuất dòng cũ sang Parquet trên SeaweedFS,
  chỉ ghi nhận đoạn khi băm tính lại từ tệp khớp từng dòng; `make cold-query SQL=…` truy vấn gộp kho lạnh và CSDL
  bằng DuckDB. SeaweedFS chạy với `-volume.max=100` để có bucket thứ hai.
- Dữ liệu thiết bị theo chuẩn NGSI-LD (ADR 0012): Scorpio với CSDL PostGIS riêng, đọc qua cổng tại `/v1/context`
  (context-api) chỉ thấy thiết bị của đơn vị mình, chỉ đọc. `make backup` và `make restore` gồm CSDL của Scorpio.
  Thêm biến `SCORPIO_DB_PASSWORD`, `SCORPIO_PORT` (`make env` tự thêm).
- Nhận số đo thiết bị qua MQTT (ADR 0012): Mosquitto trong mạng riêng `ot`, mỗi thiết bị một tài khoản chỉ gửi vào
  chủ đề của mình (`make device-add`, `make device-remove`), cầu nối `iot-bridge` ghi vào Scorpio theo tenant của chủ
  đề và chỉ cho tenant có thật; định dạng tin trong `contracts/device-message.schema.json`. `make seed` cấp tài khoản
  cho thiết bị demo. Thêm biến `MQTT_BRIDGE_PASSWORD`, `IOT_BRIDGE_DB_PASSWORD`, `DEMO_DEVICE_PASSWORD`.
- Bộ giả lập thiết bị demo (`devices/simulator`, `make simulate`): gửi nhiệt độ, độ ẩm, có người, điện năng qua MQTT
  bằng tài khoản của từng thiết bị; `--set` ép một số đo để thử vượt ngưỡng. `make smoke` chạy một lượt.

### Changed

- Tenant demo đổi từ `xuong-a`, `xuong-b` sang ba xã của "Tỉnh Mẫu" (tỉnh hư cấu): `xa-a`, `xa-b`, `xa-c`, thêm tài
  khoản `user.c`, `manager.c`. Bản cài đã dựng cần `make reset` để nạp lại realm.
- Quyền dữ liệu của Hasura khai báo trong repo (`core/hasura/`, `platform/schema/hasura/`) thay cho lệnh gọi API
  trong seed. `make seed` ghi đè quyền đã bị sửa sai, `make smoke` báo lỗi khi Hasura lệch khỏi tệp,
  `make check-fast` báo lỗi khi một quyền không lọc theo tenant.
- Cổng chỉ mở các đường đăng nhập OIDC của realm `mortise`; console quản trị, realm `master`, trang tài khoản và
  các endpoint không dùng của Keycloak trả 403. Smoke kiểm các đường bị chặn và một lần đăng nhập PKCE đi trọn qua
  cổng. ADR 0007 ghi trang đăng nhập là bề mặt giao diện duy nhất của lõi.
- Client giao diện `mortise-web` chỉ còn Authorization Code + PKCE, không nhận mật khẩu trực tiếp; redirect URI và
  web origin theo `MORTISE_PUBLIC_URL`. Smoke và ví dụ lấy token bằng lệnh dùng client `mortise-test` do `make seed`
  tạo. Bản cài đã dựng cần `make reset` để nạp lại realm.
- Định danh kỹ thuật đổi từ `dxos` sang `mortise` cho khớp tên sản phẩm: realm Keycloak `mortise`, client
  `mortise-web`, CSDL `mortise`, project compose `mortise`, biến `MORTISE_PUBLIC_URL` và `MORTISE_BIND` (thay
  `DXOS_PUBLIC_URL`, `DXOS_BIND`). **Không tương thích với bản cài cũ**, xem hướng dẫn nâng cấp bên dưới.
- Quy trình mẫu của lõi chuyển từ `core/workflow/processes/` sang `core/workflow/fixtures/` và ghi rõ chỉ dùng để
  kiểm thử lõi; quy trình nghiệp vụ nằm trong gói ở `apps/`.

#### Nâng cấp bản cài đã dựng trước khi đổi tên

Tên CSDL, realm và project compose đều đổi, nên dữ liệu cũ không tự chuyển sang. Bản sao lưu làm trước khi đổi tên
vẫn nạp được, nhưng tạo lại CSDL và realm tên cũ mà bản cài mới không dùng tới, nên hệ thống sẽ không chạy.

```bash
docker compose -p dxos down -v   # xóa container và dữ liệu của project cũ
make up seed smoke               # dựng lại với tên mới
```

Trong `.env` đã có, đổi tên `DXOS_PUBLIC_URL` thành `MORTISE_PUBLIC_URL` và `DXOS_BIND` thành `MORTISE_BIND` nếu
từng đặt giá trị khác mặc định; `make env` tự thêm hai biến mới với giá trị mặc định.

### Fixed

- `make backup` dừng các dịch vụ ghi dữ liệu (cổng, files-api, iot-bridge…) trong lúc sao lưu rồi bật lại; trước đây
  tệp tải lên giữa lúc dump CSDL và lúc chép kho tệp thành đối tượng không có dòng `core.files`. `make restore` kiểm
  `core.files` khớp kho tệp sau khi khôi phục (`make files-verify`) và báo lỗi nếu lệch: bản sao lưu cũ có đối tượng
  mồ côi vẫn được nạp đủ, nhưng lệnh thoát mã lỗi kèm danh sách đối tượng lệch.
- `make restore` dừng cả files-api trong lúc nạp dữ liệu; trước đây nó vẫn chạy và có thể ghi tệp xen vào dữ liệu đang
  bị ghi đè.
- Cổng trả lỗi `401` của `/v1/graphql` và `/v1/workflow/*` dạng JSON `{"error": "..."}` như hợp đồng ghi, thay vì
  trang HTML. Ví dụ sai trong `contracts/examples/invalid/` phải bị từ chối đúng luật mà tệp được viết ra để thử;
  `scripts/contracts.sh` báo lỗi khi gõ sai tham số.
- API quy trình trả 422 khi thân request có khóa ngoài `variables`, thay vì bỏ qua khóa đó. Trước đây gửi
  `{"approved": true}` thiếu lớp `variables` vẫn hoàn thành task, nhưng quy trình không nhận được biến và rẽ sang
  nhánh mặc định. Lỗi 422 có dạng `{"error": "..."}` như các lỗi khác của API.
- Flowable không còn tự deploy các quy trình minh họa của ảnh `flowable-rest`; smoke kiểm không có quy trình nào
  ngoài các tenant. Bản cài đã dựng vẫn giữ các quy trình đó trong CSDL, smoke báo lỗi cho tới khi `make reset`.
