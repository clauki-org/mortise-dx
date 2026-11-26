// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm tương phản WCAG 2 của màu mặc định (theme.ts) bằng công thức độ chói tương đối, không ước bằng mắt: mỗi màu
// được phép làm màu chính phải đạt AA (4,5:1 cho chữ thường) ở mọi chỗ Mantine dùng nó, theo biến CSS của Mantine 9.

import { DEFAULT_THEME } from "@mantine/core";
import { describe, expect, it } from "vitest";
import { BRAND_COLORS } from "./branding";
import { DIMMED_SHADE, PRIMARY_SHADE } from "./theme";

const AA = 4.5;
const WHITE = "#ffffff";

// Độ chói tương đối của một màu sRGB dạng #rrggbb (WCAG 2.2, định nghĩa "relative luminance").
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const shade = (color: string, index: number): string => {
  const value = DEFAULT_THEME.colors[color]?.[index];
  if (!value) throw new Error(`Mantine không có màu ${color}.${index}`);
  return value;
};

describe("công thức tương phản", () => {
  it("khớp giá trị chuẩn", () => {
    expect(contrast("#000000", WHITE)).toBeCloseTo(21, 5);
    expect(contrast(WHITE, WHITE)).toBeCloseTo(1, 5);
    // Lý do đổi màu mặc định: teal.6 của Mantine với chữ trắng.
    expect(contrast(shade("teal", 6), WHITE)).toBeLessThan(3);
  });
});

describe.each(BRAND_COLORS)("màu chính %s", (color) => {
  const hoverShade = PRIMARY_SHADE === 9 ? 8 : PRIMARY_SHADE + 1;
  it.each([
    ["chữ trắng trên nút filled", WHITE, shade(color, PRIMARY_SHADE)],
    ["chữ trắng trên nút filled khi di chuột", WHITE, shade(color, hoverShade)],
    ["liên kết và chữ màu trên nền trắng", shade(color, PRIMARY_SHADE), WHITE],
    ["chữ màu trên nền trang gray.0", shade(color, PRIMARY_SHADE), shade("gray", 0)],
    ["chữ của nút light, subtle trên nền trắng", shade(color, 9), WHITE],
    // Nền nhạt là sắc 1 cả khi di chuột (cssVariablesResolver trong theme.ts).
    ["chữ của nút light, mục menu đang chọn trên nền nhạt", shade(color, 9), shade(color, 1)],
  ])("%s đạt AA", (_, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(AA);
  });
});

describe("chữ phụ (dimmed)", () => {
  it.each([
    ["nền trắng", WHITE],
    ["nền trang gray.0", shade("gray", 0)],
  ])("đạt AA trên %s", (_, background) => {
    expect(contrast(shade("gray", DIMMED_SHADE), background)).toBeGreaterThanOrEqual(AA);
  });
});
