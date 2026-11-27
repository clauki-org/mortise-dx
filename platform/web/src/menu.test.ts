// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử menu của gói (menu.ts, menuIcons.tsx): đọc vai trò từ access token, lọc mục theo vai trò, địa chỉ của
// mục, gom mục thành nhóm theo gói và thứ tự nhóm, ý nghĩa biểu tượng khớp hợp đồng và có hình.

import { describe, expect, it } from "vitest";
import appSchema from "../../../contracts/app.schema.json?raw";
import {
  findItem,
  homeGroups,
  isActive,
  itemPath,
  MENU_ICONS,
  type MenuGroup,
  type MenuItem,
  menuGroups,
  menuIcon,
  rolesOf,
  SAMPLE_OWNER,
  visibleItems,
} from "./menu";
import { MENU_ICON_SHAPES } from "./menuIcons";

const base64url = (value: string) => btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const tokenWith = (claims: object) => `header.${base64url(JSON.stringify(claims))}.signature`;

const entry = (item: string, roles: string[] | null, more: Partial<MenuItem> = {}): MenuItem => ({
  app: "example-app",
  app_name: "Gói ví dụ",
  item,
  label: item,
  component: "catalog",
  config: {},
  roles,
  icon: null,
  ...more,
});

describe("rolesOf", () => {
  it("đọc vai trò realm trong access token", () => {
    expect(rolesOf(tokenWith({ realm_access: { roles: ["user", "manager"] } }))).toEqual(["user", "manager"]);
  });

  it("đọc được phần base64url có ký tự - và _", () => {
    // "~~~" mã hóa base64 thành "fn5+", base64url thành "fn5-": một bộ giải base64 thường sẽ không đọc được.
    const claims = { realm_access: { roles: ["user"] }, note: "~~~>>>???" };
    expect(base64url(JSON.stringify(claims))).toMatch(/[-_]/);
    expect(rolesOf(tokenWith(claims))).toEqual(["user"]);
  });

  it("token thiếu, hỏng hay không có vai trò thì coi như không có vai trò", () => {
    expect(rolesOf(undefined)).toEqual([]);
    expect(rolesOf("không-phải-token")).toEqual([]);
    expect(rolesOf("a.@@@.b")).toEqual([]);
    expect(rolesOf(tokenWith({ sub: "x" }))).toEqual([]);
    expect(rolesOf(tokenWith({ realm_access: { roles: "user" } }))).toEqual([]);
  });
});

describe("visibleItems", () => {
  const items = [entry("everyone", null), entry("empty", []), entry("managers", ["manager"])];

  it("mục không khai vai trò hay khai rỗng là của mọi người", () => {
    expect(visibleItems(items, ["user"]).map((item) => item.item)).toEqual(["everyone", "empty"]);
  });

  it("mục có khai vai trò hiện khi người dùng có một vai trò trùng", () => {
    expect(visibleItems(items, ["user", "manager"]).map((item) => item.item)).toEqual([
      "everyone",
      "empty",
      "managers",
    ]);
  });
});

describe("địa chỉ của mục", () => {
  it("đặt dưới /apps/<gói>/<mục> và tìm lại được từ hai phần đó", () => {
    const items = [entry("records", null)];
    expect(itemPath(items[0] as MenuItem)).toBe("/apps/example-app/records");
    expect(findItem(items, "example-app", "records")).toBe(items[0]);
    expect(findItem(items, "example-app", "other")).toBeUndefined();
  });
});

