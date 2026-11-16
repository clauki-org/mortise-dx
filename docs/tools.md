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
  - Mỗi tenant là một nhóm (`xuong-a`, `xuong-b`); bộ ánh xạ đưa tên nhóm vào claim `tenant` của token. Các thành
    phần khác dựa vào claim này để tách dữ liệu.
  - Vai trò realm: `user`, `manager`, `tenant_admin`.
  - Client `mortise-web` là client công khai cho ứng dụng web: chỉ Authorization Code với PKCE, không nhận mật khẩu
    trực tiếp; redirect URI và web origin theo `MORTISE_PUBLIC_URL` ([ADR 0006](adr/0006-frontend-stack.md)).
  - Client `mortise-test` chỉ dùng cho smoke và CI, lấy token bằng mật khẩu; do `make seed` tạo, không có trong tệp
    realm nên bản cài thật không có, trừ khi khôi phục từ bản sao lưu của bản cài đã seed.
  - Access token sống 15 phút; bật chống dò mật khẩu; tắt tự đăng ký.
- **Cấu hình:** `core/keycloak/realm-mortise.json`, được nạp khi Keycloak khởi động lần đầu. Tài khoản demo và client
  `mortise-test` do `scripts/seed.sh` tạo, không nằm trong tệp realm.
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
  - Giới hạn tần suất theo token: 600 yêu cầu mỗi phút cho API dữ liệu, 300 cho API quy trình. Đếm theo token, không
    theo IP, để nhiều người sau cùng một NAT không chặn lẫn nhau.
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
    vai trò từ `realm_access.roles`.
  - Quyền mẫu: vai trò `user` chỉ đọc được dòng của `core.tenants` có `id` bằng tenant trong token.
- **Cấu hình:** biến môi trường trong `compose.yaml`. Bảng được đăng ký và quyền theo vai trò khai báo trong
  `core/hasura/tables.yaml` và `platform/schema/hasura/tables.yaml`, cùng định dạng Hasura xuất ra. `make seed` áp
  các tệp này theo kiểu ghi đè (quyền đã bị sửa sai cũng về đúng), `make smoke` báo lỗi khi Hasura lệch khỏi tệp,
  `make check-fast` báo lỗi khi một quyền không lọc theo tenant (`scripts/hasura-metadata.py`). Kiểm theo cấu trúc:
  phải có một nhánh AND so `_eq` với `X-Hasura-Tenant-Id`; quyền sửa phải có cả `filter` lẫn `check`. Tệp chỉ quản lý
  bảng và quyền. Quan hệ và computed field chưa quản lý: tạo tay trong Hasura thì `make smoke` báo lệch. Action,
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
  Các quy trình minh họa đi kèm ảnh `flowable-rest` được tắt trong `compose.yaml`.
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
- **Cấu hình:** mã ở `core/workflow-api/`; quy tắc quyền là các hàm thuần trong `app/policy.py`, có kiểm thử ở
  `tests/`. Phiên bản thư viện khóa trong `uv.lock`.
- **Xem:** `make test` (kiểm thử đơn vị), `make smoke` (kiểm tra đầu-cuối); các endpoint ở [api.md](api.md).

### files-api: đường vào tệp (tự viết)

- **Làm gì:** dịch vụ nhỏ bằng Python (FastAPI) đứng giữa cổng và SeaweedFS, cho ứng dụng tải lên và tải xuống tệp.
- **Trong dự án:**
  - Kiểm token lần nữa; gán tenant và người tải lên từ token. Nội dung lưu với khóa `<tenant>/<id>`.
  - Đếm cỡ trong lúc nhận, dừng ngay khi vượt `FILES_MAX_BYTES`; tính SHA-256 cùng lúc.
  - Ghi thông tin tệp vào `core.files` bằng vai trò CSDL `files_api`, chỉ đọc và thêm được dòng của bảng đó.
  - Tải xuống luôn là tệp đính kèm, kèm `X-Content-Type-Options: nosniff` và CSP `sandbox`.
- **Cấu hình:** mã ở `core/files-api/`; phần thuần (tên tệp, giới hạn cỡ, header tải xuống) ở `app/policy.py`, có
  kiểm thử ở `tests/`.
- **Xem:** `make test`, `make smoke`; các endpoint ở [api.md](api.md). Healthcheck `/healthz` chỉ cho biết tiến trình
  đang chạy, không kiểm CSDL hay SeaweedFS; hai dịch vụ đó lỗi thì yêu cầu trả 503 kèm hướng khắc phục.

### SeaweedFS: lưu trữ đối tượng

- **Làm gì:** lưu tệp (tài liệu, ảnh, bản quét) và cung cấp API tương thích S3, nên ứng dụng dùng được thư viện S3
  có sẵn.
- **Trong dự án:** chạy một máy chủ gộp, khóa truy cập S3 lấy từ `S3_ACCESS_KEY` và `S3_SECRET_KEY`. Ứng dụng vào
  qua files-api, không gọi thẳng; quét mã độc tệp tải lên là kế hoạch.
