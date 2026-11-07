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

Token mang các claim lõi dùng để phân quyền:

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

## Lưu trữ đối tượng (S3)

SeaweedFS cung cấp API tương thích S3 tại `http://127.0.0.1:8333`, hiện chỉ mở trong máy chủ. Khóa truy cập là
`S3_ACCESS_KEY` và `S3_SECRET_KEY` trong `.env`. Đường vào qua cổng cho ứng dụng nằm trong kế hoạch, kèm kiểm dịch
tệp tải lên.
