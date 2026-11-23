// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử hai nguồn REST của bảng điều hành (dashboardSources.ts, ADR 0035): luật tên giá trị theo nguồn, khóa quy
// trình và tên NGSI-LD kiểm lại lúc chạy, đường dẫn đã gửi, cách đổi số hồ sơ, việc đang chờ người xem và entity
// thành dòng.

import { describe, expect, it } from "vitest";
import { type DashboardConfig, dashboardProblems, type Panel } from "./dashboardConfig";
import { contextRows, countRows, myTaskRows, type ProcessCounts, restPath, restProblems } from "./dashboardSources";
import type { Task } from "./workflow";

const base = { id: "p", title: "Khối", description: "Mô tả." };
const counts: Panel = {
  ...base,
  workflow: { process: "review", counts: "tenant" },
  cards: [
    { column: "open", label: "Còn mở", description: "Hồ sơ còn mở." },
    { column: "finished", label: "Đã xong", description: "Hồ sơ đã kết thúc." },
  ],
};
const readings: Panel = {
  ...base,
  context: { type: "Device", attribute: "level", limit: 10 },
  chart: {
    type: "bar",
    x: { column: "id", label: "Thiết bị" },
    y: [{ column: "value", label: "Mức", color: "blue" }],
    details: [{ column: "observedAt", label: "Lúc đo" }],
  },
};

function task(process: string, name: string, due: string | null): Task {
  return {
    id: `${process}-${name}-${due}`,
    name,
    tenant: "t",
    process,
    step: name,
    due,
    category: null,
    processInstanceId: "i",
    created: "2026-11-01T00:00:00Z",
    assignee: null,
    variables: {},
  };
}

describe("restProblems", () => {
  it("cấu hình đúng không có lỗi", () => {
    expect(restProblems(counts)).toEqual([]);
    expect(restProblems(readings)).toEqual([]);
  });

  it("việc của người xem không có số đã kết thúc; trục của biểu đồ số hồ sơ là bước", () => {
    expect(restProblems({ ...counts, workflow: { process: "review", counts: "mine" } })).toEqual([
      'Khối: cards không có giá trị "finished"; dùng open, overdue',
    ]);
    const chart = {
      type: "bar" as const,
      x: { column: "id", label: "X" },
      y: [{ column: "value", label: "Y", color: "teal" }],
    };
    expect(restProblems({ ...base, workflow: { process: "review", counts: "tenant" }, chart })).toEqual([
      'Khối: chart.x không có giá trị "id"; dùng step',
      'Khối: chart.y không có giá trị "value"; dùng open, overdue',
    ]);
  });

  it("khóa quy trình và tên NGSI-LD ghép vào đường dẫn được kiểm lại", () => {
    expect(restProblems({ ...counts, workflow: { process: "../tasks", counts: "tenant" } })).toEqual([
      'Khối: "../tasks" không phải khóa quy trình',
    ]);
    expect(restProblems({ ...readings, context: { type: "Device&q=x", attribute: "level" } })).toEqual([
      'Khối: "Device&q=x" không phải tên hợp lệ (chỉ chữ không dấu, số, gạch dưới)',
    ]);
  });

  it("dashboardProblems gồm lỗi của nguồn REST", () => {
    const wrong: Panel = { ...counts, cards: [{ column: "value", label: "X", description: "X." }] };
    const config: DashboardConfig = { title: "T", panels: [wrong] };
    expect(dashboardProblems(config)).toEqual(['Khối: cards không có giá trị "value"; dùng open, overdue, finished']);
  });
});

describe("restPath", () => {
  it("số hồ sơ cả đơn vị, việc của người xem, số đo thiết bị xin thừa một dòng", () => {
    expect(restPath(counts)).toBe("/v1/workflow/processes/review/counts");
    expect(restPath({ workflow: { process: "review", counts: "mine" } })).toBe("/v1/workflow/tasks");
    expect(restPath(readings)).toBe("/v1/context/entities?type=Device&attrs=level&limit=11");
  });
});

describe("countRows", () => {
  const data: ProcessCounts = {
    process: "review",
    open: 4,
    finished: 9,
    overdue: 2,
    steps: [
      { step: "a", name: "Bước A", open: 3, overdue: 2 },
      { step: "b", name: "Bước B", open: 0, overdue: 0 },
    ],
    counted_at: "2026-11-23T09:00:00Z",
  };

  it("thẻ số đọc một dòng tổng; biểu đồ mỗi bước một dòng theo tên, kể cả bước bằng 0", () => {
    expect(countRows(data, false)).toEqual([{ open: 4, overdue: 2, finished: 9 }]);
    expect(countRows(data, true)).toEqual([
      { step: "Bước A", open: 3, overdue: 2 },
      { step: "Bước B", open: 0, overdue: 0 },
    ]);
  });
});

describe("myTaskRows", () => {
  const now = Date.parse("2026-11-23T09:00:00Z");
  const tasks = [
    task("review", "Duyệt", "2026-11-22T00:00:00Z"),
    task("review", "Duyệt", null),
    task("review", "Bàn giao", "2026-11-30T00:00:00Z"),
    task("other", "Duyệt", "2026-11-01T00:00:00Z"),
  ];

  it("chỉ việc của quy trình trong cấu hình; quá hạn là có hạn trước lúc tải", () => {
    expect(myTaskRows(tasks, "review", now, false)).toEqual([{ open: 3, overdue: 1 }]);
    expect(myTaskRows([], "review", now, false)).toEqual([{ open: 0, overdue: 0 }]);
  });

  it("biểu đồ mỗi bước có việc một dòng, theo tên bước", () => {
    expect(myTaskRows(tasks, "review", now, true)).toEqual([
      { step: "Bàn giao", open: 1, overdue: 0 },
      { step: "Duyệt", open: 2, overdue: 1 },
    ]);
  });
});

describe("contextRows", () => {
  it("entity thiếu số đo không thành dòng; giá trị không phải số giữ nguyên; xếp theo id", () => {
    const entities = [
      {
        id: "urn:ngsi-ld:Device:b",
        type: "Device",
        level: { type: "Property", value: 71.5, observedAt: "2026-11-23T08:00:00Z" },
      },
      { id: "urn:ngsi-ld:Device:c", type: "Device", occupied: { type: "Property", value: true } },
      { id: "urn:ngsi-ld:Device:a", type: "Device", level: { type: "Property", value: false } },
    ];
    expect(contextRows(entities, "level")).toEqual([
      { id: "urn:ngsi-ld:Device:a", value: false, observedAt: null },
      { id: "urn:ngsi-ld:Device:b", value: 71.5, observedAt: "2026-11-23T08:00:00Z" },
    ]);
    expect(contextRows([], "level")).toEqual([]);
  });
});
