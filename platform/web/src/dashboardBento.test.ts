// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm phần tính thuần của lưới Bento (dashboardBento.ts): mức độ của thẻ theo hằng số của gói, độ dài hai vòng của
// vòng đo theo cột phần trăm, và bề rộng của khối trên lưới khi các tổ hợp vai trò khác nhau ẩn đi những khối khác
// nhau: mọi hàng luôn đầy, thứ tự giữ nguyên.

import { describe, expect, it } from "vitest";
import { cardLevel, gaugeLaps, panelSpans } from "./dashboardBento";
import type { Card, Panel } from "./dashboardConfig";

describe("cardLevel", () => {
  const card: Card = {
    column: "x",
    label: "X",
    description: "X.",
    tone: { warn_when: { gte: 10, label: "Cần để ý" }, bad_when: { gt: 50, label: "Xấu" } },
  };

  it("bad thắng warn; không khớp mức nào thì không có mức", () => {
    expect(cardLevel(card, 60)).toEqual({ tone: "bad", label: "Xấu" });
    expect(cardLevel(card, "10")).toEqual({ tone: "warn", label: "Cần để ý" });
    expect(cardLevel(card, 9.5)).toBeUndefined();
  });

  it("ô trống, không phải số, hay thẻ không khai mức thì không có mức", () => {
    expect(cardLevel(card, null)).toBeUndefined();
    expect(cardLevel(card, "abc")).toBeUndefined();
    expect(cardLevel({ ...card, tone: undefined }, 60)).toBeUndefined();
  });

  it("đủ bốn phép so", () => {
    const at = (when: Record<string, number>, value: number) =>
      cardLevel({ ...card, tone: { bad_when: { ...when, label: "B" } } }, value)?.tone;
    expect([at({ gt: 0 }, 0), at({ gte: 0 }, 0), at({ lt: 0 }, 0), at({ lte: 0 }, 0)]).toEqual([
      undefined,
      "bad",
      undefined,
      "bad",
    ]);
  });
});

describe("gaugeLaps", () => {
  it("vòng ngoài tới 100%, phần trên 100% là vòng trong, tối đa một vòng nữa", () => {
    expect(gaugeLaps(50)).toEqual({ outer: 0.5, inner: 0 });
    expect(gaugeLaps("172")).toEqual({ outer: 1, inner: expect.closeTo(0.72, 10) });
    expect(gaugeLaps(350)).toEqual({ outer: 1, inner: 1 });
    expect(gaugeLaps(-5)).toEqual({ outer: 0, inner: 0 });
  });

  it("không có số thì không vẽ vòng nào", () => {
    expect(gaugeLaps(null)).toBeUndefined();
    expect(gaugeLaps("n/a")).toBeUndefined();
  });
});

describe("panelSpans", () => {
  const block = (id: string, size?: Panel["size"]): Panel => ({ id, title: id, description: id, size });
  // Một trang mẫu: khối chính nửa hàng, hai khối một phần tư, nhiều khối nửa hàng, một khối cả hàng cuối trang.
  const area = block("main", "half");
  const quarters = [block("q1", "quarter"), block("q2", "quarter")];
  const halves = (...ids: string[]) => ids.map((id) => block(id, "half"));
  const rowsFull = (spans: number[], columns: number) => {
    let used = 0;
    for (const span of spans) used = (used + span) % columns;
    return used === 0;
  };

  it("vai trò ít khối nhất: khối của vai trò khác bị ẩn mà hàng vẫn đầy; khối lẻ cuối trang nới ra cả hàng", () => {
    const clerk = [area, ...quarters, ...halves("h1", "h5", "h6", "h8", "h9")];
    expect(panelSpans(clerk, 4)).toEqual([2, 1, 1, 2, 2, 2, 2, 4]);
    expect(panelSpans(clerk, 2)).toEqual([2, 1, 1, 2, 2, 2, 2, 2]);
  });

  it("vai trò khác: mọi hàng đầy ở cả hai lưới", () => {
    const many = [area, ...quarters, ...halves("h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8", "h9")];
    const few = [area, ...quarters, ...halves("h1", "h5"), block("wide", "full")];
    for (const panels of [many, few]) {
      for (const columns of [4, 2]) expect(rowsFull(panelSpans(panels, columns), columns)).toBe(true);
    }
    expect(panelSpans(few, 4)).toEqual([2, 1, 1, 2, 2, 4]);
  });

  it("khối không vừa phần còn lại của hàng thì xuống hàng, khối trước nới ra; bỏ trống size là cả hàng", () => {
    expect(panelSpans([block("a", "quarter"), block("b", "half"), block("c", "half")], 4)).toEqual([1, 3, 4]);
    expect(panelSpans([block("a", "quarter"), block("b")], 4)).toEqual([4, 4]);
    expect(panelSpans([], 4)).toEqual([]);
  });
});
