<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Công cụ sử dụng

Mỗi công cụ dưới đây ghi: nó làm gì, dự án dùng nó thế nào, cấu hình nằm ở đâu, và cách xem hay kiểm tra khi
lõi đang chạy. Lý do chọn và kiểm tra giấy phép ở [ADR 0002](adr/0002-core-components.md); cách gọi API ở
[api.md](api.md). Mật khẩu nhắc tới ở đây đều nằm trong `.env`, do `make env` sinh ngẫu nhiên.

## Thành phần chạy trong lõi

Mọi thành phần chạy bằng image chính thức, phiên bản ghim trong `compose.yaml`. Chỉ cổng APISIX (9080) mở cho
người dùng; các cổng khác chỉ bind `127.0.0.1` để người vận hành quản trị ngay trên máy chủ.

### PostgreSQL + pgvector: cơ sở dữ liệu

- **Làm gì:** CSDL quan hệ lưu dữ liệu có cấu trúc. pgvector là phần mở rộng lưu vector và tìm kiếm theo độ gần,
  dùng cho tìm kiếm ngữ nghĩa.
- **Trong dự án:** một máy chủ Postgres chứa ba CSDL tách quyền: `keycloak` (định danh), `flowable` (quy trình) và
  `mortise` (dữ liệu của nền tảng, Hasura cũng lưu metadata ở đây). Lược đồ `core` có bảng `core.tenants`, mỗi dòng
  là một đơn vị dùng chung lõi. Phần mở rộng `vector` (pgvector) và `pgcrypto` đã được bật trong CSDL `mortise`
  nhưng chưa có bảng nào dùng; `vector` dành cho trợ lý AI (kế hoạch).
- **Cấu hình:** `core/postgres/init/` chạy một lần khi volume còn trống: tạo vai trò, CSDL và bật phần mở rộng.
  Đổi tệp này thì phải `make reset` để chạy lại. Bảng và lược đồ do migration tạo (mục dbmate bên dưới).
- **Xem:** `127.0.0.1:55432`, tài khoản `postgres`, mật khẩu `POSTGRES_PASSWORD`.

### dbmate: migration lược đồ CSDL

- **Làm gì:** áp các thay đổi lược đồ CSDL theo thứ tự, ghi lại thay đổi nào đã áp, để bản cài đã có dữ liệu nhận
  được thay đổi mới mà không mất dữ liệu ([ADR 0005](adr/0005-schema-migrations.md)).
- **Trong dự án:** dịch vụ `db-roles` tạo vai trò CSDL của các dịch vụ tự viết (`core/postgres/roles.sh`), rồi
  `migrate` (lõi) và `migrate-platform` (Tầng 2) chạy một lần mỗi khi `make up`, trước
  khi Hasura khởi động; áp các migration chưa chạy rồi thoát. Chạy bằng vai trò `hasura`, chủ sở hữu CSDL
  `mortise`. Lịch sử của lõi ghi trong bảng `core.schema_migrations`, của Tầng 2 trong
  `platform.schema_migrations`; mỗi gói nghiệp vụ sẽ có thư mục và bảng theo dõi riêng.
- **Cấu hình:** tệp migration ở `core/postgres/migrations/` và `platform/schema/migrations/`, tên
  `YYYYMMDDHHMMSS_mo_ta.sql`, có phần `-- migrate:up` và `-- migrate:down`. `make migrate-new NAME=<ten_ngan>`
  tạo tệp mới cho lõi.
- **Xem:** `make migrate-status` (lõi); log của lần chạy gần nhất bằng `docker compose logs migrate migrate-platform`.

### Nhật ký thay đổi (`core.audit_log`, tự viết)

- **Làm gì:** ghi mọi thay đổi trên các bảng đã gắn trigger: ai làm, lúc nào, giá trị trước và sau. Mỗi dòng băm
  cùng băm của dòng trước thành một chuỗi, nên sửa hay xóa lén một dòng thì lệnh kiểm chỉ ra đúng chỗ
  ([ADR 0009](adr/0009-tamper-evident-audit-log.md)). Đây là phát hiện sửa, không chặn được người giữ quyền chủ CSDL.
- **Trong dự án:** gắn cho `core.files`, `core.tenants`, `platform.workflow_steps` bằng `core.audit_attach()`; gói
  gắn cho bảng của mình. `make backup` ghi băm cuối chuỗi vào MANIFEST; `make restore` kiểm lại sau khi khôi phục.
- **Cấu hình:** migration `core/postgres/migrations/*_core_audit_log.sql`; lệnh kiểm `scripts/audit-verify.sh`.
- **Xem:** `make audit-verify` (thêm `ANCHOR=<thư mục sao lưu>` để đối chiếu); đọc nhật ký bằng
  `docker compose exec postgres psql -U postgres -d mortise -c 'TABLE core.audit_log'`.

### Keycloak: định danh và đăng nhập một lần

- **Làm gì:** quản lý người dùng, đăng nhập, cấp token theo chuẩn OpenID Connect (OIDC), vai trò và nhóm. Mọi
  ứng dụng đăng nhập ở một chỗ.
