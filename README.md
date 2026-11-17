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
| Định danh / SSO (Keycloak, OIDC) | Đã chạy | `make smoke` |
| Cổng API duy nhất (APISIX), chặn yêu cầu không token hoặc token giả | Đã chạy | `make smoke` |
| Console quản trị không lộ qua cổng | Đã chạy | `make smoke` |
| API dữ liệu tự sinh (Hasura CE), cách ly dữ liệu theo tenant | Đã chạy | `make smoke` |
| Workflow BPMN (Flowable sau lớp workflow-api): cách ly tenant, phân quyền theo vai trò, quy tắc bốn mắt | Đã chạy | `make smoke`, `make test` |
| Tệp qua cổng (`/v1/files`, SeaweedFS): tải lên, tải xuống theo tenant, giới hạn cỡ, quét mã độc trước khi lưu (ClamAV) | Đã chạy | `make smoke` (tệp thử EICAR), `make test` |
| Đăng nhập hai bước (OTP) cho người có quyền duyệt; workflow-api từ chối duyệt khi token không có bước OTP | Đã chạy | `make smoke`, `make test`, `make e2e` |
| Dữ liệu thiết bị: nhận số đo qua MQTT trong mạng riêng (mỗi thiết bị một tài khoản, chỉ gửi vào chủ đề của mình), giữ theo NGSI-LD (Scorpio), đọc qua `/v1/context` chỉ thấy thiết bị của đơn vị mình; bộ giả lập thiết bị (`make simulate`); mở hồ sơ khi vượt ngưỡng là kế hoạch | Đã chạy | `make smoke` (gồm bộ giả lập), `make test` |
| Cơ chế đăng nhập theo chính sách từng tenant, Passkey | Kế hoạch | |
| Phân quyền chi tiết theo vai trò và đơn vị | Kế hoạch | |
| Nhật ký thay đổi: ai sửa gì, lúc nào, trước và sau; chuỗi băm phát hiện sửa lén, đối chiếu băm trong bản sao lưu | Đã chạy | `make smoke`, `make audit-verify` |
| Chỉ số trỏ về bản ghi nguồn, chỉ số chất lượng dữ liệu | Kế hoạch | |
| Sao lưu và khôi phục toàn bộ lõi | Đã chạy | CI: sao lưu → xóa → khôi phục → `make smoke` |
| Khung giao diện Tầng 2: đăng nhập Authorization Code + PKCE, gọi API bằng token, header bảo mật | Đã chạy | `make smoke` (cổng, CSP, luồng PKCE), `make web-check`, `make e2e` |
| Bảng việc: danh sách việc đang chờ người đăng nhập theo hạn; màn hình xử lý với biểu mẫu và nút theo khai báo của bước | Đã chạy | `make e2e` (trình duyệt: duyệt, bốn mắt, cách ly đơn vị), `make web-check` |
| Thành phần Tầng 2 khác (danh mục, biểu mẫu nhập liệu, bản đồ) | Kế hoạch | |
| Gói minh họa `apps/facilities-commune`: bảng cơ sở, tòa, phòng cách ly theo tenant, có nhật ký; cài vào, gỡ ra bằng `make app-install`, `make app-uninstall` | Đã chạy | CI: cài gói → smoke gói → `make seed`, `make smoke` khi gói đang cài → gỡ gói → `make smoke` |
| Gói minh họa: định mức, dữ liệu mẫu ba xã, quy trình rà soát, bản đồ | Kế hoạch | |

## Chạy từ mã nguồn

