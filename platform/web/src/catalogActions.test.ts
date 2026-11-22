// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử phần cấu hình của nút khởi tạo quy trình (detail.actions, ADR 0026) và trường đọc qua quan hệ: lỗi cấu
// hình, câu truy vấn chi tiết, biến gửi cho quy trình. Cấu hình mẫu cùng dạng với
// contracts/examples/catalog.example.yaml.

import { describe, expect, it } from "vitest";
import { type Action, actionVariables, type CatalogConfig, configProblems, fieldValue, resolvePath } from "./catalog";
import { chainQuery, selection } from "./catalogQuery";
import { idempotencyKey } from "./workflow";

const request: Action = {
  id: "request",
  label: "Đề nghị kiểm tra",
  process: "approval",
  variables: { itemId: "id", title: "name", quantity: "quantity", group: "category.name" },
};

const config: CatalogConfig = {
  title: "Danh mục",
  source: "app_example_items",
  fields: [
    { name: "name", label: "Tên" },
    { name: "quantity", label: "Số lượng", type: "number" },
    { name: "category.name", label: "Nhóm" },
  ],
  list: { columns: ["name", "quantity"] },
  detail: { title: "name", actions: [request] },
};

describe("trường đọc qua quan hệ", () => {
  it("câu truy vấn chi tiết gom cột qua quan hệ thành đối tượng con", () => {
    const steps = resolvePath(config, ["a1"]) ?? [];
    expect(chainQuery(steps)).toBe(
      "query($w0: app_example_items_bool_exp!) " +
        "{ s0: app_example_items(where: $w0, limit: 1) { id name quantity category { name } } }",
    );
    expect(selection(["id", "a.x", "a.y", "b.z", "id"])).toBe("id a { x y } b { z }");
  });

  it("đọc giá trị qua quan hệ; quan hệ trống thì giá trị trống", () => {
    expect(fieldValue({ category: { name: "Kho" } }, "category.name")).toBe("Kho");
    expect(fieldValue({ category: null }, "category.name")).toBeUndefined();
    expect(fieldValue({ name: "A" }, "name")).toBe("A");
  });

  it("danh sách, ô tìm, thứ tự và tiêu đề không nhận trường qua quan hệ", () => {
    const list = { columns: ["category.name"], search: ["category.name"] };
    expect(configProblems({ ...config, list, detail: { title: "category.name" } })).toEqual([
      'list.columns chỉ nhận cột của chính bảng, không nhận "category.name"',
      'list.search chỉ nhận cột của chính bảng, không nhận "category.name"',
      'detail.title chỉ nhận cột của chính bảng, không nhận "category.name"',
    ]);
  });

  it("từ chối tên trường qua hai cấp quan hệ trước khi ghép vào câu truy vấn", () => {
    const fields = [...config.fields, { name: "a.b.c", label: "Sâu" }];
    expect(configProblems({ ...config, fields })).toEqual([
      '"a.b.c" không phải tên trường hợp lệ (cột, hoặc quan hệ.cột)',
    ]);
  });
});

describe("nút khởi tạo quy trình", () => {
  it("cấu hình mẫu dùng được", () => {
    expect(configProblems(config)).toEqual([]);
  });

  it("báo nút trùng tên ngắn và biến lấy từ trường chưa khai, kể cả ở đối tượng con", () => {
    const broken = { ...request, variables: { x: "missing" } };
    expect(configProblems({ ...config, detail: { actions: [request, broken] } })).toEqual([
      'hai nút cùng tên ngắn "request"',
      'nút "Đề nghị kiểm tra" lấy biến "x" từ "missing", không phải khóa hay trường đã khai',
    ]);
    const child = { ...config, id: "parts", label: "Thành phần", via: "item_id", detail: { actions: [broken] } };
    expect(configProblems({ ...config, detail: { children: [child] } })).toEqual([
      'Thành phần: nút "Đề nghị kiểm tra" lấy biến "x" từ "missing", không phải khóa hay trường đã khai',
    ]);
  });

  it("gửi giá trị đúng kiểu Hasura trả; hộp xác nhận hiện trường đã khai, không hiện khóa", () => {
    const row = { id: "a1", name: "Kho A", quantity: 1234.5, category: { name: "Kho" } };
    expect(actionVariables(config, request, row)).toEqual({
      variables: { itemId: "a1", title: "Kho A", quantity: 1234.5, group: "Kho" },
      shown: [
        { label: "Tên", text: "Kho A" },
        { label: "Số lượng", text: "1.234,5" },
        { label: "Nhóm", text: "Kho" },
      ],
      missing: [],
    });
  });

  it("số 0 là giá trị; trường trống hay quan hệ trống thì báo thiếu", () => {
    const row = { id: "a1", name: "", quantity: 0, category: null };
    const { variables, missing } = actionVariables(config, request, row);
    expect(variables).toEqual({ itemId: "a1", quantity: 0 });
    expect(missing).toEqual(["Tên", "Nhóm"]);
  });

  it("mã Idempotency-Key mới mỗi lần, đúng luật của workflow-api", () => {
    const first = idempotencyKey();
    expect(first).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(idempotencyKey()).not.toBe(first);
  });
});