describe("nhóm trên menu", () => {
  const first: MenuGroup = { id: "", label: "Chung", links: [], collapsible: false };
  const summary = (groups: MenuGroup[]) =>
    groups.map((group) => [group.label, group.collapsible, group.links.map((link) => link.label)]);

  it("gom theo gói dưới tên gói, nhóm dùng chung đứng đầu, nhóm mẫu của lõi đứng cuối và thu gọn", () => {
    const items = [
      entry("a1", null, { app: "alpha", app_name: "Gói Một" }),
      entry("a2", null, { app: "alpha", app_name: "Gói Một" }),
      entry("s1", null, { app: SAMPLE_OWNER, app_name: "Mẫu thử" }),
      entry("z1", null, { app: "zeta", app_name: "Gói Hai" }),
    ];
    expect(summary(menuGroups(first, items))).toEqual([
      ["Chung", false, []],
      ["Gói Một", false, ["a1", "a2"]],
      ["Gói Hai", false, ["z1"]],
      ["Mẫu thử", true, ["s1"]],
    ]);
  });

  it("giữ thứ tự mục như câu truy vấn trả về", () => {
    const items = [entry("c", null), entry("a", null), entry("b", null)];
    expect(menuGroups(first, items)[1]?.links.map((link) => link.label)).toEqual(["c", "a", "b"]);
  });

  it("dòng chưa có tên gói (nạp trước khi bảng có cột) dùng mã gói làm tên nhóm", () => {
    expect(menuGroups(first, [entry("x", null, { app_name: null })])[1]?.label).toBe("example-app");
    expect(menuGroups(first, [entry("x", null, { app_name: "  " })])[1]?.label).toBe("example-app");
  });

  it("trang chủ có ô cho nhóm của gói theo thứ tự của menu, không có ô cho nhóm mẫu của lõi", () => {
    const items = [
      entry("s1", null, { app: SAMPLE_OWNER, app_name: "Mẫu thử" }),
      entry("a1", null, { app: "alpha", app_name: "Gói Một" }),
      entry("z1", null, { app: "zeta", app_name: "Gói Hai" }),
    ];
    expect(summary(homeGroups(items))).toEqual([
      ["Gói Một", false, ["a1"]],
      ["Gói Hai", false, ["z1"]],
    ]);
  });

  it("không có mục của gói thì chỉ còn nhóm dùng chung", () => {
    expect(menuGroups(first, [])).toEqual([first]);
  });

  it("liên kết mang địa chỉ và biểu tượng của mục; ý nghĩa lạ thì không có biểu tượng", () => {
    const [, group] = menuGroups(first, [entry("r", null, { icon: "map" }), entry("q", null, { icon: "nope" })]);
    expect(group?.links).toEqual([
      { to: "/apps/example-app/r", label: "r", icon: "map" },
      { to: "/apps/example-app/q", label: "q", icon: null },
    ]);
  });
});

describe("mục đang mở", () => {
  it("là địa chỉ của mục hay trang bên dưới, không phải mục có tên bắt đầu giống", () => {
    expect(isActive("/apps/a/items", "/apps/a/items")).toBe(true);
    expect(isActive("/apps/a/items/42", "/apps/a/items")).toBe(true);
    expect(isActive("/apps/a/items-old", "/apps/a/items")).toBe(false);
  });

  it("trang chủ (/) chỉ là mục đang mở khi ở đúng /, không phải ở mọi trang", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/tasks", "/")).toBe(false);
    expect(isActive("/apps/a/items", "/")).toBe(false);
  });
});

describe("biểu tượng", () => {
  it("danh mục ý nghĩa trùng `icon` trong contracts/app.schema.json", () => {
    const schema = JSON.parse(appSchema);
    expect(schema.properties.menu.items.properties.icon.enum).toEqual([...MENU_ICONS]);
  });

  it("mỗi ý nghĩa có một hình riêng", () => {
    const shapes = MENU_ICONS.map((icon) => MENU_ICON_SHAPES[icon]);
    expect(shapes.every(Boolean)).toBe(true);
    expect(new Set(shapes).size).toBe(MENU_ICONS.length);
  });

  it("chỉ nhận giá trị trong danh mục", () => {
    expect(menuIcon("chart")).toBe("chart");
    expect(menuIcon("constructor")).toBeNull();
    expect(menuIcon(null)).toBeNull();
  });
});
