// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử thông tin hồ sơ theo `details` của bước (contracts/workflow.schema.json): người xử lý thấy các giá trị người
// lập điền, theo thứ tự khai, kể cả khi khai báo đọc từ CSDL sai dạng.

import { describe, expect, it } from "vitest";
import { CASE_FIELD, caseContext, detailRows, stepUi } from "./steps";
import type { StepConfig, Task } from "./workflow";

const task = {
  id: "t1",
  name: "Duyệt",
  process: "core-approval",
  step: "review",
  due: null,
  category: null,
  processInstanceId: "p1",
  created: "2026-11-22T00:00:00Z",
  assignee: null,
  tenant: "xa-a",
  variables: { amount: 1234.5, note: "Gấp", urgent: true, empty: "" },
} satisfies Task;

const step = (details: unknown): StepConfig => ({ actions: [], details }) as StepConfig;

describe("details của bước", () => {
  it("hiện biến theo thứ tự khai; số và đúng sai viết cho người đọc; bỏ biến chưa có giá trị", () => {
    const declared = [
      { variable: "note", label: "Ghi chú" },
      { variable: "amount", label: "Số lượng" },
      { variable: "urgent", label: "Gấp" },
      { variable: "empty", label: "Trống" },
      { variable: "missing", label: "Chưa có" },
    ];
    expect(detailRows(task, step(declared))).toEqual([
      ["note", "Ghi chú", "Gấp"],
      ["amount", "Số lượng", "1.234,5"],
      ["urgent", "Gấp", "Có"],
    ]);
  });

  it("khai báo sai dạng thì bỏ qua thay vì làm hỏng màn hình", () => {
    expect(detailRows(task, step("amount"))).toEqual([]);
    expect(detailRows(task, step([null, { variable: 1, label: "x" }]))).toEqual([]);
    expect(detailRows(task, undefined)).toEqual([]);
  });

  it("biến khai hai lần chỉ hiện một dòng, để mỗi dòng có khóa riêng", () => {
    const declared = [
      { variable: "note", label: "Ghi chú" },
      { variable: "note", label: "Ghi chú lại" },
    ];
    expect(detailRows(task, step(declared))).toEqual([["note", "Ghi chú", "Gấp"]]);
  });
});

describe("danh sách chọn của bước (sources)", () => {
  const step: StepConfig = {
    form: { type: "object", properties: { unit: { type: "string", description: "Bỏ trống nếu không có" } } },
    ui: { unit: { "ui:placeholder": "x" } },
    actions: [{ id: "send", label: "Gửi", variables: {} }],
    sources: {
      unit: { table: "app_x_rows", value: "code", label: "name", case: "case_id", order: "rank", role: "manager" },
      missing: { table: "app_x_rows", value: "code", label: "name", case: "case_id", role: "manager" },
    },
  };

  it("ô chọn lọc theo mã hồ sơ, xếp theo order, mang vai trò và gợi ý; trường không có trong biểu mẫu bị bỏ", () => {
    expect(stepUi(step)).toEqual({
      unit: {
        "ui:placeholder": "x",
        "ui:widget": "sourceChoice",
        "ui:options": {
          source: {
            table: "app_x_rows",
            value: "code",
            label: "name",
            where: { column: "case_id", field: CASE_FIELD },
            order: "rank",
          },
          role: "manager",
          description: "Bỏ trống nếu không có",
        },
      },
    });
    expect(caseContext(task)).toEqual({ [CASE_FIELD]: "p1" });
  });
});
