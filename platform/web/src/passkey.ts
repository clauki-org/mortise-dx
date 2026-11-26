// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thêm Passkey cho tài khoản đang đăng nhập (ADR 0042). Đơn vị bật Passkey thì token có vai trò client
// `passkey_allowed`; giao diện chỉ dùng vai trò đó để hiện nút. Nút chuyển sang trang đăng ký Passkey của Keycloak bằng
// tham số `kc_action` của lần đăng nhập OIDC, rồi quay về giao diện như một lần đăng nhập thường.

import { CLIENT_ID, userManager } from "./auth";
import { claimsOf, strings } from "./token";

export const PASSKEY_ROLE = "passkey_allowed";

// Thao tác đăng ký Passkey dùng được để đăng nhập không cần mật khẩu (required action của Keycloak).
export const REGISTER_ACTION = "webauthn-register-passwordless";

/** Token có vai trò client cho phép đăng nhập bằng Passkey. Ẩn nút chỉ là giao diện; Keycloak mới là nơi chặn. */
export function canAddPasskey(accessToken: string | undefined): boolean {
  const clients = claimsOf(accessToken).resource_access as Record<string, { roles?: unknown }> | undefined;
  return strings(clients?.[CLIENT_ID]?.roles).includes(PASSKEY_ROLE);
}

/**
 * Mở trang đăng ký Passkey của Keycloak bằng phiên Keycloak đang có; đăng ký xong hay bấm hủy thì quay về `back`
 * (đường dẫn trong cùng trang).
 */
export function addPasskey(back: string): Promise<void> {
  return userManager.signinRedirect({ url_state: back, extraQueryParams: { kc_action: REGISTER_ACTION } });
}
