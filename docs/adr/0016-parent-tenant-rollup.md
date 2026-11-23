<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0016. Tenant cha đọc tổng hợp của tenant con qua view và vai trò rollup_reader

- Trạng thái: Chấp nhận
- Ngày: 2026-11-20

## Bối cảnh

Lãnh đạo tỉnh cần thấy số liệu của mọi xã trên một bảng, ví dụ diện tích được phép, thực tế và phần vượt, nhưng
không được đọc dữ liệu gốc của từng xã (phòng, tòa, hồ sơ). Lõi không được biết khái niệm tỉnh hay xã (AGENTS.md).

Hiện mỗi token mang đúng một tenant (`contracts/token-claims.schema.json`), và mọi quyền Hasura lọc theo một tenant
đó. Các cách đã xét:

- **Claim nhiều tenant.** Người của tỉnh mang cả bốn tenant trong token.
  - Mọi quyền phải đổi từ `_eq` sang `_in`. workflow-api, files-api và context-api phải chọn tenant cho từng yêu
    cầu.
  - Tệ nhất: người của tỉnh đọc được toàn bộ dữ liệu gốc của mọi xã, đúng điều cần tránh.
- **Dịch vụ tổng hợp dùng admin secret.** Một dịch vụ đọc mọi xã rồi trả bảng tổng hợp.
  - Dịch vụ đó giữ khóa vượt mọi quyền theo dòng, nên một lỗi của nó làm lộ mọi tenant.
  - Nhật ký thay đổi không còn biết ai đọc. Thêm một thành phần phải vận hành.
- **Quan hệ cha–con là dữ liệu, tổng hợp là view.** Token vẫn mang một tenant. Hasura cho tenant cha đọc các dòng
  của view tổng hợp có `parent_tenant_id` bằng tenant trong token.

## Quyết định

Chọn cách thứ ba.

- **Lõi thêm `core.tenants.parent_id`**, tự tham chiếu `core.tenants` (`ON DELETE RESTRICT`), không cho một tenant
  làm cha của chính nó.
  - Lõi chỉ biết "tenant có thể có cha", không biết cha là tỉnh hay tổng công ty.
- **`parent_id` là một cạnh phân quyền**, vì nó quyết định tenant nào đọc được tổng hợp của tenant nào.
  - Không vai trò Hasura nào ghi được cột này. Chỉ seed hoặc người vận hành sửa nó trong CSDL.
  - Vai trò `user` chỉ đọc `parent_id` của tenant mình.
- **Vai trò realm `rollup_reader`** có tên trung tính và không có quyền nào ở bảng của lõi.
  - Gói cấp cho vai trò này quyền select trên view tổng hợp của gói, với điều kiện
    `parent_tenant_id = X-Hasura-Tenant-Id`. Gói cơ sở vật chất xã có view `area_rollup`: lấy nguyên số của
    `area_summary` (được phép, đang dùng, dôi dư, phần vượt), nên tỉnh và xã luôn thấy cùng một con số.
  - View chỉ chứa số liệu đã gộp, mỗi tenant con một dòng. Bảng gốc không cấp quyền nào cho vai trò này.
- **Chỉ tính con trực tiếp.** Tenant cha không đọc được tổng hợp của "cháu"; cấp nhiều tầng cần một quyết định
  riêng.
- **Demo:** tenant `tinh-mau` là cha của `xa-a`, `xa-b`, `xa-c`. Tài khoản `leader.tinh` thuộc `tinh-mau`, có vai
  trò `user` và `rollup_reader`.

## Hệ quả

- **Token và các dịch vụ tự viết không đổi**, vì token vẫn mang đúng một tenant. Hợp đồng claim giữ nguyên cấu
  trúc, chỉ thêm mô tả vai trò `rollup_reader`.
- **Tỉnh chỉ thấy đúng những cột gói đưa vào view.** Gói thêm cột vào view là mở thêm dữ liệu cho tỉnh, nên phải
  review như đổi quyền.
- **Thêm một tenant là thêm một nhóm Keycloak cùng một dòng `core.tenants` có `parent_id`.** Seed tạo bù vai trò và
  nhóm còn thiếu cho bản cài dựng trước, không cần `make reset`.
- **Tenant cha cũng là một tenant bình thường**, có dữ liệu, quy trình và thiết bị riêng như mọi tenant khác.
- **Giao diện web chưa gửi `X-Hasura-Role`**, nên `leader.tinh` chưa thấy tổng hợp trên giao diện; hiện chỉ đọc
  được qua GraphQL.
- **Tenant cha hoàn thành bước được phân cấp của tenant con** theo [ADR 0029](0029-parent-completes-delegated-step.md),
  cùng quy tắc "chỉ con trực tiếp" và cùng cột `parent_id`.
