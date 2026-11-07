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
  `dxos` (dữ liệu của nền tảng, Hasura cũng lưu metadata ở đây). Lược đồ `core` có bảng `core.tenants`, mỗi dòng
  là một đơn vị dùng chung lõi. Phần mở rộng `vector` (pgvector) và `pgcrypto` đã được bật trong CSDL `dxos`
  nhưng chưa có bảng nào dùng; `vector` dành cho trợ lý AI (kế hoạch).
- **Cấu hình:** `core/postgres/init/` chạy một lần khi volume còn trống: tạo vai trò, CSDL và lược đồ `core`. Đổi
  các tệp này thì phải `make reset` để chạy lại.
- **Xem:** `127.0.0.1:55432`, tài khoản `postgres`, mật khẩu `POSTGRES_PASSWORD`.

### Keycloak: định danh và đăng nhập một lần

- **Làm gì:** quản lý người dùng, đăng nhập, cấp token theo chuẩn OpenID Connect (OIDC), vai trò và nhóm. Mọi
  ứng dụng đăng nhập ở một chỗ.
- **Trong dự án:**
  - Realm `dxos` chứa toàn bộ người dùng của nền tảng.
  - Mỗi tenant là một nhóm (`xuong-a`, `xuong-b`); bộ ánh xạ đưa tên nhóm vào claim `tenant` của token. Các thành
    phần khác dựa vào claim này để tách dữ liệu.
  - Vai trò realm: `user`, `manager`, `tenant_admin`.
  - Client `dxos-web` là client công khai, dùng luồng Authorization Code với PKCE cho ứng dụng web.
  - Access token sống 15 phút; bật chống dò mật khẩu; tắt tự đăng ký.
- **Cấu hình:** `core/keycloak/realm-dxos.json`, được nạp khi Keycloak khởi động lần đầu. Tài khoản demo do
  `scripts/seed.sh` tạo, không nằm trong tệp realm.
- **Xem:** `http://127.0.0.1:8081/auth/admin`, tài khoản `admin`, mật khẩu `KEYCLOAK_ADMIN_PASSWORD`. Đường dẫn này
  bị chặn khi đi qua cổng. Keycloak đang chạy chế độ `start-dev`, chỉ dành cho phát triển.

### Apache APISIX: cổng API

- **Làm gì:** cổng vào duy nhất từ bên ngoài. Nhận yêu cầu, kiểm tra, rồi chuyển tới dịch vụ bên trong.
- **Trong dự án:**
  - Chế độ standalone: tuyến đường khai báo trong tệp YAML, không cần etcd, không mở Admin API, nên không ai đổi
    được cấu hình cổng khi đang chạy.
  - `/auth/*` chuyển tới Keycloak để đăng nhập; `/auth/admin` bị chặn (403).
  - `/v1/graphql` (Hasura) và `/v1/workflow/*` (workflow-api) bắt buộc access token. Cổng tự kiểm chữ ký token bằng
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
- **Cấu hình:** biến môi trường trong `compose.yaml`; metadata (bảng được đăng ký, quyền) do `scripts/seed.sh` áp
  dụng qua API metadata.
- **Xem:** `http://127.0.0.1:8082/console`, admin secret `HASURA_ADMIN_SECRET`.

### Flowable REST: động cơ quy trình

- **Làm gì:** chạy quy trình theo chuẩn BPMN 2.0: khởi tạo hồ sơ, tạo task cho người hoặc vai trò, lưu biến, rẽ
  nhánh theo kết quả.
- **Trong dự án:** chỉ dùng engine và REST API, không dùng công cụ vẽ quy trình. Flowable không có đường vào từ bên
  ngoài; mọi lời gọi đi qua workflow-api ([ADR 0004](adr/0004-workflow-access-control.md)). Mỗi quy trình
  được deploy riêng cho từng tenant.
- **Cấu hình:** sơ đồ BPMN là tệp XML trong `core/workflow/processes/`; `make seed` deploy cho mọi tenant, chạy lại
  không tạo phiên bản mới nếu tệp không đổi.
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

### SeaweedFS: lưu trữ đối tượng

- **Làm gì:** lưu tệp (tài liệu, ảnh, bản quét) và cung cấp API tương thích S3, nên ứng dụng dùng được thư viện S3
  có sẵn.
- **Trong dự án:** chạy một máy chủ gộp, khóa truy cập S3 lấy từ `S3_ACCESS_KEY` và `S3_SECRET_KEY`. Dịch vụ đã
  chạy nhưng chưa nối vào ứng dụng; đường vào qua cổng kèm quét mã độc tệp tải lên là kế hoạch.
- **Xem:** API S3 tại `http://127.0.0.1:8333`.

## Công cụ phát triển và kiểm tra

Các công cụ này chỉ dùng khi phát triển và trong CI, không đóng gói vào sản phẩm, nên giấy phép của chúng không ảnh
hưởng tới mã Apache-2.0 của dự án. Những công cụ chạy qua `uvx` không cần cài sẵn, chỉ cần `uv`.

| Công cụ | Dùng để | Gọi qua | Giấy phép |
|---|---|---|---|
| Docker Engine, Docker Compose v2 | Chạy các dịch vụ lõi bằng image chính thức | `make up`, `make down`, `make reset` | Apache-2.0 |
| GNU Make | Lối vào chung cho mọi lệnh | `make help` | GPL-3.0-or-later |
| uv | Quản lý Python và thư viện của workflow-api; chạy công cụ không cần cài | `make test`, `make check-fast` | MIT / Apache-2.0 |
| REUSE | Kiểm mọi tệp có header bản quyền và giấy phép | `make lint` | GPL-3.0-or-later |
| ShellCheck | Bắt lỗi trong script shell | `make check-fast` | GPL-3.0 |
| yamllint | Kiểm cú pháp và định dạng YAML | `make check-fast` | GPL-3.0 |
| Ruff | Kiểm lỗi và định dạng mã Python | `make check-fast` | MIT |
| pytest | Kiểm thử đơn vị workflow-api | `make test` | MIT |
| curl, jq, openssl | Gọi API trong seed và smoke, đọc JSON, sinh bí mật ngẫu nhiên | `scripts/` | curl / MIT / Apache-2.0 |
| GitHub Actions | CI: chạy `make check-fast`, `make test`, dựng lõi trên máy trắng và `make smoke` | `.github/workflows/ci.yml` | dịch vụ của GitHub |
