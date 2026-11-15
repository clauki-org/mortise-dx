// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Trạng thái đăng nhập cho React: xử lý lần quay về từ Keycloak (/callback), đọc phiên đang có và theo dõi khi token
// được làm mới hoặc phiên kết thúc.

import type { User } from "oidc-client-ts";
import { useEffect, useState } from "react";
import { CALLBACK_PATH, userManager } from "./auth";

export type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: User }
  | { status: "error"; message: string };

// Mã đăng nhập chỉ đổi được một lần. React (StrictMode khi phát triển) có thể chạy hiệu ứng hai lần, nên lần xử lý
// /callback được giữ lại và dùng chung; nếu không, lần đổi mã thứ hai bị Keycloak từ chối.
let pending: Promise<User | null> | undefined;

async function readUser(): Promise<User | null> {
  if (window.location.pathname === CALLBACK_PATH) {
    const user = await userManager.signinRedirectCallback();
    // Bỏ mã và state khỏi thanh địa chỉ để tải lại trang không xử lý lại mã đã dùng, và quay về trang đang mở trước
    // khi đăng nhập. Chỉ nhận đường dẫn trong cùng trang ("/..." nhưng không "//...", vốn trỏ sang máy chủ khác).
    const back = user.url_state;
    window.history.replaceState({}, "", back?.startsWith("/") && !back.startsWith("//") ? back : "/");
    return user;
  }
  const user = await userManager.getUser();
  if (!user) return null;
  if (!user.expired) return user;
  // Access token sống ngắn (15 phút); mở lại tab sau đó thì đổi refresh token lấy token mới thay vì bắt đăng nhập
  // lại. Refresh token cũng hết hạn thì coi như chưa đăng nhập.
  if (!user.refresh_token) return null;
  return userManager.signinSilent().catch(() => null);
}

function loadUser(): Promise<User | null> {
  pending ??= readUser();
  return pending;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const signedIn = (user: User) => setState({ status: "signed-in", user });
    const signedOut = () => setState({ status: "signed-out" });
    loadUser()
      .then((user) => (user ? signedIn(user) : signedOut()))
      .catch((error: unknown) =>
        setState({ status: "error", message: error instanceof Error ? error.message : String(error) }),
      );
    userManager.events.addUserLoaded(signedIn);
    userManager.events.addUserUnloaded(signedOut);
    userManager.events.addAccessTokenExpired(signedOut);
    return () => {
      userManager.events.removeUserLoaded(signedIn);
      userManager.events.removeUserUnloaded(signedOut);
      userManager.events.removeAccessTokenExpired(signedOut);
    };
  }, []);

  return state;
}