- **Trong dự án:**
  - Realm `mortise` chứa toàn bộ người dùng của nền tảng.
  - Mỗi tenant là một nhóm (`xa-a`, `xa-b`, `xa-c`: ba xã demo, con của `tinh-mau`; `tinh-khac` không có con); bộ ánh xạ đưa tên nhóm vào claim `tenant` của
    token. Các thành phần khác dựa vào claim này để tách dữ liệu.
  - Vai trò realm: `user`, `manager`, `tenant_admin`, `rollup_reader` (đọc tổng hợp của tenant con,
    [ADR 0016](adr/0016-parent-tenant-rollup.md)).
  - Client `mortise-web` là client công khai cho ứng dụng web: chỉ Authorization Code với PKCE, không nhận mật khẩu
    trực tiếp; redirect URI và web origin theo `MORTISE_PUBLIC_URL` ([ADR 0006](adr/0006-frontend-stack.md)).
  - Client `mortise-test` chỉ dùng cho smoke và CI, lấy token bằng mật khẩu; do `make seed` tạo, không có trong tệp
    realm nên bản cài thật không có, trừ khi khôi phục từ bản sao lưu của bản cài đã seed.
  - Access token sống 15 phút; bật chống dò mật khẩu; tắt tự đăng ký.
  - Người có vai trò `otp_required` của client `mortise-web` (mọi `manager` có sẵn qua vai trò gộp) đăng nhập hai bước
    (mật khẩu và mã OTP) qua luồng `browser-mfa` và `direct-grant-mfa`; token ghi cách đăng nhập trong claim `amr`
    ([ADR 0011](adr/0011-approver-mfa.md)).
- **Cấu hình:** `core/keycloak/realm-mortise.json`, được nạp khi Keycloak khởi động lần đầu. Tài khoản demo, khóa OTP
  của người duyệt demo (`DEMO_OTP_SECRET`) và client `mortise-test` do `scripts/seed.sh` tạo, không nằm trong tệp
  realm. `make otp` in mã OTP hiện tại của người duyệt demo.
- **Xem:** `http://127.0.0.1:8081/auth/admin`, tài khoản `admin`, mật khẩu `KEYCLOAK_ADMIN_PASSWORD`. Đường dẫn này
  bị chặn khi đi qua cổng. Keycloak đang chạy chế độ `start-dev`, chỉ dành cho phát triển.

### Apache APISIX: cổng API

- **Làm gì:** cổng vào duy nhất từ bên ngoài. Nhận yêu cầu, kiểm tra, rồi chuyển tới dịch vụ bên trong.
- **Trong dự án:**
  - Chế độ standalone: tuyến đường khai báo trong tệp YAML, không cần etcd, không mở Admin API, nên không ai đổi
    được cấu hình cổng khi đang chạy.
  - Chỉ các đường OIDC của realm `mortise` (đăng nhập, token, đăng xuất, khóa công khai, các bước của form đăng nhập)
    được chuyển tới Keycloak; mọi đường khác dưới `/auth`, gồm console quản trị, realm `master` và trang tài khoản, bị
    chặn (403) ([ADR 0007](adr/0007-login-page-exception.md)).
  - `/v1/graphql` (Hasura), `/v1/workflow/*` (workflow-api) và `/v1/files` (files-api) bắt buộc access token. Cổng tự kiểm chữ ký token bằng
    khóa công khai (JWKS) của Keycloak; không token hoặc token giả thì trả 401.
  - Giới hạn tần suất theo token: 600 yêu cầu mỗi phút cho API dữ liệu, 300 cho API quy trình, 120 cho API tệp, 300
    cho API thiết bị, 20 cho trợ lý. Đếm theo token, không theo IP, để nhiều người sau cùng một NAT không chặn lẫn
    nhau. Vượt giới hạn thì trả 429 dạng JSON `{"error": "..."}` (`error_page` trong `config.yaml`).
  - Plugin `prometheus` bật cho mọi route (`global_rules`): đếm yêu cầu theo route và mã trả về, đo độ trễ; số liệu
    chỉ đọc được ở cổng 9091 trong mạng nội bộ, cổng 9080 không trả ([ADR 0037](adr/0037-observability-profile.md)).
- **Cấu hình:** `core/apisix/config.yaml` (chế độ chạy), `core/apisix/apisix.yaml` (tuyến đường). Sửa xong chạy
  `docker compose restart apisix`.
- **Xem:** `make smoke` kiểm các hành vi trên qua cổng; log bằng `docker compose logs apisix`.

### Hasura GraphQL Engine CE: API dữ liệu tự sinh

- **Làm gì:** đọc lược đồ Postgres và sinh API GraphQL cho các bảng được đăng ký, kèm quyền theo vai trò và theo
  dòng. Không phải viết API đọc ghi cho từng bảng.
- **Trong dự án:**
  - Dùng bản Community Edition (`-ce`, Apache-2.0); bản không có `-ce` chứa mã Enterprise.
  - Hasura kiểm JWT lần nữa sau APISIX, để một lớp cấu hình sai không làm lộ dữ liệu.
  - Claim trong token được ánh xạ sang biến phiên: `X-Hasura-User-Id` từ `sub`, `X-Hasura-Tenant-Id` từ `tenant`,
    vai trò từ `realm_access.roles`. Mặc định truy vấn chạy với vai trò `user`; muốn dùng vai trò khác có trong token
    (`manager`, `tenant_admin`) thì gửi kèm header `X-Hasura-Role`.
  - Quyền mẫu: vai trò `user` chỉ đọc được dòng của `core.tenants` có `id` bằng tenant trong token.