Yêu cầu: Linux hoặc macOS, Docker Engine 24+ với Compose v2, `make`, `curl`, `jq`, `openssl` và
[`uv`](https://docs.astral.sh/uv/) (`make smoke` dùng nó để kiểm token theo hợp đồng). Khuyến nghị 8 GB RAM trở lên;
riêng ClamAV dùng khoảng 1 GB. Phát triển giao diện cần thêm Node.js 26.

```bash
make up      # tạo .env với bí mật ngẫu nhiên, dựng lõi, chờ sẵn sàng
make seed    # tài khoản demo cho 2 tenant và quyền dữ liệu
make smoke   # kiểm tra đầu-cuối qua cổng
make e2e     # kịch bản demo trên trình duyệt (cần Node)
```

| Địa chỉ | Dịch vụ |
|---|---|
| `http://localhost:9080/` | Giao diện (đăng nhập bằng tài khoản demo bên dưới) |
| `http://localhost:9080/auth/...` | Đăng nhập, cấp token (qua cổng) |
| `http://localhost:9080/v1/graphql` | API dữ liệu, bắt buộc token |
| `http://localhost:9080/v1/workflow/...` | API quy trình, bắt buộc token |
| `http://localhost:9080/v1/files` | API tệp, bắt buộc token |
| `http://localhost:9080/v1/context/entities` | Dữ liệu thiết bị (NGSI-LD), chỉ đọc, bắt buộc token |
| `http://127.0.0.1:8081/auth/admin` | Quản trị Keycloak (chỉ máy chủ) |
| `http://127.0.0.1:8082/console` | Quản trị Hasura (chỉ máy chủ) |
| `http://127.0.0.1:8083/flowable-rest/docs` | REST API của Flowable (chỉ máy chủ) |
| `http://127.0.0.1:9090/ngsi-ld/v1/...` | API NGSI-LD của Scorpio, không xác thực (chỉ máy chủ) |

Trang quản trị Keycloak, Hasura và Flowable là công cụ kỹ thuật cho người vận hành, chỉ mở trong máy chủ; lõi không có giao
diện cho người dùng nghiệp vụ. Cách gọi API kèm ví dụ và ý nghĩa mã lỗi: [docs/api.md](docs/api.md).

Sao lưu và khôi phục (đã kiểm: sao lưu, xóa sạch lõi, dựng lại, khôi phục, `make smoke` qua):

```bash
make backup                                       # CSDL, tệp, .env → ~/.local/share/mortise-dx/backups/<thời điểm>
make restore FROM=<thư mục sao lưu> CONFIRM=yes   # GHI ĐÈ dữ liệu hiện tại
```

Tài khoản demo: `user.a`, `manager.a` (tenant `xuong-a`), `user.b`, `manager.b` (tenant `xuong-b`); mật khẩu là
`DEMO_USER_PASSWORD` trong `.env`. Người duyệt (`manager.*`) nhập thêm mã OTP: `make otp` in mã hiện tại và khóa để
nhập vào ứng dụng OTP trên điện thoại ([ADR 0011](docs/adr/0011-approver-mfa.md)). Thiết bị demo nằm trong
`devices/simulator/devices.yaml`, mật khẩu MQTT `DEMO_DEVICE_PASSWORD`; `make simulate` gửi số đo giả cho chúng.
Thiết bị khác cấp tài khoản bằng `make device-add TENANT=<tenant> DEVICE=<thiết bị>`. Mọi lệnh khác: `make help`.

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
| Lớp kiểm quyền quy trình (tự viết) | Python 3.13, FastAPI, HTTPX, PyJWT | khóa trong `core/workflow-api/uv.lock` | MIT / BSD-3-Clause |
| API tệp (tự viết) | Python 3.13, FastAPI, boto3, pg8000, PyJWT | khóa trong `core/files-api/uv.lock` | MIT / BSD-3-Clause / Apache-2.0 |
| Lớp đọc dữ liệu thiết bị (tự viết) | Python 3.13, FastAPI, HTTPX, PyJWT | khóa trong `core/context-api/uv.lock` | MIT / BSD-3-Clause |
| Cầu nối MQTT sang NGSI-LD (tự viết) | Python 3.13, paho-mqtt, HTTPX, pg8000 | khóa trong `core/iot-bridge/uv.lock` | EPL-2.0 / EDL-1.0 / BSD-3-Clause |
| Phục vụ giao diện | nginx | 1.30.6 | BSD-2-Clause |
| Giao diện Tầng 2 (tự viết) | React, Mantine, oidc-client-ts, urql, React Router, TanStack Query, rjsf ([ADR 0006](docs/adr/0006-frontend-stack.md)) | khóa trong `platform/web/package-lock.json` | MIT / Apache-2.0 |

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
  iot-bridge/         nhận số đo qua MQTT, ghi vào Scorpio (Python)
  mosquitto/          cấu hình Mosquitto
  workflow/fixtures/  quy trình mẫu chỉ dùng để kiểm thử lõi
platform/             Tầng 2
  web/                khung giao diện (React, Vite), phục vụ bằng nginx sau cổng
  schema/migrations/  migration lược đồ `platform` (dbmate): khai báo bước của quy trình
apps/facilities-commune/  Tầng 3: gói cơ sở vật chất xã (app.yaml, migration, quyền Hasura, smoke của gói)
devices/simulator/    bộ giả lập và danh sách thiết bị demo (Python)
scripts/              tạo .env, seed, smoke, tạo migration, cài và gỡ gói, sao lưu, khôi phục, hook pre-push
docs/                 quyết định kiến trúc (adr/), API của lõi (api.md), công cụ (tools.md)
.github/              CI, mẫu issue và pull request
```

## Giấy phép

Mã nguồn của dự án phát hành theo [Apache-2.0](LICENSE). Mỗi tệp có header SPDX; kiểm tra bằng `make check-fast`
(công cụ [REUSE](https://reuse.software)). Thành phần bên thứ ba chạy dưới dạng container chính thức, không sửa mã,
và giữ giấy phép riêng (bảng trên và ADR 0002).

## Đóng góp

Xem [CONTRIBUTING.md](CONTRIBUTING.md) và [quy tắc ứng xử](CODE_OF_CONDUCT.md); quy tắc làm việc ở
[AGENTS.md](AGENTS.md). Báo lỗi tại mục Issues, lỗ hổng bảo mật theo [SECURITY.md](SECURITY.md).
