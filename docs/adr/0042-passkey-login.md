<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0042. Đăng nhập bằng Passkey theo tenant: bước WebAuthn riêng ghi amr `hwk`, chặn bằng vai trò `passkey_allowed`

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27

## Bối cảnh

Đơn vị muốn cho người của mình đăng nhập bằng Passkey (vân tay, khuôn mặt trên điện thoại) thay mật khẩu, trong khi
đơn vị khác chưa sẵn sàng. Passkey chống được trang đăng nhập giả mà OTP không chống được (ADR 0011). Chính sách OTP
theo tenant đã là vai trò client gán cho group của tenant ([ADR 0040](0040-tenant-login-policy.md)).

Đọc mã nguồn Keycloak 26.7.5:

- Ô mật khẩu (`auth-username-password-form`) tự nhận Passkey khi bật `webAuthnPolicyPasswordlessPasskeysEnabled`.
  Giá trị `amr` lấy theo cấu hình của từng bước trong luồng (`default.reference.value`), nên Passkey qua ô đó được ghi
  `pwd` như mật khẩu.
- Bộ xác thực kiểm thông tin đăng nhập (mật khẩu, OTP, WebAuthn) ghi loại thông tin đã dùng vào phiên đăng nhập khi
  thành công; điều kiện `conditional-credential` đọc danh sách này (`webauthn-passwordless` là loại của Passkey).
- Không có điều kiện nào theo tổ chức hay group, nhưng `conditional-user-role` tính cả vai trò nhận qua group.
- Các điều kiện trong một luồng con CONDITIONAL được AND với nhau.

| Lựa chọn | Đánh giá |
|---|---|
| Bước WebAuthn không cần tên đăng nhập, ngang hàng ô mật khẩu; chặn bằng vai trò gán cho group của tenant | Có sẵn trong Keycloak, cùng cách với ADR 0040; `amr` phân biệt được Passkey với mật khẩu |
| Bật Passkey trong ô mật khẩu | Ít bấm hơn, nhưng `amr` ghi `pwd`, không ai biết người dùng đã dùng Passkey |
| Bộ xác thực tự viết (SPI) đọc chính sách theo tenant | Phải dựng image Keycloak riêng, trong khi điều kiện có sẵn đã đủ |

## Quyết định

- Luồng `browser-mfa forms` (`core/keycloak/realm-mortise.json`) có ba bước theo thứ tự:
  1. `browser-mfa first factor` (REQUIRED): ô mật khẩu (amr `pwd`) hay `webauthn-authenticator-passwordless` (amr
     `hwk`, giữ 36000 giây như ADR 0011), hai lựa chọn ALTERNATIVE. Trang đăng nhập mở ô mật khẩu; Passkey chọn qua
     "Try Another Way", không cần gõ tên.
  2. `browser-mfa passkey policy` (CONDITIONAL): đã dùng Passkey (`conditional-credential`) và không có vai trò client
     `mortise-web.passkey_allowed` (`conditional-user-role`, negate) thì từ chối (`deny-access-authenticator`) với lời
     báo tiếng Việt.
  3. `browser-mfa approver otp` giữ nguyên như ADR 0011: ai có `otp_required` vẫn nhập OTP sau Passkey. Passkey thay
     mật khẩu, không thay OTP, nên workflow-api và bảng phân cấp (ADR 0028) không phải đổi.
- Chính sách Passkey của realm: `webAuthnPolicyPasswordlessPasskeysEnabled` tắt (để ô mật khẩu không nhận Passkey),
  khóa lưu trên thiết bị (`residentKey: required`) để đăng nhập không cần tên, bắt xác minh người dùng
  (`userVerificationRequirement: required`).
- Người vận hành bật hay tắt bằng `make tenant-login TENANT=<tenant> POLICY=passkey|no-passkey`, gán hay gỡ
  `passkey_allowed` trên group của tenant. Cặp này độc lập với `otp|default` (ADR 0040): mỗi cặp chỉ đổi vai trò của
  mình, tenant bật cả hai thì đăng nhập bằng Passkey rồi nhập OTP.