- **Cấu hình:** biến môi trường trong `compose.yaml`. Bảng được đăng ký và quyền theo vai trò khai báo trong
  `core/hasura/tables.yaml`, `platform/schema/hasura/tables.yaml` và `apps/<gói>/hasura/*.yaml` của gói đã cài
  (`make app-install`), cùng định dạng Hasura xuất ra; tệp của gói chỉ được khai bảng trong lược đồ của gói. `make seed` áp
  các tệp này theo kiểu ghi đè (quyền đã bị sửa sai cũng về đúng), `make smoke` báo lỗi khi Hasura lệch khỏi tệp,
  `make check-fast` báo lỗi khi một quyền không lọc theo tenant (`scripts/hasura-metadata.py`). Kiểm theo cấu trúc:
  phải có một nhánh AND so `_eq` với `X-Hasura-Tenant-Id`; quyền sửa phải có cả `filter` lẫn `check`. Tệp quản lý
  bảng, quan hệ và quyền; quan hệ cần khi quyền phải đi qua bảng khác (ví dụ phân công cán bộ của gói xã). Computed
  field chưa quản lý: tạo tay trong Hasura thì `make smoke` báo lệch. Action,
  remote schema và cron trigger chưa được kiểm.
- **Xem:** `http://127.0.0.1:8082/console`, admin secret `HASURA_ADMIN_SECRET`.

### Flowable REST: động cơ quy trình

- **Làm gì:** chạy quy trình theo chuẩn BPMN 2.0: khởi tạo hồ sơ, tạo task cho người hoặc vai trò, lưu biến, rẽ
  nhánh theo kết quả.
- **Trong dự án:** chỉ dùng engine và REST API, không dùng công cụ vẽ quy trình. Flowable không có đường vào từ bên
  ngoài; mọi lời gọi đi qua workflow-api ([ADR 0004](adr/0004-workflow-access-control.md)). Mỗi quy trình
  được deploy riêng cho từng tenant.
- **Cấu hình:** lõi chỉ có quy trình mẫu để kiểm thử, ở `core/workflow/fixtures/`; quy trình nghiệp vụ nằm trong gói
  ở `apps/`. `make seed` deploy quy trình mẫu cho mọi tenant, chạy lại không tạo phiên bản mới nếu tệp không đổi.
  Các quy trình minh họa đi kèm ảnh `flowable-rest` được tắt trong `compose.yaml`. Hẹn giờ (timer) chạy với cấu
  hình mặc định của ảnh, không cần bật thêm. BPMN của gói có thể viết `{{tên}}` cho ngưỡng hay thời hạn; bộ cài thay
  bằng `settings` trong `app.yaml` lúc deploy, ghi đè bằng `make app-install SETTINGS=...`
  ([ADR 0019](adr/0019-workflow-settings-at-deploy.md)).
- **Xem:** tài liệu REST tại `http://127.0.0.1:8083/flowable-rest/docs`, tài khoản `rest-admin`, mật khẩu
  `FLOWABLE_ADMIN_PASSWORD`.

### workflow-api: lớp kiểm quyền trước Flowable (tự viết)

- **Làm gì:** dịch vụ nhỏ bằng Python (FastAPI) đứng giữa cổng và Flowable, áp các quy tắc mà Flowable không tự
  hiểu.
- **Trong dự án:**
  - Kiểm token lần nữa bằng JWKS của Keycloak.
  - Gán tenant và người khởi tạo từ token; ứng dụng không ghi đè được các biến này.
  - Chỉ người được giao hoặc người có vai trò ứng viên mới hoàn thành được task, và chỉ trong tenant của mình.
  - Task đánh dấu `four-eyes` không cho người khởi tạo tự hoàn thành (quy tắc bốn mắt).
  - Người có vai trò `manager` chỉ hoàn thành được task khi claim `amr` của token có `otp` (đã đăng nhập hai bước).
  - Bước có `candidateGroups` là `${authority_<bước>}` nhận vai trò từ bảng phân cấp `core.step_authorities` lúc khởi
    tạo, đọc bằng vai trò CSDL `workflow_api` chỉ có quyền đọc bảng đó và `core.tenants`; hoàn thành bước đó cần
    `otp` với mọi vai trò ([ADR 0028](adr/0028-step-authority-table.md)); Keycloak hỏi OTP người có vai trò
    `otp_required` của client `mortise-web`, mà `manager` gộp sẵn.
- **Cấu hình:** mã ở `core/workflow-api/`; quy tắc quyền là các hàm thuần trong `app/policy.py`, có kiểm thử ở
  `tests/`. Phiên bản thư viện khóa trong `uv.lock`.
- **Xem:** `make test` (kiểm thử đơn vị), `make smoke` (kiểm tra đầu-cuối); các endpoint ở [api.md](api.md).

### files-api: đường vào tệp (tự viết)

- **Làm gì:** dịch vụ nhỏ bằng Python (FastAPI) đứng giữa cổng và SeaweedFS, cho ứng dụng tải lên và tải xuống tệp.
- **Trong dự án:**
  - Kiểm token lần nữa; gán tenant và người tải lên từ token. Nội dung lưu với khóa `<tenant>/<id>`.
  - Đếm cỡ trong lúc nhận, dừng ngay khi vượt `FILES_MAX_BYTES`; tính SHA-256 cùng lúc.
  - Gửi nội dung sang ClamAV quét trước khi lưu; nhiễm hay vượt giới hạn quét thì 422, chưa quét được thì 503, không
    lưu gì.
  - Ghi thông tin tệp vào `core.files` bằng vai trò CSDL `files_api`, chỉ đọc và thêm được dòng của bảng đó.
  - Tải xuống luôn là tệp đính kèm, kèm `X-Content-Type-Options: nosniff` và CSP `sandbox`.
