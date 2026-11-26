// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Menu do các gói đã cài khai (mục `menu` trong app.yaml, bộ cài gói nạp vào bảng platform.menu_items): câu truy
// vấn, cách lọc theo vai trò trong token và địa chỉ của từng mục. Phần hiển thị ở Shell.tsx và PackagePage.tsx.
// Không có React ở đây để kiểm thử được bằng hàm thuần, và không có tên gói hay chữ của một lĩnh vực nào.

import { claimsOf, strings } from "./token";

/** Một mục menu của gói. `config` là nội dung tệp cấu hình của thành phần, đã được `make check-fast` kiểm. */
export type MenuItem = {
  app: string;
  item: string;
  label: string;
  component: string;
  config: unknown;
  roles: string[] | null;
};

export type MenuData = { platform_menu_items: MenuItem[] };

// Gom theo gói, trong mỗi gói theo thứ tự gói khai; Hasura chỉ trả mục của tenant trong token.
export const MENU_QUERY =
  "query { platform_menu_items(order_by: [{ app: asc }, { position: asc }]) { app item label component config roles } }";

/** Vai trò realm trong access token; token không đọc được thì coi như không có vai trò nào. */
export function rolesOf(accessToken: string | undefined): string[] {
  const access = claimsOf(accessToken).realm_access as { roles?: unknown } | undefined;
  return strings(access?.roles);
}

/**
 * Mục người dùng thấy: mục không khai vai trò (null hay rỗng) là của mọi người, mục có khai thì cần ít nhất một vai
 * trò trùng. Đây chỉ là chuyện hiện hay ẩn trên menu; dữ liệu sau mục vẫn do quyền Hasura bảo vệ.
 */
export function visibleItems(items: MenuItem[], roles: string[]): MenuItem[] {
  return items.filter((entry) => !entry.roles?.length || entry.roles.some((role) => roles.includes(role)));
}

/** Địa chỉ trang của một mục: /apps/<gói>/<mục>. Thành phần tự đọc phần đường dẫn bên dưới địa chỉ này. */
export const itemPath = (entry: Pick<MenuItem, "app" | "item">) =>
  `/apps/${encodeURIComponent(entry.app)}/${encodeURIComponent(entry.item)}`;

export const findItem = (items: MenuItem[], app: string, item: string) =>
  items.find((entry) => entry.app === app && entry.item === item);
