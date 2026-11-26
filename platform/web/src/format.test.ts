// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm định dạng dùng chung (format.ts): ngày giờ và số theo vi-VN, năm đủ bốn chữ số, ngày không giờ đọc theo UTC,
// chuỗi không đọc được hiện nguyên.

import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatNumber, formatRounded } from "./format";

describe("format", () => {
  it("ngày giờ có năm bốn chữ số", () => {
    expect(formatDateTime("2026-11-01T08:30:00")).toBe("08:30 01/11/2026");
  });

  it("ngày không giờ không lùi ngày ở múi giờ phía tây", () => {
    expect(formatDate("2026-11-17")).toBe("17/11/2026");
    expect(formatDate("1820-01-01")).toBe("01/01/1820");
  });

  it("chuỗi không phải ngày hiện nguyên", () => {
    expect(formatDateTime("chưa rõ")).toBe("chưa rõ");
    expect(formatDate("chưa rõ")).toBe("chưa rõ");
  });

  it("số theo kiểu Việt Nam", () => {
    expect(formatNumber(1234.5)).toBe("1.234,5");
    expect(formatRounded(1.25)).toBe("1,3");
  });
});
