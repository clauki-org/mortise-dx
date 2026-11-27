// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử phần thuần của thành phần theo dõi hồ sơ (ADR 0032): lỗi cấu hình, tên hồ sơ và dòng thông tin theo khai
// báo bước, nhãn nhóm xử lý của tenant cha, đường tới hồ sơ vừa lập.

import { describe, expect, it } from "vitest";
import {
  type CaseSummary,
  type CasesConfig,
  caseDetails,
  caseStatus,
  casesPathFor,
  casesProblems,
  caseTitle,
  groupLabel,
  processSteps,
} from "./cases";
import type { MenuItem } from "./menu";
import type { StepConfig } from "./workflow";

const item: CaseSummary = {
  id: "p1",
  process: "supply-request",
  started: "2026-11-23T09:00:00Z",
  ended: null,
  outcome: null,
  outcomeName: null,
  current: [{ step: "approve", name: "Duyệt", due: null }],
  variables: { title: "Đề nghị", quantity: 3, blank: "" },
};

const steps = new Map<string, StepConfig>([
  ["other/approve", { actions: [], title: "name" }],
  [
    "supply-request/approve",
    {
      actions: [],
      title: "title",
      details: [
        { variable: "quantity", label: "Số lượng" },
        { variable: "comment", label: "Ý kiến" },
        { variable: "blank", label: "Trống" },
      ],
    },
  ],
  ["supply-request/check", { actions: [], details: [{ variable: "quantity", label: "Lặp lại" }] }],
]);

describe("cấu hình theo dõi hồ sơ", () => {
  it("báo thiếu quy trình và khóa không phải slug", () => {
    expect(casesProblems({ title: "x", processes: [] })).toEqual(["chưa khai quy trình nào ở processes"]);
    expect(casesProblems({ title: "x", processes: ["a", "a&state=all"] })).toEqual([
      '"a&state=all" không phải khóa quy trình',
    ]);
    expect(casesProblems({ title: "x" } as CasesConfig)).toHaveLength(1);
  });
});

describe("hồ sơ theo khai báo bước", () => {
  const declared = processSteps(steps, "supply-request");

  it("chỉ lấy bước của đúng quy trình", () => {
    expect(declared).toHaveLength(2);
  });

  it("tên hồ sơ theo title; không có giá trị thì undefined", () => {
    expect(caseTitle(item, declared)).toBe("Đề nghị");
    expect(caseTitle({ ...item, variables: {} }, declared)).toBeUndefined();
  });

  it("dòng thông tin theo details, mỗi biến một lần, bỏ biến workflow-api không trả", () => {
    expect(caseDetails(item, declared)).toEqual([["quantity", "Số lượng", "3"]]);
  });

  it("bước đang chờ, kết quả, hay dừng giữa chừng", () => {
    expect(caseStatus(item)).toBe("Duyệt");
    expect(caseStatus({ ...item, ended: "x", outcome: "approved", outcomeName: "Đã duyệt" })).toBe("Đã duyệt");
    expect(caseStatus({ ...item, ended: "x", current: [] })).toBe("Đã dừng");
  });
});

describe("nhóm xử lý", () => {
  it("nhóm của tenant cha tách ở dấu / cuối", () => {
    expect(groupLabel("manager")).toBe("Vai trò manager");
    expect(groupLabel("tinh-mau/manager")).toBe("Đơn vị tinh-mau, vai trò manager");
    expect(groupLabel("a/b/manager")).toBe("Đơn vị a/b, vai trò manager");
  });
});

describe("đường tới hồ sơ vừa lập", () => {
  const menu = (app: string, component: string, config: unknown): MenuItem => ({
    app,
    app_name: null,
    item: `${component}-item`,
    label: "x",
    component,
    config,
    roles: null,
    icon: null,
    on_menu: true,
  });

  it("chỉ mục cases của cùng gói liệt kê quy trình đó", () => {
    const items = [
      menu("khac", "cases", { processes: ["supply-request"] }),
      menu("goi", "form", { processes: ["supply-request"] }),
      menu("goi", "cases", { processes: ["supply-request"] }),
    ];
    expect(casesPathFor(items, "goi", "supply-request", "p/1")).toBe("/apps/goi/cases-item/p%2F1");
    expect(casesPathFor(items, "goi", "other", "p1")).toBeUndefined();
    expect(casesPathFor([menu("goi", "cases", null)], "goi", "supply-request", "p1")).toBeUndefined();
  });
});
