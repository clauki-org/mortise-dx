// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phiên đăng nhập cho các màn hình: người dùng và hàm lấy access token mới nhất. Token được làm mới vài phút một lần;
// màn hình gọi getToken() lúc gửi yêu cầu thay vì giữ token cũ, nên không phải tạo lại client hay xóa dữ liệu đã tải.

import type { User } from "oidc-client-ts";
import { createContext, useContext } from "react";

export type Session = { user: User; getToken: () => string | undefined };

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession chỉ dùng được bên trong SessionContext");
  return session;
}