- **Cấu hình:** mã ở `core/files-api/`; phần thuần (tên tệp, giới hạn cỡ, header tải xuống) ở `app/policy.py`, phần
  gọi ClamAV ở `app/scan.py`, đều có kiểm thử ở `tests/`.
- **Xem:** `make test`, `make smoke`; các endpoint ở [api.md](api.md). Healthcheck `/healthz` chỉ cho biết tiến trình
  đang chạy, không kiểm CSDL, SeaweedFS hay ClamAV; các dịch vụ đó lỗi thì yêu cầu trả 503 kèm hướng khắc phục.

### SeaweedFS: lưu trữ đối tượng

- **Làm gì:** lưu tệp (tài liệu, ảnh, bản quét) và cung cấp API tương thích S3, nên ứng dụng dùng được thư viện S3
  có sẵn.
- **Trong dự án:** chạy một máy chủ gộp, khóa truy cập S3 lấy từ `S3_ACCESS_KEY` và `S3_SECRET_KEY`. Ứng dụng vào
  qua files-api, không gọi thẳng.
- **Xem:** API S3 tại `http://127.0.0.1:8333`.

### ClamAV: quét mã độc

- **Làm gì:** phần mềm diệt virus nguồn mở; tiến trình `clamd` nhận nội dung tệp qua mạng và trả "sạch" hay tên mẫu
  nhận diện khớp.
- **Trong dự án:** files-api gửi mọi tệp tải lên sang quét trước khi lưu ([ADR 0010](adr/0010-upload-malware-scan.md)).
  Image kèm sẵn mẫu nhận diện nên chạy được khi không có mạng; có mạng thì `freshclam` tự cập nhật. Không mở cổng ra
  máy chủ.
- **Cấu hình:** biến `CLAMD_CONF_<tùy chọn>` của dịch vụ `clamav` trong `compose.yaml` ghi vào `clamd.conf` lúc khởi
  động; đang bật `AlertExceedsMax`, đặt `MaxFileSize` bằng `MaxScanSize` và ghim `MaxScanTime`.
- **Xem:** `docker compose logs clamav`; `docker compose exec clamav clamdtop` xem tải của `clamd`.

### Scorpio: dữ liệu thiết bị theo NGSI-LD

- **Làm gì:** broker theo chuẩn NGSI-LD (ETSI): giữ trạng thái hiện tại của thiết bị (entity và thuộc tính kèm thời
  điểm đo), trả lời truy vấn theo loại, mã, điều kiện.
- **Trong dự án:** bản native không cần Kafka, CSDL riêng `scorpio-db` (PostgreSQL có PostGIS, Scorpio bắt buộc).
  Mỗi tenant một CSDL, tách theo header `NGSILD-Tenant`. Scorpio không xác thực nên không có route qua cổng; người
  dùng đọc qua context-api ([ADR 0012](adr/0012-device-context-ngsi-ld.md)). `make backup` có `scorpio.sql.gz`.
- **Cấu hình:** dịch vụ `scorpio` và `scorpio-db` trong `compose.yaml`; mật khẩu CSDL `SCORPIO_DB_PASSWORD`.
- **Xem:** `http://127.0.0.1:9090/ngsi-ld/v1/entities?type=Device` kèm header `NGSILD-Tenant: <tenant>` và
  `Accept: application/json` (chỉ máy chủ, không xác thực).

### Mosquitto: nhận số đo thiết bị qua MQTT

- **Làm gì:** broker MQTT, giao thức nhẹ mà thiết bị IoT dùng để gửi số đo.
- **Trong dự án:** chỉ nằm trong mạng compose `ot` (không ra internet, không mở cổng ra máy chủ). Mỗi thiết bị một
  tài khoản `<tenant>.<thiết bị>`, chỉ được gửi vào `mortise/<tenant>/<thiết bị>`; cầu nối có tài khoản chỉ đọc
  ([ADR 0012](adr/0012-device-context-ngsi-ld.md)).
- **Cấu hình:** `core/mosquitto/mosquitto.conf`; `core/mosquitto/start.sh` đặt tài khoản cầu nối theo
  `MQTT_BRIDGE_PASSWORD` mỗi lần khởi động. Tài khoản thiết bị nằm trong volume `mqttauth`, cấp bằng
  `make device-add TENANT=… DEVICE=…` (in mật khẩu một lần), thu hồi bằng `make device-remove`.
- **Xem:** `docker compose logs mosquitto`; gửi thử: `docker compose exec mosquitto mosquitto_pub -u <tài khoản>
  -P <mật khẩu> -t mortise/<tenant>/<thiết bị> -m '{"measurements": {"humidity": 70}}'`.

### iot-bridge: cầu nối MQTT sang NGSI-LD (tự viết)

- **Làm gì:** dịch vụ Python (paho-mqtt) đọc mọi chủ đề số đo và ghi vào Scorpio.
- **Trong dự án:**
  - Tenant và thiết bị chỉ lấy từ chủ đề; nội dung tin theo `contracts/device-message.schema.json`.
  - Chỉ ghi cho tenant có trong `core.tenants` (vai trò CSDL `iot_bridge` chỉ đọc bảng đó); CSDL lỗi thì không ghi.
  - Tin hỏng bị bỏ kèm một dòng log, không làm dừng cầu nối.
- **Cấu hình:** mã ở `core/iot-bridge/`; đổi tin thành entity ở `app/message.py`, có kiểm thử ở `tests/`.
- **Xem:** `docker compose logs iot-bridge`; healthcheck chỉ xanh khi đã kết nối và đăng ký nhận tin.

