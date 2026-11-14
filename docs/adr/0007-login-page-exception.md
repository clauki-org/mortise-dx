<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0007. Trang đăng nhập là bề mặt giao diện duy nhất của lõi

- Trạng thái: Chấp nhận
- Ngày: 2026-11-15

## Bối cảnh

Kiến trúc DX-OS đòi hỏi lõi Tầng 1 chạy ngầm, không cung cấp giao diện cho người dùng cuối
([ADR 0003](0003-three-tier-layout.md)). Định danh của lõi là Keycloak ([ADR 0002](0002-core-components.md)), và
Keycloak tự hiển thị trang đăng nhập: khi người dùng bấm đăng nhập ở giao diện Tầng 2, trình duyệt được chuyển tới
trang do Keycloak phục vụ, nhập mật khẩu (và mã OTP khi bật xác thực nhiều yếu tố) ở đó, rồi quay về ứng dụng với một
mã đổi lấy token ([ADR 0006](0006-frontend-stack.md)).

Hai yêu cầu kéo về hai phía:

- Lõi không giao diện gợi ý ô nhập mật khẩu nên nằm trong giao diện Tầng 2.
- RFC 9700 (thực hành bảo mật tốt nhất cho OAuth 2.0) yêu cầu không dùng password grant, tức ứng dụng không được nhận
  mật khẩu để tự đổi lấy token. Mật khẩu chỉ nên được nhập ở máy chủ định danh; nhờ đó mọi ứng dụng dùng chung một lần
  đăng nhập, và bước nhập mã OTP do máy chủ định danh điều khiển.

Ngoài ra, khi kiểm qua cổng ngày 2026-11-15, route `/auth/*` của APISIX chuyển mọi đường vào Keycloak: trang tài khoản
(`/auth/realms/mortise/account/`), realm quản trị `master` (chưa bật chống dò mật khẩu) và các endpoint không dùng
tới như đăng ký client động đều trả 200 từ bên ngoài. Bề mặt giao diện và bề mặt tấn công của lõi rộng hơn mức cần.

Các lựa chọn đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Ô mật khẩu trong giao diện Tầng 2, gửi bằng password grant | Lõi không còn trang nào, nhưng trái RFC 9700: mật khẩu đi qua mã ứng dụng, không đặt được bước OTP, mỗi ứng dụng tự giữ mật khẩu |
| Định danh không giao diện (Ory Kratos cho tài khoản, Ory Hydra cho OIDC; đều Apache-2.0) | Giao diện đăng nhập thuộc hẳn Tầng 2 mà không dùng password grant: Kratos chỉ cung cấp API theo từng bước đăng nhập. Nhưng phải thay Keycloak: làm lại vai trò, nhóm và claim `tenant`, cấu hình JWT của Hasura và workflow-api, xác thực nhiều yếu tố; thêm hai dịch vụ phải vận hành |
| Giữ trang đăng nhập của Keycloak, thu hẹp những gì lộ qua cổng, giao diện trang do Tầng 2 thiết kế | Giữ đúng RFC 9700 và cơ chế đã chạy; lõi có một bề mặt giao diện, giới hạn trong các bước của giao thức đăng nhập |

## Quyết định

Giữ trang đăng nhập của Keycloak, coi đó là ngoại lệ có chủ đích và duy nhất của yêu cầu lõi không giao diện:

- Bề mặt giao diện của lõi chỉ gồm các bước của giao thức đăng nhập: trang đăng nhập, nhập mã OTP, các bước bắt buộc
  khi đăng nhập (đổi mật khẩu tạm, cài OTP), xác nhận đăng xuất. Không có màn hình nghiệp vụ nào.
- Cổng chỉ mở các đường OIDC của realm `mortise` mà ứng dụng và trình duyệt cần: cấu hình (`.well-known`), `auth`,
  `token`, `logout`, `certs`, `userinfo`, `revoke`, các bước của form đăng nhập (`login-actions`) và tài nguyên tĩnh
  của trang đăng nhập. Mọi đường khác dưới `/auth`, gồm console quản trị, realm `master`, trang tài khoản,
  introspection, đăng ký client động, device, CIBA, PAR và iframe kiểm phiên, trả 403.
- Giao diện của trang đăng nhập (logo, màu, câu chữ) là theme do Tầng 2 thiết kế theo thương hiệu bản cài; Keycloak
  chỉ nạp và hiển thị. Vị trí theme trong bố cục quyết định khi làm.
- `make smoke` kiểm cả hai phía: các đường bị chặn trả 403, và một lần đăng nhập Authorization Code + PKCE đi trọn qua
  cổng (trang đăng nhập, gửi form, đổi mã lấy token, gọi API).

## Hệ quả

- Người dùng thấy đúng một trang thuộc lõi, cùng địa chỉ với ứng dụng vì đi qua cổng; người vận hành quản trị
  Keycloak bằng cổng chỉ mở trong máy chủ như trước.
- Tài liệu cấu hình OIDC của realm vẫn liệt kê các endpoint bị chặn (đăng ký client động, device, CIBA, PAR, iframe
  kiểm phiên); client gọi chúng nhận 403. Giao diện Tầng 2 tắt theo dõi phiên bằng iframe của oidc-client-ts
  (`monitorSession: false`), khớp với việc không dùng iframe ẩn ở ADR 0006.
- Bật thêm tính năng của Keycloak cần đường mới (đăng nhập bằng nhà cung cấp định danh ngoài cần `/broker/*`, trang tự
  quản lý tài khoản cần `/account`) thì phải mở thêm ở cổng trong cùng pull request và ghi lý do. Nâng cấp Keycloak
  có thể đổi đường của trang đăng nhập; bài đăng nhập PKCE trong smoke sẽ đỏ khi đó.
- Lộ trình nếu yêu cầu lõi không giao diện cần được hiểu tuyệt đối: chuyển sang định danh không giao diện (lựa chọn
  thứ hai ở trên). Phần còn lại của nền tảng chỉ dựa vào token OIDC và các claim `sub`, `tenant`,
  `realm_access.roles`, nên việc chuyển giới hạn trong lớp định danh, cấu hình JWT của Hasura và workflow-api, và
  giao diện đăng nhập ở Tầng 2.
