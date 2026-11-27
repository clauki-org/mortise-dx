// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Menu do các gói đã cài khai (mục `menu` trong app.yaml, bộ cài gói nạp vào bảng platform.menu_items): câu truy
// vấn, cách lọc theo vai trò trong token, địa chỉ của từng mục và cách gom mục thành nhóm (ADR 0044). Phần hiển thị
// ở Shell.tsx, MenuNav.tsx và PackagePage.tsx. Không có React ở đây để kiểm thử được bằng hàm thuần, và không có tên
// gói hay chữ của một lĩnh vực nào: tên nhóm là tên gói đọc từ bảng.

import { claimsOf, strings } from "./token";

/** Một mục menu của gói. `config` là nội dung tệp cấu hình của thành phần, đã được `make check-fast` kiểm. */
export type MenuItem = {
  app: string;
  /** Tên hiển thị của gói (`name` trong app.yaml); null với dòng nạp trước khi bảng có cột này. */
  app_name: string | null;
  item: string;
  label: string;
  component: string;
  config: unknown;
  roles: string[] | null;
  icon: string | null;
  /** Quản trị org ẩn mục khỏi menu và trang chủ (ADR 0060); đường dẫn của mục vẫn mở được, dữ liệu vẫn theo quyền. */
  hidden?: boolean;
  /** false với khối chỉ đặt trên trang (mục `blocks` trong app.yaml, ADR 0061): mở được theo địa chỉ, không lên menu. */
  on_menu: boolean;
};

export type MenuData = { platform_menu_items: MenuItem[] };

// Gom theo gói, trong mỗi gói theo thứ tự gói khai; Hasura chỉ trả mục của tenant trong token.
export const MENU_QUERY =
  "query { platform_menu_items(order_by: [{ app: asc }, { position: asc }]) { app app_name item label component config roles icon on_menu } }";

// Phần chỉnh của org (ADR 0060), truy vấn riêng với menu: view chưa có hay lỗi thì menu vẫn hiện theo cấu hình gốc.
export const OVERRIDES_QUERY = "query { platform_config_overrides_by_tenant { app item kind target value } }";

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

/**
 * Liên kết chung tới chi tiết một dòng (ADR 0068): địa chỉ của danh sách cộng khóa đã mã hóa. Danh mục, chấm bản đồ và
 * dòng bảng điều hành cùng dựng địa chỉ ở đây, để khóa chứa dấu / hay % mở đúng dòng ở mọi nơi.
 */
export const rowPath = (listPath: string, key: unknown) => `${listPath}/${encodeURIComponent(String(key))}`;

/** Chi tiết dòng ngoài cùng của mục danh mục `item` trong gói `app`. */
export const recordPath = (app: string, item: string, key: unknown) => rowPath(itemPath({ app, item }), key);

export const findItem = (items: MenuItem[], app: string, item: string) =>
  items.find((entry) => entry.app === app && entry.item === item);

/** Mục đang mở khi đường dẫn là địa chỉ của mục hay nằm dưới nó (trang chi tiết của một dòng chẳng hạn). */
export const isActive = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

// Cùng danh mục với `icon` trong contracts/app.schema.json; menu.test.ts so hai danh sách để không lệch nhau.
export const MENU_ICONS = [
  "home",
  "list",
  "form",
  "map",
  "chart",
  "chat",
  "inbox",
  "document",
  "folder",
  "settings",
] as const;
export type MenuIcon = (typeof MENU_ICONS)[number];

/** Giá trị đọc từ CSDL không có trong danh mục (bản giao diện cũ hơn dữ liệu) thì mục chỉ có nhãn, không vỡ menu. */
export const menuIcon = (value: string | null): MenuIcon | null => MENU_ICONS.find((icon) => icon === value) ?? null;

export type MenuLink = { to: string; label: string; icon: MenuIcon | null };

/** Một nhóm trên menu. `collapsible`: nhóm phụ, thu gọn lúc đầu và đứng cuối. */
export type MenuGroup = { id: string; label: string; links: MenuLink[]; collapsible: boolean };

// Lõi nạp mục mẫu của nó dưới chủ sở hữu này (`make seed`: app-deploy.py menu --owner core). Lõi không có nghiệp vụ
// nên mục của lõi chỉ để thử; xếp như nhóm của gói thì mục thử đứng trước, mở sẵn, chen vào giữa việc thật.
export const SAMPLE_OWNER = "core";

/**
 * Gom mục theo gói, giữ thứ tự gói và thứ tự mục như câu truy vấn trả về. Tên nhóm là tên gói; dòng chưa có tên (nạp
 * trước ADR 0044) dùng mã gói. Thanh bên (menuGroups) và trang chủ (Home.tsx) cùng đọc từ đây nên ô của trang chủ
 * luôn khớp nhóm trên menu.
 */
export function packageGroups(items: MenuItem[]): MenuGroup[] {
  const groups = new Map<string, MenuGroup>();
  // Khối vẫn ở trong `items` để trang và đường dẫn tới dòng của khối tìm được nó; chỉ thanh bên và trang chủ bỏ qua.
  // Mục quản trị org ẩn (ADR 0060) cũng không lên thanh bên và trang chủ.
  for (const entry of items.filter((item) => !item.hidden && item.on_menu !== false)) {
    let group = groups.get(entry.app);
    if (!group) {
      const label = entry.app_name?.trim() || entry.app;
      group = { id: entry.app, label, links: [], collapsible: entry.app === SAMPLE_OWNER };
      groups.set(entry.app, group);
    }
    group.links.push({ to: itemPath(entry), label: entry.label, icon: menuIcon(entry.icon) });
  }
  return [...groups.values()];
}

/** Nhóm có ô trên trang chủ: nhóm mẫu của lõi chỉ để thử, thanh bên đã thu gọn nó, nên trang chủ không dẫn tới. */
export const homeGroups = (items: MenuItem[]) => packageGroups(items).filter((group) => !group.collapsible);

/** Nhóm của thanh bên: `first` (màn hình dùng chung) đứng đầu, rồi nhóm của các gói, nhóm mẫu của lõi đứng cuối. */
export function menuGroups(first: MenuGroup, items: MenuItem[]): MenuGroup[] {
  const all = packageGroups(items);
  return [first, ...all.filter((group) => !group.collapsible), ...all.filter((group) => group.collapsible)];
}