### Bộ giả lập thiết bị (`devices/simulator/`, tự viết)

- **Làm gì:** đóng vai các thiết bị demo trong `devices.yaml`: nhiệt độ, độ ẩm, có người, điện năng cộng dồn.
- **Trong dự án:** đăng nhập Mosquitto bằng tài khoản của từng thiết bị và gửi tin theo
  `contracts/device-message.schema.json`, như thiết bị thật. Số liệu chỉ để minh họa.
- **Cấu hình:** dịch vụ `simulator` (profile `simulator`) trong `compose.yaml`, mật khẩu `DEMO_DEVICE_PASSWORD`.
- **Xem:** `make simulate` gửi mỗi 5 giây; `make simulate ARGS="--set xa-a/archive-01:humidity=78"` ép một số đo;
  `make smoke` chạy một lượt.

### cold-archive và DuckDB: kho lạnh của nhật ký (tự viết)

- **Làm gì:** xuất dòng nhật ký thay đổi cũ sang tệp Parquet trong bucket `mortise-cold` của SeaweedFS, và truy vấn
  gộp kho lạnh với CSDL bằng DuckDB (CSDL phân tích chạy trong tiến trình, đọc được Parquet trên S3 và PostgreSQL).
- **Trong dự án:** chỉ ghi nhận một đoạn vào `core.audit_segments` khi băm tính lại từ tệp khớp từng dòng và chuỗi
  nối với đoạn trước ([ADR 0014](adr/0014-cold-audit-archive.md)), rồi xóa các dòng đó khỏi CSDL trong cùng giao
  dịch. `make cold-verify` tính lại chuỗi băm của mọi đoạn từ tệp.
- **Cấu hình:** dịch vụ `cold-archive` (profile `tools`) trong `compose.yaml`; mã ở `core/cold-archive/`.
- **Xem:** `make archive BEFORE=2026-11-01`; `make cold-verify`; `make cold-query SQL="SELECT source, count(*) FROM audit_all GROUP BY
  source"`.

### context-api: đọc dữ liệu thiết bị (tự viết)

- **Làm gì:** dịch vụ nhỏ bằng Python (FastAPI) đứng giữa cổng và Scorpio tại `/v1/context`.
- **Trong dự án:**
  - Kiểm token lần nữa; đặt header tenant cho Scorpio bằng tenant trong token, không chuyển header người gọi gửi.
  - Chỉ đọc: danh sách entity và một entity theo mã; chỉ chuyển các tham số truy vấn đã biết.
- **Cấu hình:** mã ở `core/context-api/`; quy tắc ở `app/policy.py`, có kiểm thử ở `tests/`.
- **Xem:** `make test`, `make smoke`; các endpoint ở [api.md](api.md).

### Ollama: chạy mô hình ngôn ngữ tại chỗ (tùy chọn)

- **Làm gì:** chạy mô hình ngôn ngữ trên CPU của máy chủ, nhận yêu cầu qua HTTP trong mạng nội bộ; nhận một JSON
  Schema để buộc câu trả lời đúng dạng.
- **Trong dự án:** profile `ai`, không chạy cùng `make up`; không mở cổng ra máy chủ hay qua cổng APISIX. Mô hình và
  lý do chọn ở [ADR 0021](adr/0021-document-assistant.md); chỉ trợ lý (hỏi văn bản và câu hỏi dữ liệu gõ tự do) gọi
  Ollama, trừ khi người vận hành chuyển nó sang API (mục assistant bên dưới).
- **Cấu hình:** dịch vụ `ollama` trong `compose.yaml`, trọng số trong volume `ollama`; tên mô hình và digest lớp
  trọng số ở `core/ollama/models.txt`.
- **Xem:** `make ai-up` (tải và đối chiếu digest); `docker compose exec ollama ollama list`.

### assistant: trợ lý hỏi văn bản và dữ liệu (tự viết)

- **Làm gì:** dịch vụ Python (FastAPI) tại `/v1/assistant/questions`: tìm đoạn trong văn bản của gói, nhờ mô hình
  trả lời, kiểm câu trả lời rồi trả kèm câu trích nguyên văn, hoặc từ chối có lý do
  ([ADR 0021](adr/0021-document-assistant.md)). Tại `/v1/assistant/data-queries`: cho câu GraphQL qua guard
  (`app/guard.py`, phân tích bằng graphql-core) rồi chạy qua Hasura bằng token người hỏi, trả bảng kèm câu đã chạy
  ([ADR 0027](adr/0027-data-assistant-guarded-graphql.md)). Tại `/v1/assistant/data-questions`: mô hình viết câu
  GraphQL từ câu hỏi gõ tự do và mô tả bảng, cột của mục menu, rồi câu đi cùng đường đó, sửa tối đa một lần theo lý
  do của guard ([ADR 0034](adr/0034-model-written-guarded-graphql.md)).
- **Trong dự án:** đọc đoạn qua cổng bằng token người hỏi, nên Hasura lọc theo tenant. Mỗi câu hỏi một dòng trong
  `platform.assistant_questions`, ghi bằng vai trò CSDL `assistant` chỉ được thêm dòng; không ghi được thì không trả
  lời. Mô hình chỉ chọn mã câu; số trong câu trả lời phải có trong câu được trích. Mỗi lúc chỉ một lượt sinh, chung cho
  hỏi văn bản và hỏi dữ liệu; mỗi lời gọi mô hình một dòng log INFO không kèm nội dung (`ASSISTANT_LOG_LEVEL`). Chạy
  cùng lõi; Ollama chưa bật thì câu hỏi cần mô hình nhận 503 kèm cách bật.