- Giao diện hiện nút "Thêm Passkey" khi access token có `passkey_allowed` trong `resource_access.mortise-web`; nút mở
  thao tác `kc_action=webauthn-register-passwordless` qua đăng nhập OIDC, nên đi trên các đường cổng đã mở (ADR 0007),
  không phải mở trang tài khoản của Keycloak.
- `make seed` tạo vai trò, đặt chính sách realm và dựng bù hai luồng con trên realm đã dựng trước
  (`scripts/passkey-flow.sh`); tenant demo `xa-c` (`user.c`, `manager.c`) có chính sách `passkey`.
- Kiểm: `make e2e` (`platform/web/e2e/passkey.spec.ts`, thiết bị giả của Chromium qua CDP) đăng ký rồi đăng nhập bằng
  Passkey (`user.c`: amr `["hwk"]`; `manager.c`: bị hỏi OTP, amr có `hwk` và `otp`), và người của `xa-b` tự dựng địa
  chỉ đăng ký vẫn bị từ chối khi đăng nhập. `make smoke` không làm được WebAuthn, chỉ kiểm cấu hình realm qua API
  quản trị: thứ tự các bước, amr `hwk`, chính sách realm, tenant nào có `passkey_allowed`.

## Hệ quả

- Ai cũng đăng ký được Passkey bằng cách tự dựng địa chỉ có `kc_action`, vì Keycloak không chặn thao tác đăng ký
  theo vai trò; chặn nằm ở bước đăng nhập. `no-passkey` không xóa Passkey đã đăng ký, chỉ từ chối đăng nhập bằng nó từ
  lần đăng nhập sau; phiên đang mở không bị cắt.
- Người dùng không tự xem hay xóa Passkey của mình: trang tài khoản của Keycloak bị chặn ở cổng (ADR 0007). Mất điện
  thoại thì quản trị viên xóa Passkey trên trang quản trị Keycloak, như với OTP.
- Passkey cần ngữ cảnh an toàn của trình duyệt: chạy được trên `localhost` hay HTTPS, không chạy trên máy chủ demo
  phục vụ HTTP thường. Passkey gắn với tên miền: đổi `MORTISE_PUBLIC_URL` sang tên miền khác thì phải đăng ký lại.
- `hwk` là giá trị của RFC 8176 cho khóa giữ trong phần cứng; Passkey đồng bộ qua tài khoản đám mây không hẳn như vậy.
  Dự án dùng `hwk` để chỉ "đã qua bước WebAuthn", không dùng nó để phân quyền.
- Gate mở khi vai trò `passkey_allowed` không còn trong realm: `conditional-user-role` coi vai trò không tìm thấy là
  điều kiện không khớp (trước cả negate), nên luồng con bị bỏ qua và Passkey của mọi tenant được nhận. Không xóa vai
  trò này; `make seed` tạo lại nếu thiếu, `make smoke` kiểm cấu hình.
- Luồng lấy token bằng mật khẩu (`direct-grant-mfa`) không có Passkey; client kiểm thử giữ nguyên.
- Trang đăng nhập có thêm nút "Try Another Way" cho mọi người, kể cả tenant chưa bật Passkey; chọn Passkey ở tenant đó
  chỉ nhận lời từ chối. Trang đăng nhập và trang đăng ký Passkey hiện bằng tiếng Anh (giao diện mặc định của
  Keycloak), trừ lời từ chối.
- Bản cài dựng trước bản ghi này giữ lại bước mật khẩu cũ ở `browser-mfa forms` dạng DISABLED: xóa bước đó thì
  Keycloak xóa luôn cấu hình `amr-pwd` dùng chung với luồng lấy token bằng mật khẩu.
- Mỗi lượt `make e2e` thêm một Passkey cho `user.c`, `manager.c`, `user.b` (thiết bị giả mất khi bài kết thúc); chúng
  không ảnh hưởng đăng nhập bằng mật khẩu.
- Ngoài phạm vi: quản trị tenant tự bật Passkey cho tenant mình (như ADR 0040); trang để người dùng quản lý Passkey.
