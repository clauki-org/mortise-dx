// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Đăng nhập OIDC với Keycloak bằng Authorization Code + PKCE (ADR 0006): giao diện không bao giờ nhận mật khẩu,
// người dùng nhập ở trang của Keycloak rồi quay về /callback với mã đổi lấy token.

import { UserManager } from "oidc-client-ts";

// Bản cài thật phục vụ giao diện và Keycloak cùng một địa chỉ qua cổng, nên mặc định lấy theo địa chỉ trang. Máy
// chủ phát triển (Vite) chạy ở địa chỉ khác nên đặt VITE_OIDC_AUTHORITY trong .env.development.
const authority = import.meta.env.VITE_OIDC_AUTHORITY ?? `${window.location.origin}/auth/realms/mortise`;

export const CALLBACK_PATH = "/callback";

/** Client OIDC của giao diện; vai trò riêng của client nằm ở `resource_access` của token dưới tên này. */
export const CLIENT_ID = "mortise-web";

export const userManager = new UserManager({
  authority,
  client_id: CLIENT_ID,
  redirect_uri: `${window.location.origin}${CALLBACK_PATH}`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  scope: "openid",
  // Không theo dõi phiên bằng iframe ẩn: cổng không mở đường đó (ADR 0007) và trình duyệt chặn cookie bên thứ ba
  // làm cách này hỏng. Token được làm mới bằng refresh token trước khi hết hạn.
  monitorSession: false,
  automaticSilentRenew: true,
});