- **Cấu hình:** dịch vụ `assistant` trong `compose.yaml`: ngưỡng điểm tìm, số đoạn, độ dài câu hỏi,
  thời gian chờ. Mã ở `platform/services/assistant/`; route và giới hạn tần suất ở `core/apisix/apisix.yaml`. Nhà
  cung cấp mô hình: mặc định Ollama; `ASSISTANT_LLM_PROVIDER=openai-compatible` cùng địa chỉ, tên mô hình và khóa
  (`ASSISTANT_LLM_*` trong `.env`) gọi `{địa chỉ}/chat/completions` với JSON Schema; khai thiếu thì 503 chỉ biến
  còn thiếu. Dữ liệu gửi ra ngoài khi đó: bổ sung của [ADR 0021](adr/0021-document-assistant.md).
- **Xem:** `make test` (mô hình giả, bảng ca của guard); `make smoke` kiểm cả khi Ollama tắt và khi đang chạy, và
  kiểm guard trên mục mẫu `/apps/core/ask-data-example`.

## Giám sát (profile `observability`, tùy chọn)

Không chạy cùng `make up`. `make obs-up` dựng, `make obs-check` kiểm, `make obs-down` dừng mà giữ số liệu và log; lý
do và rủi ro ở [ADR 0037](adr/0037-observability-profile.md). Cấu hình nằm trong `core/observability/`. Chỉ Grafana
mở cổng, và chỉ ở `127.0.0.1`.

### Grafana: trang xem số liệu và log

- **Làm gì:** vẽ biểu đồ từ Prometheus, tìm log trong Loki, trên một trang.
- **Trong dự án:** dashboard "Mortise: tổng quan" (uid `mortise-overview`, thư mục Mortise): yêu cầu mỗi giây theo
  route và mã trả về, lỗi 5xx theo route, độ trễ p95 theo route ở cổng, đích của Prometheus và sức khỏe từng dịch vụ,
  số lần đăng nhập lỗi (sự kiện `LOGIN_ERROR` của Keycloak trong log), bảng log lọc theo biến `service`. Tắt truy cập
  ẩn danh, tự đăng ký, gửi thống kê và hỏi bản mới.
- **Cấu hình:** dịch vụ `grafana` trong `compose.yaml`; nguồn dữ liệu (uid `prometheus`, `loki`, `jaeger`) và nơi nạp
  dashboard ở `core/observability/grafana/provisioning/`, dashboard ở `core/observability/grafana/dashboards/`. Sửa trên
  giao diện không lưu được: sửa tệp JSON rồi `docker compose restart grafana`.
- **Xem:** `http://127.0.0.1:3000` (`GRAFANA_PORT`), tài khoản `admin`, mật khẩu `GRAFANA_ADMIN_PASSWORD`. Mật khẩu chỉ
  áp dụng khi volume `grafanadata` còn trống; đổi trong `.env` sau đó không đổi mật khẩu đã lưu.

### Prometheus: số liệu

- **Làm gì:** cứ 15 giây hỏi các đích lấy số liệu một lần, lưu thành chuỗi theo thời gian.
- **Trong dự án:** đích là APISIX (cổng 9091), Keycloak (cổng quản lý 9000, `/auth/metrics`, bật bằng
  `KC_METRICS_ENABLED`), chính Prometheus, Loki, Alloy và blackbox. Hasura CE, Flowable và dịch vụ tự viết không có số
  liệu riêng; sức khỏe của chúng hỏi qua blackbox. Giữ số liệu 15 ngày, điểm xuất phát chưa đo dung lượng.
- **Cấu hình:** `core/observability/prometheus.yml`; số liệu trong volume `prometheusdata`. Không mở cổng ra máy chủ.
- **Xem:** Grafana, mục Explore, nguồn Prometheus.

### Blackbox exporter: sức khỏe dịch vụ

- **Làm gì:** hỏi một URL thay cho Prometheus, trả `probe_success` là 1 hay 0.
- **Trong dự án:** hỏi `/healthz` của workflow-api, files-api, context-api, assistant và Hasura, `/auth/health/ready`
  của Keycloak, trạng thái cụm của SeaweedFS, danh sách kiểu của Scorpio, trang `/` của web. Không hỏi Flowable vì
  endpoint sức khỏe của nó đòi mật khẩu quản trị.
- **Cấu hình:** `core/observability/blackbox.yml` (cách hỏi), danh sách URL ở job `probe-*` của `prometheus.yml`.

### Loki và Grafana Alloy: log của mọi dịch vụ

- **Làm gì:** Alloy đọc log container rồi đẩy vào Loki; Loki lưu log, đánh nhãn để tìm theo dịch vụ và thời gian.
- **Trong dự án:** Alloy chỉ lấy container có nhãn `com.docker.compose.project=mortise`; nhãn `service` là tên dịch vụ
  compose. Alloy không gắn socket Docker mà hỏi qua docker-socket-proxy (image của Tecnativa): proxy chỉ cho đọc
  container và mạng, chặn mọi lệnh ghi, nằm trong mạng `docker-api` riêng với Alloy. Đọc thông tin container vẫn thấy
  biến môi trường, gồm bí mật của lõi (ADR 0037). Loki giữ log 7 ngày vì log chứa địa chỉ IP, mã và tên người dùng.
