// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm phần thuần của Kanban và Lịch (catalogViews.ts, ADR 0066): kiểu nào vẽ được, lỗi cấu hình, cột và câu truy
// vấn mỗi cột một bí danh, cột chuyển vào ra được, khoảng ngày theo tháng và tuần, ngày của từng giá trị.

import { describe, expect, it } from "vitest";
import type { CatalogConfig } from "./catalog";
import { emptyState, readState } from "./catalogQuery";
import {
  boardColumns,
  boardQuery,
  boardVariables,
  calendarDays,
  calendarQuery,
  calendarVariables,
  dayKey,
  dayOf,
  type KanbanConfig,
  moveTargets,
  rangeLabel,
  shiftCursor,
  viewOf,
  viewProblems,
  viewsOf,
} from "./catalogViews";

const status = {
  name: "status",
  label: "Tình trạng",
  choices: [
    { value: "new", label: "Mới" },
    { value: "doing", label: "Đang làm", tone: "info" as const },
    { value: "review", label: "Chờ nghiệm thu" },
  ],
};
const base: CatalogConfig = {
  title: "Phiếu",
  source: "app_x_jobs",
  fields: [{ name: "code", label: "Mã" }, status, { name: "due_on", label: "Hẹn", type: "date" }],
  list: { columns: ["code", "status"], page_size: 2 },
};
const kanban: KanbanConfig = { field: "status", move: { version: "updated_at" }, locked: ["review"] };

describe("kiểu vẽ được", () => {
  it("Kanban, Lịch chỉ có khi cấu hình khai mục của nó; kiểu không vẽ được về kiểu mặc định rồi về bảng", () => {
    expect(viewsOf(base)).toEqual(["table", "cards"]);
    const views = viewsOf({ ...base, kanban, calendar: { field: "due_on" } });
    expect(views).toEqual(["table", "cards", "kanban", "calendar"]);
    expect(viewOf(["table", "cards"], "kanban", "cards")).toBe("cards");
    expect(viewOf(["table", "cards"], undefined, "kanban")).toBe("table");
    expect(viewOf(views, "calendar", "kanban")).toBe("calendar");
  });

  it("đường dẫn nhận view=kanban, view=calendar, bỏ giá trị lạ", () => {
    expect(readState(new URLSearchParams("view=kanban")).view).toBe("kanban");
    expect(readState(new URLSearchParams("view=calendar")).view).toBe("calendar");
    expect(readState(new URLSearchParams("view=timeline")).view).toBeUndefined();
  });
});

describe("viewProblems", () => {
  it("cấu hình đúng không có lỗi", () => {
    expect(viewProblems({ ...base, kanban, calendar: { field: "due_on", title: "code" } })).toEqual([]);
  });

  it("trường chia cột phải là cột đã khai, có choices; locked nằm trong choices; tên cột, vai trò hợp lệ", () => {
    expect(viewProblems({ ...base, kanban: { field: "code" } })).toEqual([
      'kanban.field dùng trường "code" không có choices',
    ]);
    expect(viewProblems({ ...base, kanban: { field: "owner.name" } })).toEqual([
      'kanban.field chỉ nhận cột của chính bảng, không nhận "owner.name"',
    ]);
    expect(viewProblems({ ...base, kanban: { field: "status", locked: ["gone"] } })).toEqual([
      'kanban.locked có "gone" không nằm trong choices',
    ]);
    expect(viewProblems({ ...base, kanban: { field: "status", move: { role: "Bad", version: "x y" } } })).toEqual([
      'kanban.move.version "x y" không phải tên cột',
      'kanban.move.role "Bad" không hợp lệ',
    ]);
  });

  it("trường của lịch phải là cột ngày đã khai; tiêu đề là cột đã khai", () => {
    expect(viewProblems({ ...base, calendar: { field: "code" } })).toEqual([
      'calendar.field dùng trường "code" không phải kiểu date hay datetime',
    ]);
    expect(viewProblems({ ...base, calendar: { field: "missing", title: "nope" } })).toEqual([
      'calendar.field dùng trường "missing" chưa khai trong fields',
      'calendar.title dùng trường "nope" chưa khai trong fields',
    ]);
  });
});

