<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# API của lõi

Mọi API đi qua cổng APISIX tại `http://localhost:9080` (đổi bằng `DXOS_PUBLIC_URL`). Trừ đăng nhập, mọi lời gọi
phải có access token của Keycloak; không có hoặc sai token thì cổng trả `401`. Các ví dụ dưới đây chạy được sau
`make up && make seed`, và cũng là những gì `make smoke` kiểm tra.

## Lấy token

```bash
set -a; . ./.env; set +a
TOKEN=$(curl -fsS http://localhost:9080/auth/realms/dxos/protocol/openid-connect/token \
  -d grant_type=password -d client_id=dxos-web \
  -d username=user.a -d "password=$DEMO_USER_PASSWORD" | jq -r .access_token)
```

Token mang các claim lõi dùng để phân quyền (hợp đồng: [`contracts/token-claims.schema.json`](../contracts/token-claims.schema.json)):

| Claim | Ý nghĩa |
|---|---|
| `sub` | Mã người dùng |
| `tenant` | Đơn vị (tenant) của người dùng, đúng một giá trị |
| `realm_access.roles` | Vai trò, ví dụ `user`, `manager` |

Luồng mật khẩu (`grant_type=password`) chỉ dùng cho demo và kiểm thử. Ứng dụng web dùng luồng Authorization Code
với PKCE.

## Dữ liệu: `POST /v1/graphql`

API GraphQL do Hasura tự sinh từ CSDL. Mỗi truy vấn chỉ thấy các dòng thuộc tenant trong token.

```bash
curl -fsS -X POST http://localhost:9080/v1/graphql \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":"{ core_tenants { id name } }"}'
```

| Mã trả về | Khi nào |
|---|---|
| `200` | Truy vấn hợp lệ; lỗi nghiệp vụ nằm trong trường `errors` của GraphQL |
| `401` | Thiếu hoặc sai token |
| `429` | Vượt giới hạn 600 yêu cầu mỗi phút cho mỗi token |

## Quy trình: `/v1/workflow/*`

Hợp đồng đầy đủ (OpenAPI, có schema phản hồi và lỗi): [`contracts/workflow-api.openapi.json`](../contracts/workflow-api.openapi.json).

Lớp `workflow-api` đứng trước Flowable: kiểm token, giới hạn theo tenant và vai trò, áp quy tắc bốn mắt. Flowable
không có đường vào trực tiếp từ bên ngoài.

| Phương thức | Đường dẫn | Việc |
|---|---|---|
| `POST` | `/v1/workflow/processes/{key}/instances` | Khởi tạo một quy trình của tenant mình; thân `{"variables": {...}}` |
| `GET` | `/v1/workflow/tasks` | Các task giao cho mình hoặc cho vai trò của mình, trong tenant mình |
| `POST` | `/v1/workflow/tasks/{id}/complete` | Hoàn thành task; thân `{"variables": {...}}` |
| `GET` | `/v1/workflow/instances/{id}` | Trạng thái một quy trình của tenant mình |

Ví dụ với quy trình mẫu `core-approval` (do `make seed` deploy cho từng tenant):

```bash
curl -fsS -X POST http://localhost:9080/v1/workflow/processes/core-approval/instances \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"variables":{"title":"Yêu cầu mẫu"}}'
```

| Mã trả về | Khi nào |
|---|---|
| `201` / `204` | Khởi tạo / hoàn thành thành công |
| `400` | Ghi đè biến dành riêng của lõi (`initiator`, `initiatorName`, `tenant`) |
| `401` | Thiếu hoặc sai token |
| `403` | Tài khoản không thuộc đúng một tenant; task đã giao cho người khác; không có vai trò ứng viên; người gửi tự duyệt yêu cầu của mình |
| `404` | Task hay quy trình không tồn tại hoặc thuộc tenant khác (không tiết lộ là tồn tại); tenant chưa có quy trình đó |
| `409` | Task vừa được người khác nhận |
| `422` | Thân yêu cầu sai định dạng |
| `502` / `503` | Flowable trả lỗi (thông điệp được chuyển lại) / không kết nối được Flowable |

## Lưu trữ đối tượng (S3)

SeaweedFS cung cấp API tương thích S3 tại `http://127.0.0.1:8333`, hiện chỉ mở trong máy chủ. Khóa truy cập là
`S3_ACCESS_KEY` và `S3_SECRET_KEY` trong `.env`. Đường vào qua cổng cho ứng dụng nằm trong kế hoạch, kèm kiểm dịch
tệp tải lên.
