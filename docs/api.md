<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# API của lõi

Mọi API đi qua cổng APISIX tại `http://localhost:9080` (đổi bằng `MORTISE_PUBLIC_URL`). Trừ đăng nhập, mọi lời gọi
phải có access token của Keycloak; không có hoặc sai token thì cổng trả `401` với thân JSON `{"error": "..."}`,
cùng dạng lỗi của API quy trình. Các ví dụ dưới đây chạy được sau
`make up && make seed`, và cũng là những gì `make smoke` kiểm tra.

## Lấy token

Trên bản cài phát triển, lấy token bằng lệnh qua client `mortise-test` do `make seed` tạo. Ứng dụng web dùng client
`mortise-web` với Authorization Code + PKCE; client này không nhận mật khẩu trực tiếp.

```bash
set -a; . ./.env; set +a
TOKEN=$(curl -fsS http://localhost:9080/auth/realms/mortise/protocol/openid-connect/token \
  -d grant_type=password -d client_id=mortise-test \
  -d username=user.a -d "password=$DEMO_USER_PASSWORD" | jq -r .access_token)
```

Người duyệt (vai trò `manager`) gửi kèm mã OTP, ví dụ `-d username=manager.a -d totp=<mã>`; `make otp` in mã của tài
khoản demo. Thiếu mã thì Keycloak trả `invalid_grant`. Mỗi mã chỉ dùng được một lần.

Token mang các claim lõi dùng để phân quyền (hợp đồng: [`contracts/token-claims.schema.json`](../contracts/token-claims.schema.json)):

| Claim | Ý nghĩa |
|---|---|
| `sub` | Mã người dùng |
| `tenant` | Đơn vị (tenant) của người dùng, đúng một giá trị |
| `realm_access.roles` | Vai trò, ví dụ `user`, `manager` |
| `amr` | Cách đã đăng nhập: `pwd` (mật khẩu), `otp` (mã OTP) |

## Dữ liệu: `POST /v1/graphql`

API GraphQL do Hasura tự sinh từ CSDL. Mỗi truy vấn chỉ thấy các dòng thuộc tenant trong token; gói có thể giới hạn
thêm, ví dụ gói xã chỉ cho cán bộ thấy cơ sở mình được phân công. Truy vấn chạy với vai trò `user`; muốn dùng vai trò
khác có trong token (`manager`, `tenant_admin`) thì gửi kèm header `X-Hasura-Role: <vai trò>`.

```bash
curl -fsS -X POST http://localhost:9080/v1/graphql \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":"{ core_tenants { id name } }"}'
```

Khai báo bước của quy trình (`contracts/workflow.schema.json`) nằm ở `platform_workflow_steps`, một dòng mỗi bước:
`process` và `step` khớp với hai trường cùng tên của task trong API quy trình, `config` là phần khai báo của bước
(biểu mẫu, nút, hồ sơ). `make seed` nạp khai báo của quy trình mẫu `core-approval`; `make app-install` nạp khai
báo của gói từ `apps/<gói>/workflows/*.yaml`, cùng BPMN mà `app.yaml` khai ở `workflows`.

Menu của các gói đã cài nằm ở `platform_menu_items`, một dòng mỗi mục của `menu` trong `app.yaml`: `app` là gói,
`item` là id của mục, `position` là thứ tự gói khai, `config` là nội dung tệp cấu hình của thành phần (không phải
đường dẫn), `roles` là vai trò thấy mục (`null` là mọi người).

```bash
curl -fsS -X POST http://localhost:9080/v1/graphql \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":"{ platform_menu_items(order_by: {position: asc}) { app item label component config roles } }"}'
```

```bash
curl -fsS -X POST http://localhost:9080/v1/graphql \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":"{ platform_workflow_steps { process step config } }"}'
```

