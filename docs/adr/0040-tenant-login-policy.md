<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0040. Chính sách đăng nhập theo tenant: gán vai trò `otp_required` cho group của tenant, không đổi luồng

- Trạng thái: Chấp nhận
- Ngày: 2026-11-25

## Bối cảnh

Mỗi đơn vị cần tự chọn mức đăng nhập cho người của mình, ví dụ tỉnh bắt mọi tài khoản của tỉnh nhập mã OTP trong khi
xã vẫn đăng nhập bằng mật khẩu. Trước bản ghi này, OTP chỉ hỏi người có vai trò `otp_required` của client `mortise-web`, gán cho
từng tài khoản hoặc qua vai trò gộp `manager` ([ADR 0011](0011-approver-mfa.md), bổ sung 2026-11-22).

Mỗi tenant là một group cấp cao nhất của realm `mortise`; claim `tenant` lấy từ group đó. Điều kiện
`conditional-user-role` của hai luồng `browser-mfa` và `direct-grant-mfa` kiểm vai trò bằng `UserModel.hasRole` của
Keycloak 26.7.5, tính cả vai trò người dùng nhận qua group.

Các lựa chọn đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Gán `otp_required` cho group của tenant | Không đổi luồng, không thêm mã vào Keycloak; dùng đúng điều kiện ADR 0011 đang dùng |
| Mỗi tenant một realm | Mất đăng nhập một lần giữa các tenant; mọi thành phần đang đọc một issuer và claim `tenant` phải đổi |
| Bộ xác thực tự viết (SPI) đọc chính sách theo tenant | Phải dựng image Keycloak riêng và giữ mã chạy trong tiến trình xác thực, trong khi điều kiện có sẵn đã đủ |

## Quyết định

- Chính sách đăng nhập của một tenant là có hay không vai trò client `mortise-web.otp_required` gán thẳng cho group của
  tenant. Hai chính sách:
  - `otp`: mọi tài khoản của tenant phải nhập mã OTP;
  - `default`: như trước, chỉ `manager` và tài khoản được gán `otp_required` riêng phải nhập OTP.
- Người vận hành đặt chính sách bằng `make tenant-login TENANT=<tenant> POLICY=otp|default` (`scripts/tenant-login.sh`,
  qua API quản trị Keycloak như `make seed`). Lệnh từ chối tenant không có group và chính sách lạ; chạy lại với cùng
  chính sách thì không đổi gì.
- Luồng đăng nhập, chính sách OTP của realm, cách workflow-api kiểm `amr` giữ nguyên như ADR 0011 và ADR 0028.
- Chính sách là trạng thái của Keycloak, không nằm trong tệp realm. Tenant demo `tinh-khac` có chính sách `otp`, do
  `make seed` đặt (kể cả trên realm đã dựng từ trước) cùng tài khoản `user.k`: vai trò `user`, không vai trò thêm, có
  khóa OTP demo như `manager.*`.
- Chính sách không truyền xuống tenant con: quan hệ cha con nằm ở `core.tenants`, còn group của các tenant ngang hàng,
  nên tỉnh bắt OTP thì xã của tỉnh vẫn theo chính sách của xã.
- `make smoke` kiểm: `user.k` thiếu mã bị `invalid_grant`; đổi tạm `tinh-khac` về `default` thì `user.k` lấy được token
  chỉ có `["pwd"]`; đặt lại `otp` rồi `user.k` có mã thì `amr` là `["otp","pwd"]`; `user.a` (xã A, không có chính
  sách) vẫn chỉ có `["pwd"]`.
- Ngoài phạm vi: Passkey (WebAuthn), làm sau với bản ghi riêng; quản trị tenant tự đổi chính sách của tenant mình (cần
  một API riêng kiểm vai trò `tenant_admin` và tenant, vì tài khoản đó không có quyền quản trị Keycloak), có thể là
  một issue sau.

## Hệ quả

- **Mọi người của tenant có chính sách `otp` đều có `otp` trong `amr`, nên qua được kiểm OTP của bước đọc bảng phân
  cấp thẩm quyền** ([ADR 0028](0028-step-authority-table.md)), không riêng người được gán `otp_required`. Chấp nhận
  được vì kiểm đó đòi người hoàn thành bước đã qua yếu tố thứ hai, và họ đã qua thật; ai thấy và hoàn thành được bước
  vẫn do vai trò trong `realm_access` quyết định, `otp_required` không mở thêm quyền nào. Người vận hành cần biết
  chiều ngược lại: đổi một tenant về `default` thì tài khoản chỉ dựa vào chính sách của tenant (không có
  `otp_required` riêng, không phải `manager`) mất OTP ở lần đăng nhập sau, và workflow-api từ chối họ hoàn thành bước
  đọc bảng. Muốn giữ thì gán `otp_required` riêng cho họ trước khi đổi.
- Chính sách áp từ lần đăng nhập sau: luồng đăng nhập chỉ hỏi OTP lúc đăng nhập, nên phiên đã mở trước đó không bị
  hỏi lại (chưa có bài kiểm tự động cho điều này); muốn áp ngay thì đăng xuất phiên của người trong tenant trên trang
  quản trị Keycloak.
- Bật `otp` cho tenant có người chưa cài OTP: trên trình duyệt Keycloak hiện trang cài OTP ngay lúc đăng nhập; qua
  luồng lấy token bằng mật khẩu (chỉ client kiểm thử) thì lỗi chung `unknown_error`, như ADR 0011.
- Token của mọi người trong tenant có `otp_required` ở `resource_access.mortise-web.roles`; không thành phần nào dùng
  nó để phân quyền.
- Đổi chính sách không ghi vào nhật ký thay đổi của lõi (ADR 0009); dấu vết chỉ có ở Keycloak. Chính sách đang đặt
  xem ở vai trò gán cho group trên trang quản trị Keycloak.
- Mỗi lần lấy token của `user.k` tốn một mã OTP như người duyệt, nên `make smoke` có thể chờ thêm tới khoảng 30 giây
  cho mã mới.
- Không chặn được người giữ quyền quản trị Keycloak: gỡ vai trò khỏi group là tắt chính sách.
