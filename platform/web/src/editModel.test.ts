// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm danh sách của chế độ Chỉnh sửa (editModel.ts, ADR 0070): phần đã ẩn vẫn có trong danh sách để hiện lại, khối đã
// gỡ trở thành khối thêm được, danh mục chỉ đưa ra Kanban, Lịch khi cấu hình khai mục của chúng, ngưỡng giữ phép so
// của gói, và mọi đích đưa ra đều là đích overrideTargets() nhận.

import { describe, expect, it } from "vitest";
import { type ItemOverride, overrideTargets } from "./configOverrides";
import {
  blockCandidates,
  blockRows,
  fieldRows,
  itemModel,
  menuSiblings,
  panelRows,
  thresholdValue,
  usableVariants,
} from "./editModel";
import type { MenuItem } from "./menu";

const item = (id: string, component: string, config: unknown, extra: Partial<MenuItem> = {}): MenuItem => ({
  app: "a",
  app_name: "Gói",
  item: id,
  label: `Mục ${id}`,
  component,
  config,
  roles: null,
  icon: null,
  on_menu: true,
  ...extra,
});

const catalogConfig = {
  title: "Danh mục",
  source: "t",
  variant: "table",
  fields: [
    { name: "code", label: "Mã" },
    { name: "name", label: "Tên" },
    { name: "status", label: "Tình trạng", choices: [{ value: "x", label: "X" }] },
    { name: "rel.value", label: "Qua quan hệ" },
  ],
  list: { columns: ["code", "name"] },
  kanban: { field: "status" },
};
const list = item("list", "catalog", catalogConfig);
const summary = item("summary", "dashboard", { title: "S", panels: [] }, { on_menu: false });
const map = item("map", "map", { title: "M" });
const page = item("page", "page", {
  title: "Trang",
  blocks: [{ item: "list", variant: "cards" }, { item: "summary" }],
});
const items = [page, list, summary, map];
const own = (rows: Omit<ItemOverride, "app">[]): ItemOverride[] => rows.map((row) => ({ app: "a", ...row }));

describe("usableVariants", () => {
  it("danh mục có Kanban khi khai kanban, không có Lịch khi không khai calendar", () => {
    expect(usableVariants(list)).toEqual(["table", "cards", "kanban"]);
    expect(usableVariants(map)).toEqual(["map", "list"]);
  });
});

describe("itemModel", () => {
  it("kiểu của mục chỉ khi cấu hình gốc khai variant", () => {
    expect(itemModel(list, []).variant).toBe("table");
    expect(itemModel(page, []).variant).toBeUndefined();
  });

  it("nhãn, ẩn theo phần chỉnh", () => {
    const rows = own([
      { item: "list", kind: "label", target: "", value: "Tên mới" },
      { item: "list", kind: "hidden", target: "", value: true },
    ]);
    expect(itemModel(list, rows)).toMatchObject({ label: "Tên mới", hidden: true });
  });
});

describe("menuSiblings", () => {
  it("mục trên menu của gói theo thứ tự đã chỉnh, bỏ khối", () => {
    const rows = own([{ item: "map", kind: "order", target: "", value: 0 }]);
    expect(menuSiblings(items, rows, "a").map((row) => row.target)).toEqual(["map", "page", "list"]);
  });
});

describe("blockRows và blockCandidates", () => {
  it("khối theo thứ tự đã chỉnh, khối ẩn vẫn có, khối gỡ thành khối thêm được", () => {
    const rows = own([
      { item: "page", kind: "hidden", target: "list", value: true },
      { item: "page", kind: "block", target: "summary", value: false },
      { item: "page", kind: "block", target: "map", value: true },
      { item: "page", kind: "order", target: "map", value: 0 },
    ]);
    const blocks = blockRows(page, rows, items);
    expect(blocks.map((row) => [row.target, row.hidden, row.added])).toEqual([
      ["map", false, true],
      ["list", true, false],
    ]);
    expect(blocks[1]?.variant).toBe("cards");
    expect(blockCandidates(page, rows, items, blocks)).toEqual([
      { target: "summary", label: "Mục summary", removed: true },
    ]);
  });

  it("mọi đích khối đưa ra đều được nhận", () => {
    const targets = overrideTargets("page", page.config, "variant");
    for (const row of blockRows(page, [], items)) expect(targets).toContain(row.target);
  });
});

describe("fieldRows", () => {
  it("danh mục: cột đang hiện theo thứ tự, rồi cột ẩn, rồi trường qua quan hệ chỉ đổi nhãn", () => {
    const rows = own([
      { item: "list", kind: "order", target: "name", value: 0 },
      { item: "list", kind: "hidden", target: "status", value: false },
    ]);
    expect(fieldRows(list, rows).map((row) => [row.target, row.hidden, row.canHide, row.canMove])).toEqual([
      ["name", false, true, true],
      ["code", false, true, true],
      ["status", false, true, true],
      ["rel.value", false, false, false],
    ]);
  });

  it("biểu mẫu: trường bắt buộc không ẩn được, trường ẩn vẫn có", () => {
    const form = item("form", "form", {
      title: "F",
      fields: [
        { name: "a", label: "A", required: true },
        { name: "b", label: "B" },
      ],
    });
    const rows = fieldRows(form, own([{ item: "form", kind: "hidden", target: "b", value: true }]));
    expect(rows.map((row) => [row.target, row.hidden, row.canHide])).toEqual([
      ["a", false, false],
      ["b", true, true],
    ]);
  });
});

describe("panelRows và thresholdValue", () => {
  const dashboard = item("dash", "dashboard", {
    title: "D",
    panels: [
      {
        id: "p",
        title: "Khối",
        description: "",
        cards: [{ column: "c", label: "Thẻ", description: "", tone: { warn_when: { gt: 5, label: "Cần để ý" } } }],
      },
    ],
  });

  it("ngưỡng giữ phép so và chữ của gói, số theo phần chỉnh", () => {
    const rows = own([{ item: "dash", kind: "threshold", target: "p.c", value: { warn_when: { gt: 9 } } }]);
    const card = panelRows(dashboard, rows)[0]?.cards[0];
    expect(card?.levels).toEqual([{ key: "warn_when", operator: "gt", bound: 9, label: "Cần để ý" }]);
    expect(thresholdValue(card?.levels ?? [])).toEqual({ warn_when: { gt: 9 } });
    expect(overrideTargets("dashboard", dashboard.config, "threshold")).toContain(card?.target);
  });
});
