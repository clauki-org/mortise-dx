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
| Lưu trữ đối tượng tương thích S3 (SeaweedFS) | Dịch vụ chạy, chưa nối vào ứng dụng | |
| Xác thực đa yếu tố, cơ chế đăng nhập theo chính sách từng tenant | Kế hoạch | |
| Phân quyền chi tiết theo vai trò và đơn vị | Kế hoạch | |
| Nhật ký thay đổi, sổ cái chống sửa, kiểm dữ liệu theo schema | Kế hoạch | |
| Sao lưu và khôi phục toàn bộ lõi | Đã chạy | CI: sao lưu → xóa → khôi phục → `make smoke` |
| Thành phần Tầng 2 và giao diện | Kế hoạch | |
| Gói minh họa: vận hành cơ sở vật chất công cấp xã | Kế hoạch | |

## Chạy từ mã nguồn

Yêu cầu: Linux hoặc macOS, Docker Engine 24+ với Compose v2, `make`, `curl`, `jq`, `openssl`. Khuyến nghị 8 GB RAM
trở lên.

```bash
make up      # tạo .env với bí mật ngẫu nhiên, dựng lõi, chờ sẵn sàng
make seed    # tài khoản demo cho 2 tenant và quyền dữ liệu
make smoke   # kiểm tra đầu-cuối qua cổng
```

| Địa chỉ | Dịch vụ |
|---|---|
| `http://localhost:9080/auth/...` | Đăng nhập, cấp token (qua cổng) |
| `http://localhost:9080/v1/graphql` | API dữ liệu, bắt buộc token |
| `http://localhost:9080/v1/workflow/...` | API quy trình, bắt buộc token |
| `http://127.0.0.1:8081/auth/admin` | Quản trị Keycloak (chỉ máy chủ) |
| `http://127.0.0.1:8082/console` | Quản trị Hasura (chỉ máy chủ) |
| `http://127.0.0.1:8083/flowable-rest/docs` | REST API của Flowable (chỉ máy chủ) |

Trang quản trị Keycloak, Hasura và Flowable là công cụ kỹ thuật cho người vận hành, chỉ mở trong máy chủ; lõi không có giao
diện cho người dùng nghiệp vụ. Cách gọi API kèm ví dụ và ý nghĩa mã lỗi: [docs/api.md](docs/api.md).

Sao lưu và khôi phục (đã kiểm: sao lưu, xóa sạch lõi, dựng lại, khôi phục, `make smoke` qua):

```bash
make backup                                       # CSDL, tệp, .env → ~/.local/share/mortise-dx/backups/<thời điểm>
make restore FROM=<thư mục sao lưu> CONFIRM=yes   # GHI ĐÈ dữ liệu hiện tại
```

Tài khoản demo: `user.a`, `manager.a` (tenant `xuong-a`), `user.b` (tenant `xuong-b`); mật khẩu là
`DEMO_USER_PASSWORD` trong `.env`. Mọi lệnh khác: `make help`.

## Kiến trúc

```
Tầng 3  gói nghiệp vụ (cấu hình + mở rộng)    ── cài vào / gỡ ra
Tầng 2  thành phần dùng chung + giao diện      ── chỉ gọi lõi qua cổng
          │ HTTPS + access token
Tầng 1  APISIX (cổng duy nhất, kiểm JWT, giới hạn tần suất)
          ├─ Keycloak   định danh, SSO, vai trò, tenant
          ├─ Hasura CE  API GraphQL tự sinh, quyền theo dòng
          ├─ workflow-api → Flowable  quy trình BPMN theo tenant và vai trò
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
| Lớp kiểm quyền quy trình (tự viết) | Python 3.13, FastAPI, HTTPX, PyJWT | khóa trong `core/workflow-api/uv.lock` | MIT / BSD-3-Clause |

Từng thành phần và công cụ phát triển làm gì, cấu hình ở đâu, xem thế nào: [docs/tools.md](docs/tools.md).

## Bố cục repo hiện tại

```
compose.yaml          các dịch vụ lõi và cách nối với nhau
Makefile              lối vào duy nhất: dựng, kiểm tra, sao lưu
core/                 Tầng 1: cấu hình lõi và dịch vụ tự viết của lõi
  apisix/ keycloak/ postgres/
  postgres/migrations/  migration lược đồ của lõi (dbmate)
  workflow-api/       kiểm quyền trước Flowable (Python)
  workflow/fixtures/  quy trình mẫu chỉ dùng để kiểm thử lõi
scripts/              tạo .env, seed, smoke, tạo migration, sao lưu, khôi phục, hook pre-push
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
