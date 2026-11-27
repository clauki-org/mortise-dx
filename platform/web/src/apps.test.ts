// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm phần hàm thuần của trang "Ứng dụng" (apps.ts, ADR 0065): lý do khóa nút bật, tắt theo cùng hai luật với trigger
// platform.app_states_guard(), ai là quản trị org, và lời từ chối của CSDL bỏ cụm Hasura chèn trước.

import { CombinedError } from "urql";
import { describe, expect, it } from "vitest";
import { blockedReason, isOrgAdmin, type PackageRow, refusalText, requiredNames } from "./apps";

const row = (app: string, more: Partial<PackageRow> = {}): PackageRow => ({
  app,
  name: `Gói ${app}`,
  description: null,
  requires: [],
  enabled: true,
  ...more,
});

describe("blockedReason", () => {
  it("gói không ai cần thì tắt được, gói không cần gì thì bật được", () => {
    const rows = [row("a"), row("b", { enabled: false })];
    expect(blockedReason(rows, "a")).toBeNull();
    expect(blockedReason(rows, "b")).toBeNull();
  });

  it("không tắt gói mà gói đang bật khác cần, kể tên các gói đó", () => {
    const rows = [row("base"), row("x", { requires: ["base"] }), row("y", { requires: ["base"] })];
    expect(blockedReason(rows, "base")).toBe("Gói đang bật Gói x, Gói y cần gói này; tắt các gói đó trước.");
  });

  it("gói cần nó đã tắt thì tắt được", () => {
    const rows = [row("base"), row("x", { requires: ["base"], enabled: false })];
    expect(blockedReason(rows, "base")).toBeNull();
  });

  it("không bật gói khi gói nó cần đang tắt hay chưa cài", () => {
    const rows = [row("base", { enabled: false }), row("x", { requires: ["base", "gone"], enabled: false })];
    expect(blockedReason(rows, "x")).toBe("Gói này cần Gói base, gone (chưa cài); bật các gói đó trước.");
  });

  it("gói không có trong danh sách thì không chặn (CSDL vẫn kiểm)", () => {
    expect(blockedReason([], "a")).toBeNull();
  });
});

describe("requiredNames", () => {
  it("tên hiển thị theo thứ tự khai, gói chưa cài ghi rõ", () => {
    const needs = row("x", { requires: ["gone", "base"] });
    expect(requiredNames([row("base"), needs], needs)).toEqual(["gone (chưa cài)", "Gói base"]);
  });
});

describe("isOrgAdmin", () => {
  const root = [{ id: "root", parent_id: null }];
  it("tenant_admin của tenant không có cha", () => {
    expect(isOrgAdmin(["user", "tenant_admin"], root)).toBe(true);
  });
  it("tenant_admin của tenant con, người không có vai trò, hay chưa đọc được tenant thì không", () => {
    expect(isOrgAdmin(["tenant_admin"], [{ id: "child", parent_id: "root" }])).toBe(false);
    expect(isOrgAdmin(["user"], root)).toBe(false);
    expect(isOrgAdmin(["tenant_admin"], undefined)).toBe(false);
    expect(isOrgAdmin(["tenant_admin"], [])).toBe(false);
  });
});

describe("refusalText", () => {
  it("bỏ cụm Hasura chèn trước lời của trigger", () => {
    const error = new CombinedError({
      graphQLErrors: ["Check constraint violation. Không tắt được gói a: gói đang bật Gói b (b) cần gói này"],
    });
    expect(refusalText(error)).toBe("Không tắt được gói a: gói đang bật Gói b (b) cần gói này");
  });
  it("lỗi mạng không có lời từ chối", () => {
    expect(refusalText(new CombinedError({ networkError: new Error("offline") }))).toBeNull();
    expect(refusalText(undefined)).toBeNull();
  });
});