Văn bản cho trợ lý hỏi văn bản (`contracts/knowledge.schema.json`, [ADR 0021](adr/0021-document-assistant.md)) nằm ở
`platform_knowledge_documents` (một dòng mỗi văn bản: tên, nguồn, băm và ngày tải bản gốc) và
`platform_knowledge_passages` (một dòng mỗi đoạn: `label` là nhãn vị trí, `text` là nguyên văn, `position` là thứ tự
trong văn bản; đoạn đã bị thay có `superseded_by_document` và `superseded_by_passage`). `app` là gói, hay `core` cho
văn bản mẫu hư cấu mà `make seed` nạp; `make app-install` nạp văn bản gói khai ở `knowledge`. Mỗi người chỉ đọc được
bản của tenant mình.

```bash
curl -fsS -X POST http://localhost:9080/v1/graphql \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":"{ platform_knowledge_passages(order_by: [{document_id: asc}, {position: asc}]) { document_id label text superseded_by_passage document { title } } }"}'
```

| Mã trả về | Khi nào |
|---|---|
| `200` | Truy vấn hợp lệ; lỗi nghiệp vụ nằm trong trường `errors` của GraphQL |
| `401` | Thiếu hoặc sai token |
| `429` | Vượt giới hạn 600 yêu cầu mỗi phút cho mỗi token; thân hiện là trang HTML của cổng, chưa theo dạng JSON |

## Quy trình: `/v1/workflow/*`

Hợp đồng đầy đủ (OpenAPI, có schema phản hồi và lỗi): [`contracts/workflow-api.openapi.json`](../contracts/workflow-api.openapi.json).

Lớp `workflow-api` đứng trước Flowable: kiểm token, giới hạn theo tenant và vai trò, áp quy tắc bốn mắt. Flowable
không có đường vào trực tiếp từ bên ngoài.

| Phương thức | Đường dẫn | Việc |
|---|---|---|
| `POST` | `/v1/workflow/processes/{key}/instances` | Khởi tạo một quy trình của tenant mình; thân `{"variables": {...}}` hoặc không có thân; header `Idempotency-Key` tùy chọn |
| `GET` | `/v1/workflow/tasks` | Các task giao cho mình hoặc cho vai trò của mình, trong tenant mình; mỗi task có `process`, `step` (id của userTask) và `due` (hạn, có thể null) |
| `POST` | `/v1/workflow/tasks/{id}/complete` | Hoàn thành task; thân `{"variables": {...}}` hoặc không có thân |
| `GET` | `/v1/workflow/instances/{id}` | Trạng thái một quy trình của tenant mình |

Ví dụ với quy trình mẫu `core-approval` (do `make seed` deploy cho từng tenant):

```bash
curl -fsS -X POST http://localhost:9080/v1/workflow/processes/core-approval/instances \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"variables":{"title":"Yêu cầu mẫu"}}'
```

Chống gửi trùng: giao diện sinh một mã ngẫu nhiên (ví dụ UUID) mỗi lần mở biểu mẫu và gửi trong header
`Idempotency-Key`. Gửi lại cùng mã, cùng người, cùng quy trình thì nhận lại quy trình đã tạo thay vì tạo quy trình
mới, kể cả khi quy trình đó đã kết thúc. Người khác dùng trùng mã vẫn tạo quy trình của riêng họ. Hai lần gửi cùng
lúc chỉ được xếp lần lượt khi workflow-api chạy một bản như trong `compose.yaml`.

Tài khoản dịch vụ ([ADR 0017](adr/0017-service-account-for-tenant.md)): client Keycloak `mortise-iot-bridge` lấy
token bằng client credentials, secret `IOT_BRIDGE_CLIENT_SECRET` trong `.env`. Token này không có tenant; mỗi yêu cầu
ghi tenant ở header `X-Mortise-Tenant` và chỉ được khởi tạo quy trình. Với tài khoản dịch vụ, `Idempotency-Key` chỉ
khớp quy trình còn mở: còn hồ sơ mở thì nhận lại hồ sơ đó, hồ sơ đã kết thúc thì cùng mã mở hồ sơ mới.

