// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Đăng nhập bằng Passkey (ADR 0042) trên trình duyệt thật: Chromium giả một thiết bị xác thực qua CDP (WebAuthn), nên
// đăng ký và đăng nhập bằng Passkey chạy trọn trong một lượt mà không cần vân tay thật. Tenant demo xa-c bật Passkey
// (`make seed`), xa-b thì không. Mỗi lượt chạy thêm một Passkey mới cho user.c, manager.c và user.b vì thiết bị giả
// mất khi bài kết thúc; Passkey cũ không dùng được nữa và không ảnh hưởng đăng nhập bằng mật khẩu.

import { type CDPSession, expect, type Page, test } from "@playwright/test";
import { otp, signIn } from "./support.ts";

/** Thiết bị xác thực giả gắn với trang: lưu khóa trên thiết bị và luôn xác minh được người dùng, như vân tay. */
async function virtualAuthenticator(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return cdp;
}

/** Trang đăng ký Passkey của Keycloak: bấm đăng ký, nhận tên gợi ý cho Passkey ở hộp hỏi tên. */
// Keycloak hỏi tên thiết bị và từ chối tên trùng với Passkey đã có; chạy lại bài trên cùng bản cài thì tên mặc định đã
// có từ lần trước, nên mỗi lần đăng ký đặt một tên riêng.
async function registerPasskey(page: Page) {
  page.once("dialog", (dialog) => dialog.accept(`e2e-${Date.now()}`));
  await page.locator("#registerWebAuthn").click();
}

/** Bỏ phiên của giao diện và của Keycloak, giữ thiết bị giả; nếu còn cookie thì Keycloak cho vào mà không hỏi gì. */
async function forgetSession(page: Page) {
  await page.context().clearCookies();
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.goto("/");
}

/** Trên trang đăng nhập, chọn cách khác là Passkey, rồi để thiết bị giả trả lời. */
async function signInWithPasskey(page: Page) {
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.locator("#try-another-way").click();
  await page.getByRole("heading", { name: "Passkey", exact: true }).click();
  await page.locator("#authenticateWebAuthnButton").click();
}

/** amr trong access token giao diện đang giữ (oidc-client-ts lưu người dùng trong sessionStorage). */
async function amrOf(page: Page): Promise<string[]> {
  const token = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((name) => name.startsWith("oidc.user:"));
    return key ? (JSON.parse(sessionStorage.getItem(key) ?? "{}").access_token as string | undefined) : undefined;
  });
  expect(token, "giao diện giữ access token sau khi đăng nhập").toBeTruthy();
  const payload = (token ?? "").split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).amr ?? [];
}

const signedIn = (page: Page) => expect(page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();

test("tenant bật Passkey: người dùng thêm Passkey trên web rồi đăng nhập bằng nó, amr ghi hwk", async ({ page }) => {
  await virtualAuthenticator(page);
  await page.goto("/");
  await signIn(page, "user.c");
  await page.getByRole("button", { name: "Thêm Passkey" }).click();
  await registerPasskey(page);
  await signedIn(page);

  await forgetSession(page);
  await signInWithPasskey(page);
  await signedIn(page);
  expect(await amrOf(page)).toEqual(["hwk"]);
});

test("người có otp_required đăng nhập bằng Passkey vẫn phải nhập OTP", async ({ page }) => {
  await virtualAuthenticator(page);
  await page.goto("/");
  await signIn(page, "manager.c");
  await page.getByRole("button", { name: "Thêm Passkey" }).click();
  await registerPasskey(page);
  await signedIn(page);

  await forgetSession(page);
  await signInWithPasskey(page);
  await expect(page.locator("#otp"), "Passkey không thay bước OTP (ADR 0011, ADR 0042)").toBeVisible();
  await page.locator("#otp").fill(otp("manager.c"));
  await page.locator("#kc-login").click();
  await signedIn(page);
  expect((await amrOf(page)).sort()).toEqual(["hwk", "otp"]);
});

test("tenant chưa bật Passkey: không có nút thêm, Passkey tự đăng ký vẫn bị từ chối khi đăng nhập", async ({
  page,
}) => {
  await virtualAuthenticator(page);
  await page.goto("/");
  await signIn(page, "user.b");
  await signedIn(page);
  await expect(page.getByRole("button", { name: "Thêm Passkey" })).toHaveCount(0);

  // Người dùng tự dựng địa chỉ đăng ký: Keycloak không chặn đăng ký theo vai trò, nên chặn phải nằm ở bước đăng nhập.
  // Client giao diện bắt buộc PKCE nên địa chỉ phải có code_challenge; mã trả về không được đổi lấy token.
  const origin = new URL(page.url()).origin;
  const register = new URL(`${origin}/auth/realms/mortise/protocol/openid-connect/auth`);
  register.search = new URLSearchParams({
    client_id: "mortise-web",
    response_type: "code",
    scope: "openid",
    redirect_uri: `${origin}/`,
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
    kc_action: "webauthn-register-passwordless",
  }).toString();
  await page.goto(register.toString());
  await registerPasskey(page);
  await signedIn(page);

  await forgetSession(page);
  await signInWithPasskey(page);
  await expect(page.getByText(/chưa cho đăng nhập bằng Passkey/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toHaveCount(0);
});
