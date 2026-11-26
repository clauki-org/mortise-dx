// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm tương phản WCAG 2 của màu mặc định (theme.ts) bằng công thức độ chói tương đối, không ước bằng mắt: mỗi màu
// được phép làm màu chính phải đạt AA (4,5:1 cho chữ thường) ở mọi chỗ Mantine dùng nó. Màu của từng chỗ lấy từ biến
// CSS mà Mantine sinh ra cho theme thật (bộ sinh mặc định cộng cssVariablesResolver), không chép số sắc độ vào đây:
// đổi theme hay nâng Mantine làm đổi màu thì kiểm thử đo màu mới.

import { DEFAULT_THEME, defaultCssVariablesResolver, mergeMantineTheme } from "@mantine/core";
import { describe, expect, it } from "vitest";
import { BRAND_COLORS } from "./branding";
import { createAppTheme, cssVariablesResolver } from "./theme";

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

// Biến CSS của nền sáng như trình duyệt thấy: biến của Mantine, rồi biến của theme.ts đè lên.
function lightVariables(color: (typeof BRAND_COLORS)[number]): Record<string, string> {
  const theme = mergeMantineTheme(DEFAULT_THEME, createAppTheme(color));
  return { ...defaultCssVariablesResolver(theme).light, ...cssVariablesResolver(theme).light };
}

// Đổi một biến (có thể trỏ qua vài biến khác) thành mã màu #rrggbb.
function resolve(variables: Record<string, string>, name: string): string {
  const value = variables[name];
  if (value === undefined) throw new Error(`Không có biến ${name}`);
  const reference = /^var\((--mantine-color-[a-z]+-\d|--mantine-color-[a-z-]+)\)$/.exec(value);
  if (!reference?.[1]) return value;
  const palette = /^--mantine-color-([a-z]+)-(\d)$/.exec(reference[1]);
  return palette?.[1] && palette[2] ? shade(palette[1], Number(palette[2])) : resolve(variables, reference[1]);
}

describe("công thức tương phản", () => {
  it("khớp giá trị chuẩn", () => {
    expect(contrast("#000000", WHITE)).toBeCloseTo(21, 5);
    expect(contrast(WHITE, WHITE)).toBeCloseTo(1, 5);
    // Lý do đổi màu mặc định: teal.6 của Mantine với chữ trắng.
    expect(contrast(shade("teal", 6), WHITE)).toBeLessThan(3);
  });
});

describe.each(BRAND_COLORS)("màu chính %s", (color) => {
  const variables = lightVariables(color);
  const v = (suffix: string) => resolve(variables, `--mantine-color-${color}-${suffix}`);
  it.each([
    ["chữ trắng trên nút filled", WHITE, v("filled")],
    ["chữ trắng trên nút filled khi di chuột", WHITE, v("filled-hover")],
    ["liên kết trên nền trắng", resolve(variables, "--mantine-color-anchor"), WHITE],
    ["chữ màu trên nền trắng", v("text"), WHITE],
    ["chữ màu trên nền trang gray.0", v("text"), shade("gray", 0)],
    ["chữ của nút light, subtle trên nền trắng", v("light-color"), WHITE],
    ["chữ của nút light, mục menu đang chọn trên nền nhạt", v("light-color"), v("light")],
    ["chữ của nút light, subtle khi di chuột", v("light-color"), v("light-hover")],
  ])("%s đạt AA", (_, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(AA);
  });
});

describe("chữ phụ (dimmed)", () => {
  const dimmed = resolve(lightVariables("blue"), "--mantine-color-dimmed");
  it.each([
    ["nền trắng", WHITE],
    ["nền trang gray.0", shade("gray", 0)],
  ])("đạt AA trên %s", (_, background) => {
    expect(contrast(dimmed, background)).toBeGreaterThanOrEqual(AA);
  });
});
