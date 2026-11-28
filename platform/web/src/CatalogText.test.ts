// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử tên tệp tải về của khối chữ trên màn hình chi tiết danh mục (CatalogText.tsx).

import { describe, expect, it } from "vitest";
import { textFileName } from "./CatalogText";

describe("tên tệp của khối chữ", () => {
  it("tiền tố cùng khóa, ký tự lạ thành gạch nối", () => {
    expect(textFileName("tin-cong-khai", "a1b2/c3 d")).toBe("tin-cong-khai-a1b2-c3-d.txt");
    expect(textFileName("tin", undefined)).toBe("tin.txt");
  });
});