```bash
SERVICE=$(curl -fsS http://localhost:9080/auth/realms/mortise/protocol/openid-connect/token \
  -d grant_type=client_credentials -d client_id=mortise-iot-bridge \
  -d "client_secret=$IOT_BRIDGE_CLIENT_SECRET" | jq -r .access_token)
curl -fsS -X POST http://localhost:9080/v1/workflow/processes/core-approval/instances \
  -H "Authorization: Bearer $SERVICE" -H 'X-Mortise-Tenant: xa-a' -H 'Idempotency-Key: rule-x__device-1'
```

| Mã trả về | Khi nào |
|---|---|
| `201` / `204` | Khởi tạo / hoàn thành thành công |
| `400` | Ghi đè biến dành riêng của lõi (`initiator`, `initiatorName`, `tenant`, `idempotencyKey`); `Idempotency-Key` sai định dạng (8–100 ký tự chữ, số, `-`, `_`); người dùng gửi `X-Mortise-Tenant`; tài khoản dịch vụ thiếu header đó |
| `401` | Thiếu hoặc sai token |
| `403` | Tài khoản không thuộc đúng một tenant; tài khoản dịch vụ gọi đường khác ngoài khởi tạo quy trình; người duyệt (`manager`) đăng nhập chưa qua bước OTP; task đã giao cho người khác; không có vai trò ứng viên; người gửi tự duyệt yêu cầu của mình |
| `404` | Task hay quy trình không tồn tại hoặc thuộc tenant khác (không tiết lộ là tồn tại); tenant chưa có quy trình đó |
| `409` | Task vừa được người khác nhận |
| `422` | Thân yêu cầu sai định dạng hoặc có khóa ngoài `variables`, ví dụ gửi `{"approved": true}` thiếu lớp `variables` |
| `502` / `503` | Flowable trả lỗi (thông điệp được chuyển lại) / không kết nối được Flowable |

## Tệp: `/v1/files`

Hợp đồng đầy đủ: [`contracts/files-api.openapi.json`](../contracts/files-api.openapi.json). Lớp `files-api` đứng trước
SeaweedFS: gán tenant và người tải lên từ token, giới hạn cỡ (mặc định 20 MB, đổi bằng `FILES_MAX_BYTES`), quét mã
độc bằng ClamAV trước khi lưu, ghi tên, cỡ, băm SHA-256 vào bảng `core.files`. SeaweedFS và ClamAV không có đường vào
từ bên ngoài.

| Phương thức | Đường dẫn | Việc |
|---|---|---|
| `POST` | `/v1/files?name=<tên tệp>` | Tải lên; thân là nội dung tệp nguyên văn, `Content-Type` là kiểu của tệp |
| `GET` | `/v1/files/{id}` | Thông tin tệp: tên, kiểu, cỡ, băm, người tải, trạng thái, thời điểm |
| `GET` | `/v1/files/{id}/content` | Tải xuống; luôn là tệp đính kèm, trình duyệt không mở hay chạy nội dung |

```bash
curl -fsS -X POST "http://localhost:9080/v1/files?name=bien-ban.pdf" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/pdf' --data-binary @bien-ban.pdf
```

| Mã trả về | Khi nào |
|---|---|
| `201` / `200` | Tải lên / đọc thành công |
| `400` | Tên tệp không dùng được (rỗng sau khi bỏ phần thư mục, dài quá 255 ký tự) hoặc tệp rỗng |
| `401` | Thiếu hoặc sai token |
| `403` | Tài khoản không thuộc đúng một tenant, hoặc tenant chưa có trong `core.tenants` |
| `404` | Tệp không tồn tại hoặc thuộc tenant khác (không tiết lộ là tồn tại); nội dung tệp không còn trong kho |
| `413` | Tệp lớn quá giới hạn |
| `422` | Tệp chứa mã độc, hoặc vượt giới hạn quét nên không kiểm hết được (lý do nêu tên mẫu, tệp không được lưu); thiếu tham số `name`; `id` không phải UUID |
| `503` | Không kết nối được CSDL, SeaweedFS hay ClamAV; tệp chưa quét được thì không được nhận |

