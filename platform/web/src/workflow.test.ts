// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử nhận ra task của tenant khác giao lên tenant của người đăng nhập (workflow.ts, ADR 0029).

import { describe, expect, it } from "vitest";
import { delegatedFrom, type Task } from "./workflow";

const task = (tenant: string): Task => ({
  id: "t1",
  name: "Quyết định",
  tenant,
  process: "p",
  step: "s",
  due: null,
  category: null,
  processInstanceId: "i1",
  created: "2026-11-23T00:00:00Z",
  assignee: null,
  variables: {},
});

describe("delegatedFrom", () => {
  it("không gắn nhãn task của chính tenant mình", () => {
    expect(delegatedFrom(task("parent"), ["parent"])).toBeUndefined();
  });

  it("trả mã tenant của task giao lên từ tenant khác", () => {
    expect(delegatedFrom(task("child"), ["parent"])).toBe("child");
  });

  it.each([undefined, null, "", []])("không gắn nhãn khi không đọc được tenant của mình (%j)", (profileTenant) => {
    expect(delegatedFrom(task("child"), profileTenant)).toBeUndefined();
  });

  it("đọc được claim tenant dạng chuỗi đơn", () => {
    expect(delegatedFrom(task("parent"), "parent")).toBeUndefined();
  });
});