- **Cấu hình:** `core/observability/alloy/config.alloy`, `core/observability/loki.yaml`; log trong volume `lokidata`,
  vị trí đã đọc của Alloy trong `alloydata`. Docker rootless hay socket ở chỗ khác: đặt `DOCKER_SOCK` trong `.env`.
- **Xem:** Grafana, bảng log của dashboard hay mục Explore với nguồn Loki, ví dụ `{service="workflow-api"}`.

### Jaeger và OpenTelemetry: vết của một yêu cầu

- **Làm gì:** mỗi chặng của một yêu cầu (cổng, dịch vụ, lời gọi ra ngoài) thành một span có thời điểm và thời gian;
  các span chung một mã vết. OpenTelemetry tạo span, Jaeger nhận qua OTLP, lọc rồi lưu.
- **Trong dự án:** mặc định tắt; `MORTISE_TRACING=on` trong `.env` rồi `make up` thì plugin `opentelemetry` của APISIX
  ghi mọi yêu cầu tới API dưới /v1, và workflow-api, files-api, context-api, assistant chạy dưới
  `opentelemetry-instrument` (span của FastAPI, HTTPX và quanh CSDL). Jaeger bỏ chuỗi truy vấn, user-agent, địa chỉ người
  gọi trước khi lưu, giữ 7 ngày. Log của cổng và dịch vụ mang `trace_id=` để Grafana nối log với vết. Lý do và phạm vi:
  [ADR 0038](adr/0038-distributed-tracing.md).
- **Cấu hình:** `core/observability/jaeger.yaml` (nhận, lọc, lưu Badger trong volume `jaegerdata`); plugin và nơi gửi
  vết ở `core/apisix/apisix.yaml`; biến `OTEL_*` chung của dịch vụ ở `x-tracing` trong `compose.yaml`. Không mở cổng ra
  máy chủ.
- **Xem:** Grafana, mục Explore, nguồn Jaeger: tìm theo dịch vụ và thời gian hay dán mã vết; từ một span bấm sang các
  dòng log chứa mã vết trong Loki, từ dòng log có `trace_id=` bấm "Xem vết".

## Giao diện Tầng 2

### Khung giao diện (`platform/web/`, tự viết)

- **Làm gì:** ứng dụng trang đơn cho người dùng nghiệp vụ: đăng nhập, khung trang, gọi API của lõi bằng token. Lựa
  chọn thư viện và lý do ở [ADR 0006](adr/0006-frontend-stack.md).
- **Trong dự án:**
  - React + TypeScript, build bằng Vite ra tệp tĩnh; Mantine cho component và theme.
  - Đăng nhập bằng oidc-client-ts với client `mortise-web` (Authorization Code + PKCE); token giữ trong
    `sessionStorage`, làm mới bằng refresh token, không dùng iframe theo dõi phiên.
  - GraphQL tới Hasura qua `/v1/graphql` bằng urql, gửi bằng POST; Hasura lọc dữ liệu theo tenant trong token.
  - Menu gồm màn hình dùng chung cộng mục của các gói đã cài, đọc từ `platform_menu_items`; mục của gói mở ở
    `/apps/<gói>/<mục>` và vẽ thành phần Tầng 2 mà mục khai (`catalog`, `map`, `form`, `dashboard`, `assistant`) với
    cấu hình của gói. Mục khai `roles` chỉ hiện với người có vai trò đó. Lớp bản đồ không khai `role` không gửi
    `X-Hasura-Role` (Hasura dùng vai trò mặc định của token, `user`), lớp khai `role` gửi header đó khi token có vai
    trò ấy ([ADR 0024](adr/0024-map-component.md)). Biểu mẫu và khối bảng điều hành luôn gửi `X-Hasura-Role`, là
    `role` đã khai hoặc `user` khi bỏ trống, để Hasura dùng đúng vai trò mà `make check-fast` đã kiểm; token không có
    vai trò đó thì biểu mẫu không hiện, khối không được truy vấn ([ADR 0030](adr/0030-form-component.md),
    [ADR 0033](adr/0033-dashboard-component.md)).
  - Bản đồ vẽ bằng MapLibre GL JS 6.18.0 trên nền trơn, không tải tile từ máy chủ nào; mã của nó chỉ tải khi mở
    trang bản đồ, worker chạy từ tệp cùng origin nên CSP không mở `blob:`.
  - Biểu đồ của bảng điều hành là thanh vẽ bằng CSS theo biến màu của Mantine, không thêm thư viện biểu đồ; mỗi biểu
    đồ kèm bảng số liệu.
  - REST tới `/v1/workflow` bằng TanStack Query (bộ nhớ đệm, tự tải lại khi quay lại tab); điều hướng giữa các màn
    hình bằng React Router, nginx trả `index.html` cho mọi đường nên tải lại trang vẫn đúng màn hình.
  - nginx 1.30.6 phục vụ tệp tĩnh sau cổng tại `/`, trả `index.html` cho đường không phải tệp, gắn
    `Content-Security-Policy` và các header bảo mật (`platform/web/security-headers.conf`).
- **Phát triển:** `cd platform/web && npm install && npm run dev`, mở `http://localhost:5173`. Máy chủ Vite chuyển
  `/v1` sang cổng; `make seed` cho địa chỉ này đăng nhập được khi bản cài chạy ở localhost (đổi địa chỉ bằng
  `WEB_DEV_URL`). Sửa xong chạy lại `docker compose build web` để
  bản qua cổng nhận thay đổi.
