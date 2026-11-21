// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm cấu hình của thành phần trợ lý lúc chạy: cấu hình đọc từ CSDL, nên sai dạng thì báo lý do thay vì gửi câu hỏi.

import { describe, expect, it } from "vitest";
import { configProblems } from "./assistant";

describe("configProblems", () => {
  it("nhận cấu hình đúng hợp đồng", () => {
    expect(configProblems({ intro: "Hỏi", examples: ["Câu mẫu?"], documents: ["doc-a", "doc-b"] })).toEqual([]);
  });

  it("báo thiếu intro và documents", () => {
    expect(configProblems({})).toEqual([
      "thiếu lời giới thiệu (intro)",
      "thiếu danh sách văn bản được hỏi (documents)",
    ]);
  });

  it("báo mã văn bản không đúng dạng và examples không phải danh sách", () => {
    expect(configProblems({ intro: "Hỏi", documents: ["Doc A"], examples: "Câu mẫu?" })).toEqual([
      "mã văn bản trong documents phải là chữ thường, số, gạch ngang",
      "examples phải là danh sách câu hỏi",
    ]);
  });
});
