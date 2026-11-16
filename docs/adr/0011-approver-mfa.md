<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0011. Người duyệt đăng nhập hai bước bằng OTP; workflow-api kiểm lại bằng claim `amr`

- Trạng thái: Chấp nhận
- Ngày: 2026-11-16

## Bối cảnh

Người có vai trò `manager` duyệt hồ sơ thay mặt cơ quan. Lộ mật khẩu của họ là lộ quyền duyệt. Cần yếu tố thứ hai
cho nhóm này, trong khi người dùng thường vẫn đăng nhập bằng mật khẩu để không thêm việc cho số đông.

Các lựa chọn đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| OTP theo thời gian (TOTP) trong Keycloak | Có sẵn, chạy với mọi ứng dụng OTP phổ biến, không cần mạng hay dịch vụ ngoài |
| Passkey / WebAuthn | Chống lừa đảo tốt hơn nhưng cần thiết bị hỗ trợ và tên miền HTTPS; để sau v1.0 |
| OTP qua SMS hay email | Cần cổng gửi tin bên ngoài; SMS dễ bị chiếm số |
| Chỉ kiểm ở Keycloak | Luồng đăng nhập cấu hình sai là người duyệt chỉ có mật khẩu vẫn duyệt được, không ai biết |

## Quyết định

- Realm (`core/keycloak/realm-mortise.json`) dùng hai luồng riêng thay cho luồng mặc định:
  - `browser-mfa`: mật khẩu, rồi mã OTP nếu người dùng có vai trò `manager` (điều kiện `conditional-user-role`).
    Người duyệt chưa cài OTP thì Keycloak hiện trang cài (mã QR) ngay lúc đăng nhập, không duyệt được trước khi cài.
  - `direct-grant-mfa`: luồng lấy token bằng mật khẩu, chỉ client kiểm thử `mortise-test` bật; người duyệt phải gửi
    kèm tham số `totp`, để không có đường vòng qua bước OTP.
  - Chính sách OTP ghim: TOTP, SHA1, 6 số, 30 giây, nhận mã của khung trước và sau (`otpPolicyLookAheadWindow` 1),
    không nhận lại mã đã dùng.
- Token ghi cách đăng nhập trong claim `amr` (bộ ánh xạ AMR của Keycloak trên client `mortise-web`): bước mật khẩu
  ghi `pwd`, bước OTP ghi `otp`. Mỗi bước giữ giá trị trong 36000 giây (`default.reference.maxAge`), bằng thời hạn
  tối đa của phiên (`ssoSessionMaxLifespan`). Để mặc định (0) thì Keycloak bỏ bước nào xảy ra trước giây hiện tại,
  nên token cấp sau khi chuyển hướng hay khi làm mới mất `otp` (đọc mã nguồn `AmrUtils.isAmrValid` và đã thấy khi thử).
- workflow-api từ chối hoàn thành task (403) khi người gọi có vai trò `manager` mà `amr` không có `otp`; task của
  tenant khác vẫn trả 404 trước, để không lộ task tồn tại. Đây là lớp kiểm thứ hai: Keycloak đúng thì không cấp
  được token như vậy.
- Tài khoản demo: `make env` sinh `DEMO_OTP_SECRET`, `make seed` gắn khóa này cho `manager.a`, `manager.b` qua API
  quản trị. `make otp` in mã hiện tại và khóa để nhập vào ứng dụng OTP. Smoke và e2e lấy mã bằng `scripts/otp.py`,
  lệnh này nhớ mã đã dùng của từng tài khoản và chờ sang khung 30 giây mới khi hết mã còn hiệu lực.

Đã thử ngày 2026-11-16 trên Keycloak 26.7.5: người duyệt chỉ có mật khẩu bị từ chối (`invalid_grant`); có mã thì
token có `amr` `["pwd","otp"]`, giữ nguyên sau khi làm mới token; mã dùng lại bị từ chối; người dùng thường có
`["pwd"]`; người duyệt mới chưa cài OTP đăng nhập trên trình duyệt thì gặp trang cài OTP.

## Hệ quả

- **Chặn được**: người có mật khẩu của người duyệt nhưng không có khóa OTP không lấy được token, nên không duyệt và
  không đọc được gì bằng tài khoản đó.
- **Không chặn được**:
  - người có cả mật khẩu và điện thoại (hay khóa OTP) của người duyệt;
  - trang đăng nhập giả lấy được cả mật khẩu và mã rồi dùng ngay trong 30 giây (OTP không chống được lừa đảo kiểu
    này; Passkey thì chống được);
  - người giữ quyền quản trị Keycloak: gỡ OTP, đổi luồng, gán vai trò.
- Token cấp trong một phiên vẫn ghi `otp` tới 36000 giây sau lúc nhập mã, kể cả khi khóa OTP của người đó bị gỡ giữa
  chừng; muốn cắt ngay thì đăng xuất phiên của họ trên trang quản trị Keycloak.
- Khóa OTP của tài khoản demo nằm trong `.env`, ai đọc được `.env` thì tính được mã; chỉ dùng cho demo. Bản sao lưu
  có `.env` nên cũng có khóa này.
- Chưa có mã dự phòng khi mất điện thoại: quản trị viên phải xóa OTP của người đó trên trang quản trị Keycloak để họ
  cài lại.
- Mỗi lần lấy token của người duyệt tốn một mã; mỗi khung 30 giây có ba mã Keycloak còn nhận. e2e giữ token của từng
  tài khoản cho cả lượt chạy; vẫn có lúc phải chờ mã mới, nên `make e2e` chậm thêm tới khoảng 30 giây.
- Keycloak khóa tạm tài khoản khi hai lần đăng nhập sai cách nhau dưới một giây (chống dò mật khẩu mặc định); nhập
  sai mã OTP cũng tính. Smoke chỉ thử sai một lần mỗi tài khoản.
- Người duyệt chưa cài OTP gọi luồng lấy token bằng mật khẩu thì Keycloak trả lỗi chung `unknown_error` thay vì lý
  do rõ; chỉ client kiểm thử dùng luồng này.
- Trang đăng nhập và trang cài OTP hiện bằng tiếng Anh (giao diện mặc định của Keycloak).
- Realm chỉ nạp khi Keycloak khởi động lần đầu: bản cài đã dựng cần `make reset` để có luồng mới.
- Ngoài phạm vi: chính sách đăng nhập riêng theo tenant; Passkey; mã dự phòng.