Trạng thái tệp: `clean` là đã quét trước khi lưu, không thấy mã độc; `unscanned` là tệp tải lên trước khi có bước
quét. Quét chỉ bắt mã độc đã có mẫu; giới hạn ở [ADR 0010](adr/0010-upload-malware-scan.md).

## Dữ liệu thiết bị: `/v1/context`

Hợp đồng đầy đủ: [`contracts/context-api.openapi.json`](../contracts/context-api.openapi.json). Lớp `context-api` đứng
trước Scorpio (broker NGSI-LD, [ADR 0012](adr/0012-device-context-ngsi-ld.md)): chỉ đọc, chỉ thấy thiết bị của tenant
trong token. Header `NGSILD-Tenant` người gọi gửi bị bỏ qua.

| Phương thức | Đường dẫn | Việc |
|---|---|---|
| `GET` | `/v1/context/entities` | Entity của tenant mình; tham số NGSI-LD `type`, `id`, `idPattern`, `attrs`, `q`, `limit` (1–1000), `offset` |
| `GET` | `/v1/context/entities/{id}` | Một entity theo mã, dạng `urn:ngsi-ld:<loại>:<mã>` |
| `GET` | `/v1/context/temporal/entities/{id}` | Lịch sử số đo của một entity theo API temporal của NGSI-LD; bắt buộc `attrs` (tên số đo) và `lastN` (1–1000 lần đo gần nhất) |

```bash
curl -fsS "http://localhost:9080/v1/context/entities?type=Device" -H "Authorization: Bearer $TOKEN"
```

Phản hồi là entity NGSI-LD dạng JSON rút gọn theo ngữ cảnh lõi, ví dụ
`{"id": "urn:ngsi-ld:Device:kho-01", "type": "Device", "humidity": {"type": "Property", "value": 78, "observedAt": "..."}}`.
Tenant chưa có thiết bị nào gửi số đo thì danh sách rỗng.

Lịch sử trả mỗi số đo thành danh sách lần đo (`value`, `observedAt`), mới nhất trước; chỉ có một lần đo thì là một
đối tượng. Scorpio đưa lần đo vào lịch sử sau khi đã ghi, nên lần đo vừa gửi có thể chưa có ngay (ADR 0018).

```bash
curl -fsS "http://localhost:9080/v1/context/temporal/entities/urn:ngsi-ld:Device:archive-01?attrs=humidity&lastN=20" \
  -H "Authorization: Bearer $TOKEN"
```

| Mã trả về | Khi nào |
|---|---|
| `200` | Đọc thành công |
| `400` | Tham số ngoài danh sách, lặp lại, dài quá 300 ký tự, `limit` ngoài khoảng, lịch sử thiếu `attrs` hay `lastN`, `offset` không phải số, mã entity sai dạng, hoặc truy vấn `q` Scorpio không nhận |
| `401` | Thiếu hoặc sai token |
| `403` | Tài khoản không thuộc đúng một tenant, hoặc mã tenant không đúng dạng slug |
| `404` | Entity không có trong tenant mình, hoặc số đo chưa có lần đo nào |
| `502` / `503` | Kho dữ liệu thiết bị báo lỗi (chi tiết chỉ ghi vào log) / không kết nối được |

### Thiết bị gửi số đo qua MQTT

Thiết bị không gọi `/v1/context`; nó gửi tin MQTT vào chủ đề `mortise/<tenant>/<thiết bị>` bằng tài khoản
`<tenant>.<thiết bị>` do `make device-add` cấp. Nội dung theo
[`contracts/device-message.schema.json`](../contracts/device-message.schema.json):

```json
{"observedAt": "2026-11-17T10:00:00Z", "measurements": {"temperature": 24.1, "humidity": 71}}
```

Mỗi số đo thành một thuộc tính của entity `urn:ngsi-ld:Device:<thiết bị>` trong tenant của chủ đề, đọc lại qua
`/v1/context`. Tin sai dạng hay gửi vào chủ đề của tenant khác bị bỏ, thiết bị không nhận lỗi.
