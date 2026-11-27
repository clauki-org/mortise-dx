// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm nút thêm Passkey (passkey.ts): chỉ hiện khi token có vai trò client passkey_allowed của đúng client giao diện,
// và bấm nút thì chuyển sang Keycloak với kc_action đăng ký Passkey, nhớ trang để quay về.

import { describe, expect, it, vi } from "vitest";

const signinRedirect = vi.fn(() => Promise.resolve());
vi.mock("./auth", () => ({ CLIENT_ID: "mortise-web", userManager: { signinRedirect } }));

const { addPasskey, canAddPasskey } = await import("./passkey");

const base64url = (value: string) => btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const tokenWith = (claims: object) => `header.${base64url(JSON.stringify(claims))}.signature`;

describe("canAddPasskey", () => {
  it("hiện khi vai trò passkey_allowed nằm ở resource_access của client giao diện", () => {
    const token = tokenWith({ resource_access: { "mortise-web": { roles: ["otp_required", "passkey_allowed"] } } });
    expect(canAddPasskey(token)).toBe(true);
  });

  it("ẩn khi vai trò thiếu, nằm ở client khác hay ở realm_access", () => {
    expect(canAddPasskey(tokenWith({ resource_access: { "mortise-web": { roles: ["otp_required"] } } }))).toBe(false);
    expect(canAddPasskey(tokenWith({ resource_access: { other: { roles: ["passkey_allowed"] } } }))).toBe(false);
    expect(canAddPasskey(tokenWith({ realm_access: { roles: ["passkey_allowed"] } }))).toBe(false);
  });

  it("ẩn khi token thiếu hay hỏng", () => {
    expect(canAddPasskey(undefined)).toBe(false);
    expect(canAddPasskey("a.@@@.b")).toBe(false);
    expect(canAddPasskey(tokenWith({ resource_access: { "mortise-web": { roles: "passkey_allowed" } } }))).toBe(false);
  });
});

describe("addPasskey", () => {
  it("đăng nhập lại qua Keycloak với kc_action đăng ký Passkey và nhớ trang đang mở", async () => {
    await addPasskey("/tasks?x=1");
    expect(signinRedirect).toHaveBeenCalledWith({
      url_state: "/tasks?x=1",
      extraQueryParams: { kc_action: "webauthn-register-passwordless" },
    });
  });
});
