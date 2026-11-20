<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0017. Tài khoản dịch vụ mở quy trình thay cho một tenant

- Trạng thái: Chấp nhận
- Ngày: 2026-11-20

## Bối cảnh

Khi số đo của thiết bị vượt ngưỡng, lõi phải tự mở hồ sơ kiểm tra trên bảng việc của đúng đơn vị (#89). Không có
người nào bấm gửi, nên không có token người dùng mang claim `tenant`. workflow-api ([ADR 0004](0004-workflow-access-control.md))
lại lấy tenant duy nhất từ claim đó và từ chối token không thuộc đúng một tenant.

Các lựa chọn đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Dịch vụ gọi thẳng Flowable bằng tài khoản kỹ thuật | Đi vòng qua workflow-api: biến `initiator`, `tenant` và chống trùng nằm rải ở hai nơi |
| Mỗi tenant một tài khoản dịch vụ, gắn group như người dùng | Thêm tenant là phải thêm tài khoản và secret; dịch vụ giữ nhiều secret |
| Một tài khoản dịch vụ, tenant ghi ở header của từng yêu cầu | Một secret; workflow-api giữ mọi kiểm tra; phải giới hạn chặt những gì tài khoản này làm được |

## Quyết định

- Mỗi dịch vụ có một client Keycloak riêng chỉ bật client credentials, secret trong `.env`, tạo bằng `make seed`.
  Hiện có `mortise-iot-bridge`. Tài khoản dịch vụ của client không có vai trò nào của realm, kể cả `user`.
- workflow-api nhận diện tài khoản dịch vụ bằng claim `azp` (client đã xin token) nằm trong danh sách
  `WORKFLOW_SERVICE_CLIENTS`. Không dùng vai trò: mọi vai trò của realm cũng là vai trò chọn được ở Hasura, và người
  quản trị có thể lỡ gán cho người dùng; còn token mang `azp` của client chỉ có client credentials thì người dùng
  không lấy được.
- Tài khoản dịch vụ gửi tenant ở header `X-Mortise-Tenant`. Người dùng gửi header đó bị trả 400, không lặng lẽ bỏ qua.
- Tài khoản dịch vụ chỉ được khởi tạo quy trình. Xem task, hoàn thành task, xem trạng thái quy trình đều trả 403.
- Với tài khoản dịch vụ, `Idempotency-Key` chỉ khớp quy trình còn mở mà chính tài khoản đó khởi tạo. Dịch vụ dùng
  một mã cố định cho một sự việc (một luật trên một thiết bị): còn hồ sơ mở thì không mở thêm, hồ sơ đã đóng thì lần
  sau mở hồ sơ mới. Người dùng không chặn được việc mở hồ sơ bằng cách tự tạo quy trình mang cùng mã, vì `initiator`
  luôn là `sub` của token.
- Hợp đồng claim của token dịch vụ: `contracts/service-token-claims.schema.json`; `make smoke` kiểm một token thật.

## Hệ quả

- Ai giữ secret của client dịch vụ mở được quy trình ở mọi tenant. Secret chỉ nằm trong `.env` và trong biến môi
  trường của dịch vụ dùng nó.
- Quy trình do dịch vụ mở có `initiator` là `sub` của tài khoản dịch vụ; quy tắc bốn mắt không chặn người duyệt nào.
- Token dịch vụ không có claim `tenant`, nên Hasura, files-api và context-api từ chối nó như token không thuộc tenant
  nào. Cho dịch vụ đọc qua các API đó cần một quyết định riêng.
