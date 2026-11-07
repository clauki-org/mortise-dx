<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Mortise DX

Nền tảng chuyển đổi số nguồn mở theo kiến trúc DX-OS Open-Core: một lõi chạy ngầm, không giao diện, cung cấp định
danh, cổng API, dữ liệu và quy trình dùng chung; phía trên là các thành phần cấu hình được, để mỗi tổ chức tự lắp
thành hệ thống của mình mà không phải viết lại phần nền.

Tên dự án lấy từ *mortise*, lỗ mộng trong nghề mộc: khung gỗ có sẵn lỗ, thanh gỗ có chốt vừa lỗ được cắm vào hay
rút ra mà khung vẫn đứng, không cần đinh. Nền tảng là khung, gói nghiệp vụ là thanh gỗ.

> **Trạng thái:** mới dựng khung repo, chưa có mã nguồn chạy được. Mục [Trạng thái](#trạng-thái) chỉ ghi những gì
> đã chạy thật và đã có kiểm tra tự động.

## Giới thiệu

Tổ chức chuyển đổi số hay rơi vào một trong hai cực: mua nhiều phần mềm rời rạc nên dữ liệu bị chia cắt, hoặc mua
một hệ thống nguyên khối và phụ thuộc một nhà cung cấp. Mortise DX tách ba tầng:

1. **Lõi (Tầng 1):** dịch vụ dùng chung cho mọi ứng dụng, chỉ có API.
2. **Thành phần dùng chung (Tầng 2):** danh mục, biểu mẫu, quy trình, hồ sơ tài liệu, bản đồ, báo cáo, trợ lý AI;
   cấu hình bằng khai báo, không chứa nghiệp vụ của ngành nào.
3. **Gói nghiệp vụ (Tầng 3):** cấu hình và phần mở rộng cho một lĩnh vực; cài vào hoặc gỡ ra mà lõi vẫn chạy.

Mã nguồn mở và dữ liệu nằm trên máy chủ của tổ chức. Một bản cài phục vụ nhiều đơn vị (tenant) với dữ liệu tách
biệt.

## Trạng thái

| Năng lực | Trạng thái | Kiểm chứng |
|---|---|---|
| Giấy phép từng tệp, kiểm tra shell và YAML | Đã chạy | `make check-fast`, CI |
| Định danh / SSO (Keycloak, OIDC) | Kế hoạch | |
| Cổng API duy nhất (APISIX) | Kế hoạch | |
| API dữ liệu tự sinh (Hasura CE), phân quyền theo tenant | Kế hoạch | |
| Lưu trữ đối tượng tương thích S3 (SeaweedFS) | Kế hoạch | |
| Workflow BPMN (Flowable) | Kế hoạch | |
| Sao lưu và khôi phục toàn bộ lõi | Kế hoạch | |
| Thành phần Tầng 2 và giao diện | Kế hoạch | |
| Gói minh họa: vận hành cơ sở vật chất công cấp xã | Kế hoạch | |

## Kiến trúc dự kiến

```
Tầng 3  gói nghiệp vụ (cấu hình + mở rộng)    ── cài vào / gỡ ra
Tầng 2  thành phần dùng chung + giao diện      ── chỉ gọi lõi qua cổng
          │ HTTPS + access token
Tầng 1  APISIX (cổng duy nhất, kiểm JWT, giới hạn tần suất)
          ├─ Keycloak   định danh, SSO, vai trò, tenant
          ├─ Hasura CE  API GraphQL tự sinh, quyền theo dòng
          ├─ Flowable   quy trình BPMN theo tenant và vai trò
          ├─ PostgreSQL dữ liệu có cấu trúc (+ pgvector)
          └─ SeaweedFS  dữ liệu phi cấu trúc (S3)
```

Lý do chọn từng thành phần và kiểm tra giấy phép: [ADR 0002](docs/adr/0002-chon-thanh-phan-loi.md). Bố cục ba tầng
trong repo: [ADR 0003](docs/adr/0003-bo-cuc-ba-tang-va-goi-nghiep-vu.md) và [AGENTS.md](AGENTS.md#2-bố-cục).

## Bố cục repo hiện tại

```
Makefile              lối vào duy nhất cho mọi lệnh
scripts/              lệnh hỗ trợ (hook pre-push)
docs/adr/             quyết định kiến trúc
.github/              CI, mẫu issue và pull request
```

## Giấy phép

Mã nguồn của dự án phát hành theo [Apache-2.0](LICENSE). Mỗi tệp có header SPDX; kiểm tra bằng `make check-fast`
(công cụ [REUSE](https://reuse.software)). Thành phần bên thứ ba sẽ chạy dưới dạng container chính thức, không sửa
mã, và giữ giấy phép riêng (ADR 0002).

## Đóng góp

Xem [CONTRIBUTING.md](CONTRIBUTING.md) và [quy tắc ứng xử](CODE_OF_CONDUCT.md); quy tắc làm việc ở
[AGENTS.md](AGENTS.md). Báo lỗi tại mục Issues, lỗ hổng bảo mật theo [SECURITY.md](SECURITY.md).
