// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm phần thuần của trang gồm khối (page.ts, ADR 0061): danh sách kiểu khớp `variant` trong schema của từng thành
// phần, giá trị lạ về kiểu mặc định, kiểu của trang đè kiểu của mục, cấu hình trang sai dạng thành lời báo.

import { describe, expect, it } from "vitest";
import catalogSchema from "../../../contracts/catalog.schema.json?raw";
import dashboardSchema from "../../../contracts/dashboard.schema.json?raw";
import mapSchema from "../../../contracts/map.schema.json?raw";
import { pageProblems, VARIANTS, variantOf, variantsOf, withVariant } from "./page";

describe("kiểu của thành phần", () => {
  it("trùng `variant` trong contracts/<thành phần>.schema.json, cùng thứ tự", () => {
    const schemas = { catalog: catalogSchema, dashboard: dashboardSchema, map: mapSchema };
    for (const [component, raw] of Object.entries(schemas)) {
      expect(JSON.parse(raw).properties.variant.enum, component).toEqual([...variantsOf(component)]);
    }
    expect(Object.keys(VARIANTS).sort()).toEqual(Object.keys(schemas).sort());
  });

  it("giá trị lạ hay bỏ trống về kiểu đầu tiên", () => {
    expect(variantOf("catalog", "cards")).toBe("cards");
    expect(variantOf("catalog", "timeline")).toBe("table");
    expect(variantOf("map", undefined)).toBe("map");
    expect(variantOf("dashboard", 3)).toBe("full");
  });

  it("thành phần chưa có kiểu thì không có kiểu nào, kể cả tên trùng thuộc tính có sẵn của đối tượng", () => {
    expect(variantsOf("form")).toEqual([]);
    expect(variantsOf("constructor")).toEqual([]);
  });
});

describe("withVariant", () => {
  it("kiểu của trang đè kiểu của mục, không sửa cấu hình gốc", () => {
    const config = { title: "Danh mục", variant: "table" };
    expect(withVariant(config, "catalog", "cards")).toEqual({ title: "Danh mục", variant: "cards" });
    expect(config.variant).toBe("table");
  });

  it("không chọn kiểu, thành phần chưa có kiểu, hay cấu hình không phải đối tượng thì giữ nguyên", () => {
    const config = { title: "Biểu mẫu" };
    expect(withVariant(config, "catalog", undefined)).toBe(config);
    expect(withVariant(config, "form", "cards")).toBe(config);
    expect(withVariant(null, "catalog", "cards")).toBeNull();
    expect(withVariant([1], "map", "list")).toEqual([1]);
  });
});

describe("pageProblems", () => {
  it("cấu hình đúng dạng không có lỗi", () => {
    expect(pageProblems({ title: "Tổng quan", blocks: [{ item: "a" }] })).toEqual([]);
  });

  it("thiếu tiêu đề, thiếu khối hay khối thiếu item đều được báo", () => {
    expect(pageProblems(null)).toEqual(["cấu hình không phải một đối tượng"]);
    expect(pageProblems({ title: " ", blocks: [] })).toEqual(["thiếu title", "cần ít nhất một khối trong blocks"]);
    expect(pageProblems({ title: "T", blocks: [{}] })).toEqual(["khối thiếu item"]);
  });
});
