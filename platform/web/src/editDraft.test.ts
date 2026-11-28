// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm bản nháp của chế độ Chỉnh sửa (editDraft.ts, ADR 0070): gộp thay đổi cùng đích, bỏ thay đổi không làm khác
// gì, "Về mặc định" bỏ thay đổi trước của mục, thứ tự ghi (xóa trước, thêm khối trước kiểu của khối), số thứ tự cho
// mọi phần tử khi đưa lên, xuống, và câu mutation luôn lọc theo gói và mục.

import { describe, expect, it } from "vitest";
import type { ItemOverride } from "./configOverrides";
import {
  addChanges,
  type Change,
  draftOverrides,
  menuMoveChanges,
  moveChanges,
  mutationOf,
  saveOrder,
} from "./editDraft";

const place = { app: "a", item: "list" };
const label = (value: string): Change => ({ type: "set", ...place, kind: "label", target: "name", value, note: value });
const saved: ItemOverride[] = [{ ...place, kind: "label", target: "name", value: "Cũ" }];

describe("addChanges", () => {
  it("thay đổi sau thay thay đổi trước của cùng đích", () => {
    const draft = addChanges([], addChanges([], [], [label("Một")]), [label("Hai")]);
    expect(draft).toEqual([label("Hai")]);
  });

  it("ghi đúng giá trị đang lưu, hay xóa phần chỉnh không có, thì không thành thay đổi", () => {
    expect(addChanges(saved, [], [label("Cũ")])).toEqual([]);
    const unset: Change = { type: "unset", ...place, kind: "hidden", target: "name", note: "" };
    expect(addChanges(saved, [], [unset])).toEqual([]);
  });

  it("đổi rồi đổi về giá trị đang lưu thì bản nháp rỗng", () => {
    const draft = addChanges(saved, [label("Mới")], [label("Cũ")]);
    expect(draft).toEqual([]);
  });

  it("Về mặc định bỏ thay đổi trước của mục, giữ thay đổi của mục khác", () => {
    const other: Change = { ...label("Khác"), item: "other" };
    const reset: Change = { type: "reset", ...place, note: "" };
    expect(addChanges(saved, [label("Mới"), other], [reset])).toEqual([other, reset]);
    expect(draftOverrides(saved, [reset])).toEqual([]);
  });
});

describe("draftOverrides", () => {
  it("áp set, unset lên phần chỉnh đã lưu", () => {
    expect(draftOverrides(saved, [label("Mới")])).toEqual([{ ...place, kind: "label", target: "name", value: "Mới" }]);
    expect(draftOverrides(saved, [{ type: "unset", ...place, kind: "label", target: "name", note: "" }])).toEqual([]);
  });
});

describe("saveOrder", () => {
  it("xóa trước, thêm khối trước kiểu và thứ tự của khối", () => {
    const variant: Change = { type: "set", ...place, kind: "variant", target: "x", value: "cards", note: "" };
    const block: Change = { type: "set", ...place, kind: "block", target: "x", value: true, note: "" };
    const reset: Change = { type: "reset", app: "a", item: "other", note: "" };
    expect(saveOrder([variant, block, reset])).toEqual([reset, block, variant]);
  });
});

describe("moveChanges", () => {
  const rows = [
    { target: "a", label: "A" },
    { target: "b", label: "B" },
    { target: "c", label: "C" },
  ];

  it("ghi số thứ tự cho mọi phần tử theo thứ tự mới", () => {
    const changes = moveChanges(place, rows, 2, -1);
    expect(changes.map((change) => change.type === "set" && [change.target, change.value])).toEqual([
      ["a", 0],
      ["c", 1],
      ["b", 2],
    ]);
  });

  it("đầu không lên, cuối không xuống", () => {
    expect(moveChanges(place, rows, 0, -1)).toEqual([]);
    expect(moveChanges(place, rows, 2, 1)).toEqual([]);
  });
});

describe("menuMoveChanges", () => {
  it("số thứ tự trên menu ghi vào từng mục anh em, đích rỗng", () => {
    const changes = menuMoveChanges(
      "a",
      [
        { target: "x", label: "X" },
        { target: "y", label: "Y" },
      ],
      1,
      -1,
    );
    expect(changes.map((change) => change.type === "set" && [change.item, change.target, change.value])).toEqual([
      ["y", "", 0],
      ["x", "", 1],
    ]);
  });
});

describe("mutationOf", () => {
  it("Về mặc định lọc theo cả gói và mục", () => {
    const { query, variables } = mutationOf({ type: "reset", ...place, note: "" });
    expect(query).toContain("app: { _eq: $app }, item: { _eq: $item }");
    expect(variables).toEqual(place);
  });

  it("ghi bằng insert kèm on_conflict, chỉ sửa value", () => {
    const { query, variables } = mutationOf(label("Mới"));
    expect(query).toContain("constraint: config_overrides_pkey, update_columns: [value]");
    expect(variables).toEqual({ ...place, kind: "label", target: "name", value: "Mới" });
  });
});
