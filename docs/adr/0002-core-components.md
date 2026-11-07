<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0002. Chọn thành phần lõi và kiểm tra giấy phép

- Trạng thái: Chấp nhận
- Ngày: 2026-11-05

## Bối cảnh

Lõi Tầng 1 không có giao diện và cung cấp bốn dịch vụ dùng chung: định danh và đăng nhập một lần (SSO), cổng API,
quản trị dữ liệu có cấu trúc và phi cấu trúc, và quy trình (workflow). Toàn bộ sản phẩm phải là phần mềm nguồn mở
theo giấy phép được OSI công nhận, để tổ chức tự cài trên máy chủ của mình mà không vướng điều khoản thương mại. Một
số thành phần phổ biến cho các vai trò này đã đổi sang giấy phép không còn được OSI công nhận.

## Quyết định

| Vai trò | Thành phần | Giấy phép |
|---|---|---|
| Định danh / SSO | Keycloak | Apache-2.0 |
| Cổng API | Apache APISIX (standalone, không etcd) | Apache-2.0 |
| CSDL | PostgreSQL + pgvector | PostgreSQL License |
| API tự sinh | Hasura GraphQL Engine **Community Edition** (`-ce`) | Apache-2.0 |
| Lưu trữ đối tượng | SeaweedFS | Apache-2.0 |
| Workflow | Flowable (`flowable-rest`, chỉ engine và REST API) | Apache-2.0 |
| Dịch vụ tự viết (workflow-api, [ADR 0004](0004-workflow-access-control.md)) | FastAPI, Uvicorn, HTTPX, PyJWT | MIT / BSD-3-Clause / BSD-3-Clause / MIT |
| NGSI-LD (dự kiến) | Scorpio Broker (chạy trên PostgreSQL) | BSD-3-Clause |
| MQTT (dự kiến) | Eclipse Mosquitto | EPL-2.0 / EDL-1.0 |
| Quét mã độc (dự kiến) | ClamAV | GPL-2.0 (chạy như dịch vụ riêng) |
| Bí mật (dự kiến) | SOPS + age | MPL-2.0 / BSD-3-Clause |

Thành phần **không dùng** dù phổ biến cho cùng vai trò:

| Thành phần | Giấy phép hiện tại | Thay bằng |
|---|---|---|
| HashiCorp Vault | BSL 1.1 | SOPS + age, hoặc OpenBao (MPL-2.0) |
| MongoDB (Orion Context Broker cần) | SSPL | Scorpio trên PostgreSQL |
| Redpanda | BSL 1.1 | không cần ở quy mô hiện tại |
| n8n | Sustainable Use License | Flowable |
| Hasura bản không `-ce` | có mã Enterprise | Hasura `-ce` |

## Hệ quả

- Mọi thành phần chạy bằng image chính thức, không sửa mã, không đóng gói kèm mã nguồn bên thứ ba vào repo.
- Phiên bản image được ghim cụ thể, không dùng `latest`.
- Thêm thành phần mới phải bổ sung vào bảng trên trong cùng pull request.