describe("Kanban", () => {
  const columns = boardColumns(status, kanban);

  it("mỗi lựa chọn một cột theo thứ tự khai, thêm cột cuối cho giá trị trống hay ngoài choices", () => {
    expect(columns.map((column) => [column.alias, column.value, column.label, column.locked])).toEqual([
      ["c0", "new", "Mới", false],
      ["c1", "doing", "Đang làm", false],
      ["c2", "review", "Chờ nghiệm thu", true],
      ["cx", undefined, "Chưa xếp cột", false],
    ]);
    expect(columns[1]?.tone).toBe("info");
  });

  it("thẻ chuyển sang cột khác không khóa; cột khóa không nhận và không cho đi; cột cuối không nhận", () => {
    const [fresh, doing, review, other] = columns;
    if (!fresh || !doing || !review || !other) throw new Error("thiếu cột");
    expect(moveTargets(columns, fresh)).toEqual([doing]);
    expect(moveTargets(columns, review)).toEqual([]);
    expect(moveTargets(columns, other)).toEqual([fresh, doing]);
  });

  it("một câu, mỗi cột một bí danh, đọc kèm cột version để lệnh chuyển so", () => {
    expect(boardQuery(base, kanban, columns.slice(0, 1))).toBe(
      "query($c0: app_x_jobs_bool_exp!, $order_by: [app_x_jobs_order_by!], $limit: Int!) " +
        "{ c0: app_x_jobs(where: $c0, order_by: $order_by, limit: $limit) { id code status updated_at } }",
    );
    expect(boardQuery(base, { field: "status" }, columns.slice(0, 1))).not.toContain("updated_at");
  });

  it("điều kiện của cột cộng với tìm, lọc của danh sách; cột cuối lấy giá trị trống hay ngoài choices", () => {
    const state = { ...emptyState, filters: { status: "new" }, page: 3 };
    const filtered = { ...base, list: { ...base.list, filters: ["status"] } };
    const variables = boardVariables(filtered, kanban, columns, state, { owner: { _eq: 1 } });
    const where = { _and: [{ owner: { _eq: 1 } }, { status: { _eq: "new" } }] };
    expect(variables.c1).toEqual({ _and: [where, { status: { _eq: "doing" } }] });
    expect(variables.cx).toEqual({
      _and: [where, { _or: [{ status: { _is_null: true } }, { status: { _nin: ["new", "doing", "review"] } }] }],
    });
    // Không phân trang: trang của danh sách không áp cho bảng; xin thừa một thẻ để biết cột còn thẻ.
    expect(variables.limit).toBe(3);
  });
});

describe("Lịch", () => {
  // Thứ năm 26/11/2026.
  const day = new Date(2026, 10, 26);

  it("tháng gồm đủ tuần từ thứ hai tới chủ nhật; tuần là bảy ngày từ thứ hai", () => {
    const month = calendarDays("month", day);
    expect(month.length % 7).toBe(0);
    expect(dayKey(month[0] ?? day)).toBe("2026-10-26");
    expect(dayKey(month[month.length - 1] ?? day)).toBe("2026-12-06");
    const week = calendarDays("week", day);
    expect(week.map(dayKey)).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
    expect(rangeLabel("week", day, week)).toBe("23/11/2026 – 29/11/2026");
    expect(rangeLabel("month", day, month)).toBe("Tháng 11/2026");
  });

  it("trước, sau đi theo tháng hay tuần, kể cả qua năm", () => {
    expect(dayKey(shiftCursor("month", new Date(2026, 11, 31), 1))).toBe("2027-01-01");
    expect(dayKey(shiftCursor("week", day, -1))).toBe("2026-11-19");
  });

  it("cột date đọc nguyên phần ngày; giá trị không có dạng ngày ISO thì không xếp được", () => {
    const date = { name: "due_on", label: "Hẹn", type: "date" as const };
    expect(dayOf(date, "2026-11-30")).toBe("2026-11-30");
    expect(dayOf(date, 1)).toBeUndefined();
    expect(dayOf(date, "1")).toBeUndefined();
    const datetime = { ...date, type: "datetime" as const };
    expect(dayOf(datetime, new Date(2026, 10, 30, 23, 30).toISOString())).toBe("2026-11-30");
    expect(dayOf(datetime, "2026-13-45T99:00")).toBeUndefined();
  });

  it("câu lịch đọc khóa, trường ngày và tiêu đề trong khoảng [ngày đầu, ngày sau ngày cuối)", () => {
    const calendar = { field: "due_on" };
    expect(calendarQuery(base, calendar)).toContain("{ id due_on code }");
    const field = { name: "due_on", label: "Hẹn", type: "date" as const };
    const variables = calendarVariables(base, calendar, field, emptyState, calendarDays("week", day));
    expect(variables.where).toEqual({ _and: [{ _and: [] }, { due_on: { _gte: "2026-11-23", _lt: "2026-11-30" } }] });
    expect(variables.order_by).toEqual([{ due_on: "asc" }, { id: "asc" }]);
    const timed = calendarVariables(base, calendar, { ...field, type: "datetime" }, emptyState, [day]);
    expect(timed.where._and[1]).toEqual({
      due_on: { _gte: day.toISOString(), _lt: new Date(2026, 10, 27).toISOString() },
    });
  });
});