- **Xem:** API S3 tại `http://127.0.0.1:8333`.

## Giao diện Tầng 2

### Khung giao diện (`platform/web/`, tự viết)

- **Làm gì:** ứng dụng trang đơn cho người dùng nghiệp vụ: đăng nhập, khung trang, gọi API của lõi bằng token. Lựa
  chọn thư viện và lý do ở [ADR 0006](adr/0006-frontend-stack.md).
- **Trong dự án:**
  - React + TypeScript, build bằng Vite ra tệp tĩnh; Mantine cho component và theme.
  - Đăng nhập bằng oidc-client-ts với client `mortise-web` (Authorization Code + PKCE); token giữ trong
    `sessionStorage`, làm mới bằng refresh token, không dùng iframe theo dõi phiên.
  - GraphQL tới Hasura qua `/v1/graphql` bằng urql, gửi bằng POST; Hasura lọc dữ liệu theo tenant trong token.
  - REST tới `/v1/workflow` bằng TanStack Query (bộ nhớ đệm, tự tải lại khi quay lại tab); điều hướng giữa các màn
    hình bằng React Router, nginx trả `index.html` cho mọi đường nên tải lại trang vẫn đúng màn hình.
  - nginx 1.30.6 phục vụ tệp tĩnh sau cổng tại `/`, trả `index.html` cho đường không phải tệp, gắn
    `Content-Security-Policy` và các header bảo mật (`platform/web/security-headers.conf`).
- **Phát triển:** `cd platform/web && npm install && npm run dev`, mở `http://localhost:5173`. Máy chủ Vite chuyển
  `/v1` sang cổng; `make seed` cho địa chỉ này đăng nhập được khi bản cài chạy ở localhost (đổi địa chỉ bằng
  `WEB_DEV_URL`). Sửa xong chạy lại `docker compose build web` để
  bản qua cổng nhận thay đổi.
- **Kiểm tra:** `make web-check` (Biome, kiểu TypeScript, build, giấy phép phụ thuộc); `make smoke` kiểm route `/`,
  CSP và luồng đăng nhập PKCE qua cổng.

## Công cụ phát triển và kiểm tra

Các công cụ này chỉ dùng khi phát triển và trong CI, không đóng gói vào sản phẩm, nên giấy phép của chúng không ảnh
hưởng tới mã Apache-2.0 của dự án. Những công cụ chạy qua `uvx` không cần cài sẵn, chỉ cần `uv`.

| Công cụ | Dùng để | Gọi qua | Giấy phép |
|---|---|---|---|
| Docker Engine, Docker Compose v2 | Chạy các dịch vụ lõi bằng image chính thức | `make up`, `make down`, `make reset` | Apache-2.0 |
| GNU Make | Lối vào chung cho mọi lệnh | `make help` | GPL-3.0-or-later |
| uv | Quản lý Python và thư viện của workflow-api, files-api; chạy công cụ không cần cài | `make test`, `make check-fast` | MIT / Apache-2.0 |
| REUSE | Kiểm mọi tệp có header bản quyền và giấy phép | `make lint` | GPL-3.0-or-later |
| dbmate | Áp migration lược đồ CSDL (chạy như dịch vụ một lần trong compose) | `make up`, `make migrate-status` | MIT |
| ShellCheck | Bắt lỗi trong script shell | `make check-fast` | GPL-3.0 |
| yamllint | Kiểm cú pháp và định dạng YAML | `make check-fast` | GPL-3.0 |
| Ruff | Kiểm lỗi và định dạng mã Python | `make check-fast` | MIT |
| check-jsonschema | Kiểm hợp đồng trong `contracts/` và token thật theo JSON Schema | `make check-fast`, `make smoke` | Apache-2.0 |
| pytest | Kiểm thử đơn vị workflow-api và files-api | `make test` | MIT |
| Playwright | Kiểm thử giao diện trên trình duyệt thật qua cổng; bài kiểm ở `platform/web/e2e/` | `make e2e` | Apache-2.0 |
| Node.js, npm | Build và kiểm giao diện; Node chỉ có trong image build, không có khi chạy | `make web-check`, `npm run dev` | MIT / Artistic-2.0 |
| Biome | Kiểm lỗi và định dạng mã giao diện | `make web-check` | MIT OR Apache-2.0 |
| license-checker-rseidelsohn | Kiểm giấy phép phụ thuộc của giao diện theo danh sách cho phép trong `Makefile` | `make web-check` | BSD-3-Clause |
| curl, jq, openssl | Gọi API trong seed và smoke, đọc JSON, sinh bí mật ngẫu nhiên | `scripts/` | curl / MIT / Apache-2.0 |
| GitHub Actions | CI: `make check-fast` và `make test` với mọi thay đổi; `make web-check` khi đổi `platform/web/`; dựng lõi trên máy trắng, `make smoke` và `make e2e` khi pull request đổi thứ ngoài tài liệu; vòng sao lưu và khôi phục khi đổi phần nó phụ thuộc; push lên `main` chạy đủ | `.github/workflows/ci.yml` | dịch vụ của GitHub |
