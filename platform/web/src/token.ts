// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Đọc claim trong access token để quyết định hiện hay ẩn một phần giao diện (mục menu, nút). Không kiểm chữ ký:
// quyền thật do cổng, Hasura và dịch vụ kiểm lại bằng chính token này.

/** Claim của access token; token thiếu hay không đọc được thì coi như không có claim nào. */
export function claimsOf(accessToken: string | undefined): Record<string, unknown> {
  const payload = accessToken?.split(".")[1];
  if (!payload) return {};
  try {
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return claims && typeof claims === "object" ? (claims as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Chỉ giữ các phần tử là chuỗi; giá trị không phải mảng thì coi như mảng rỗng. */
export const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
