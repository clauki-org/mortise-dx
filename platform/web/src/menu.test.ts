// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử menu của gói (menu.ts): đọc vai trò từ access token, lọc mục theo vai trò, địa chỉ của mục.

import { describe, expect, it } from "vitest";
import { findItem, itemPath, type MenuItem, rolesOf, visibleItems } from "./menu";

const base64url = (value: string) => btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const tokenWith = (claims: object) => `header.${base64url(JSON.stringify(claims))}.signature`;

const entry = (item: string, roles: string[] | null): MenuItem => ({
  app: "example-app",
  item,
  label: item,
  component: "catalog",
  config: {},
  roles,
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