- **Kiểm tra:** `make web-check` (Biome, kiểm thử đơn vị, kiểu TypeScript, build, giấy phép phụ thuộc); `make smoke` kiểm route `/`,
  CSP và luồng đăng nhập PKCE qua cổng.

## Công cụ phát triển và kiểm tra

Các công cụ này chỉ dùng khi phát triển và trong CI, không đóng gói vào sản phẩm, nên giấy phép của chúng không ảnh
hưởng tới mã Apache-2.0 của dự án. Những công cụ chạy qua `uvx` không cần cài sẵn, chỉ cần `uv`.

| Công cụ | Dùng để | Gọi qua | Giấy phép |
|---|---|---|---|
| Docker Engine, Docker Compose v2 | Chạy các dịch vụ lõi bằng image chính thức; lệnh `up`, `run` có thể dựng image tự viết đi qua `scripts/compose.sh` (máy chủ demo đặt `MORTISE_NO_BUILD=1` để không bao giờ dựng tại chỗ) | `make up`, `make down`, `make reset` | Apache-2.0 |
| GNU Make | Lối vào chung cho mọi lệnh | `make help` | GPL-3.0-or-later |
| uv | Quản lý Python và thư viện của workflow-api, files-api; chạy công cụ không cần cài | `make test`, `make check-fast` | MIT / Apache-2.0 |
| REUSE | Kiểm mọi tệp có header bản quyền và giấy phép | `make lint` | GPL-3.0-or-later |
| dbmate | Áp migration lược đồ CSDL (chạy như dịch vụ một lần trong compose) | `make up`, `make migrate-status` | MIT |
| ShellCheck | Bắt lỗi trong script shell, gồm `deploy/*.sh` | `make check-fast` | GPL-3.0 |
| yamllint | Kiểm cú pháp và định dạng YAML | `make check-fast` | GPL-3.0 |
| Ruff | Kiểm lỗi và định dạng mã Python | `make check-fast` | MIT |
| check-jsonschema | Kiểm hợp đồng trong `contracts/` và token thật theo JSON Schema | `make check-fast`, `make smoke` | Apache-2.0 |
| pytest | Kiểm thử đơn vị workflow-api và files-api | `make test` | MIT |
| Playwright | Kiểm thử giao diện trên trình duyệt thật qua cổng; bài kiểm ở `platform/web/e2e/` | `make e2e` | Apache-2.0 |
| Node.js, npm | Build và kiểm giao diện; Node chỉ có trong image build, không có khi chạy | `make web-check`, `npm run dev` | MIT / Artistic-2.0 |
| Biome | Kiểm lỗi và định dạng mã giao diện | `make web-check` | MIT OR Apache-2.0 |
| Vitest | Kiểm thử đơn vị mã giao diện không cần trình duyệt; bài kiểm là tệp `*.test.ts` trong `platform/web/src/` | `make web-check` | MIT |
| license-checker-rseidelsohn | Kiểm giấy phép phụ thuộc của giao diện theo danh sách cho phép trong `Makefile` | `make web-check` | BSD-3-Clause |
| `scripts/deps-check.py` (tự viết) | Kiểm image, thư viện Python, web, mô hình và công cụ chạy qua `uvx` được ghim phiên bản; giấy phép thư viện Python và image theo danh sách cho phép và bảng giấy phép của README (chính sách ở `scripts/deps-policy.toml`); báo bản mới qua registry, `uv pip list --outdated`, `npm outdated`, không tự nâng cấp ([ADR 0039](adr/0039-dependency-check-script.md)) | `make check-fast` (bỏ phần bản mới), `make deps-check` | Apache-2.0 |
| curl, jq, openssl | Gọi API trong seed và smoke, đọc JSON, sinh bí mật ngẫu nhiên | `scripts/` | curl / MIT / Apache-2.0 |
| GitHub Actions | CI: `make check-fast` và `make test` với mọi thay đổi; `make web-check` khi đổi `platform/web/`; dựng lõi trên máy trắng, `make smoke`, `make heal-check` và `make e2e` khi pull request đổi thứ ngoài tài liệu; `make restore-drill` trên một máy trắng khác khi đổi phần sao lưu, khôi phục phụ thuộc; push lên `main` chạy đủ. Tag `v*`: chạy lại toàn bộ CI, dựng và đẩy image, kéo lại không đăng nhập để smoke, tạo GitHub Release ([ADR 0036](adr/0036-pull-based-gitops-with-compose.md)). Thứ Hai hằng tuần: `make deps-check` và đăng báo cáo thành comment trong issue theo dõi (đã cấu hình, chưa chạy lần nào) | `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/workflows/deps-check.yml` | dịch vụ của GitHub |
| GitHub Container Registry (GHCR) | Giữ image của tám dịch vụ tự viết theo từng tag phát hành, `ghcr.io/clauki-org/mortise-dx/<dịch vụ>:<tag>`; CI đẩy bằng `GITHUB_TOKEN`, máy chủ kéo không đăng nhập (gói phải ở chế độ Public) | `release.yml`, `MORTISE_IMAGE_PREFIX` trong `compose.yaml` | dịch vụ của GitHub |
| systemd timer | Trên máy chủ demo, chạy `deploy/pull-deploy.sh` 5 phút sau khi khởi động rồi 15 phút một lần; log xem bằng `journalctl -u mortise-deploy.service` | `deploy/systemd/` ([deploy/README.md](../deploy/README.md)) | LGPL-2.1-or-later |
