// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm bộ biến giao diện theo bản cài (ADR 0063): mọi tổ hợp màu chính, màu phụ, nền trang mà schema cho phép đạt AA
// ở mọi cặp chữ, nền của themeContrast.ts; bo góc và phông không đổi màu nào; sắc độ tự khai dưới AA bị bỏ; mọi tệp
// thương hiệu trong repo đọc được. Bộ biến mặc định giữ đúng theme trước ADR 0063 (theme.test.tsx đo riêng).

import { describe, expect, it, vi } from "vitest";
import {
  BRAND_BACKGROUNDS,
  BRAND_COLORS,
  BRAND_FONTS,
  BRAND_RADII,
  type ColorChoice,
  DEFAULT_BRANDING,
  parseBranding,
  type ThemeTokens,
} from "./branding";
import { contrast } from "./contrast";
import { contrastPairs, contrastProblems, lightTheme } from "./themeContrast";

const base: ThemeTokens = DEFAULT_BRANDING.theme;
const secondaries: (ColorChoice | undefined)[] = [undefined, ...BRAND_COLORS];

const combos = BRAND_COLORS.flatMap((color) =>
  secondaries.flatMap((secondaryColor) =>
    BRAND_BACKGROUNDS.map((background): [string, ThemeTokens] => [
      `${color}, phụ ${secondaryColor ?? "không"}, nền ${background}`,
      { ...base, color, background, ...(secondaryColor ? { secondaryColor } : {}) },
    ]),
  ),
);

describe("mọi tổ hợp màu và nền mà schema cho phép", () => {
  it("đủ số tổ hợp", () => {
    expect(combos).toHaveLength(BRAND_COLORS.length * secondaries.length * BRAND_BACKGROUNDS.length);
  });

  it.each(combos)("%s đạt AA", (_, tokens) => {
    const failing = contrastPairs(tokens).filter((pair) => contrast(pair.foreground, pair.background) < pair.minimum);
    expect(failing.map((pair) => pair.label)).toEqual([]);
  });
});

describe("bo góc và phông", () => {
  const colors = (tokens: ThemeTokens) =>
    Object.fromEntries(Object.entries(lightTheme(tokens).variables).filter(([name]) => name.includes("color")));

  it.each(BRAND_RADII.flatMap((radius) => BRAND_FONTS.map((font) => [radius, font] as const)))(
    "bo %s, phông %s không đổi biến màu nào",
    (radius, font) => {
      expect(colors({ ...base, radius, font })).toEqual(colors(base));
    },
  );

  it("bo góc đổi cả thang, thẻ gấp đôi nút", () => {
    const theme = (radius: ThemeTokens["radius"]) => lightTheme({ ...base, radius }).theme;
    expect(theme(4).radius).toMatchObject({ sm: "0.25rem", md: "0.5rem" });
    expect(theme(8).radius).toMatchObject({ sm: "0.5rem", md: "1rem" });
  });

  it("phông hệ điều hành không đứng sau Be Vietnam Pro", () => {
    const theme = lightTheme({ ...base, font: "system" }).theme;
    expect(theme.fontFamily).toMatch(/^system-ui/);
    expect(theme.headings.fontFamily).toBe(theme.fontFamily);
  });
});

describe("màu phụ", () => {
  it("mục menu đang chọn và nút phụ lấy màu phụ, nút chính giữ màu chính", () => {
    const { theme } = lightTheme({ ...base, secondaryColor: "grape" });
    expect(theme.primaryColor).toBe("blue");
    expect(theme.components.NavLink?.defaultProps).toMatchObject({ color: "grape" });
    const vars = theme.components.Button?.vars;
    expect(vars?.(theme, { variant: "light" }, {})).toMatchObject({
      root: { "--button-color": "var(--mantine-color-grape-light-color)" },
    });
    expect(vars?.(theme, { variant: "filled" }, {})).toEqual({ root: {} });
    expect(vars?.(theme, { variant: "subtle", color: "red" }, {})).toEqual({ root: {} });
  });

  it("không khai thì không đặt gì cho NavLink, Button", () => {
    const { theme } = lightTheme(base);
    expect(theme.components.NavLink).toBeUndefined();
    expect(theme.components.Button).toBeUndefined();
  });
});

// Sắc độ tự khai chỉ đo được lúc đọc tệp: schema nhận mọi mười mã màu.
describe("sắc độ tự khai", () => {
  const name = { name: "Đơn vị", short_name: "Đơn vị" };
  // Cam sáng: chữ trắng trên sắc 8 và liên kết sắc 8 trên nền trắng đều dưới 4,5:1.
  const bright = [
    "#fff4e6",
    "#ffe8cc",
    "#ffd8a8",
    "#ffc078",
    "#ffa94d",
    "#ff922b",
    "#fd7e14",
    "#f76707",
    "#f76707",
    "#e8590c",
  ];

  it("dưới AA thì bỏ cả tệp và báo cặp nào", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseBranding({ ...name, color: bright })).toBeNull();
    expect(warn.mock.calls[0]?.[0]).toMatch(/liên kết trên nền trắng \d/);
    warn.mockRestore();
  });

  it("làm màu phụ cũng bị đo", () => {
    // Màu phụ chỉ mang chữ của nút light, subtle (sắc 9 làm đậm 30%): cam sáng vẫn đạt, bảng quá nhạt thì không.
    expect(contrastProblems({ ...base, secondaryColor: bright })).toEqual([]);
    const pale = [
      "#fffaf5",
      "#fff4e6",
      "#ffeedb",
      "#ffe8cc",
      "#ffe2c0",
      "#ffdcb3",
      "#ffd6a8",
      "#ffd09c",
      "#ffca90",
      "#ffc485",
    ];
    expect(contrastProblems({ ...base, secondaryColor: pale })).toEqual(
      expect.arrayContaining([expect.stringMatching(/^chữ nút light, subtle accent trên nền trắng/)]),
    );
  });

  it("sai dạng thì bỏ", () => {
    expect(parseBranding({ ...name, color: bright.slice(0, 9) })).toBeNull();
    expect(parseBranding({ ...name, color: [...bright.slice(0, 9), "orange"] })).toBeNull();
  });
});

// Mọi tệp thương hiệu đi cùng repo (bản mặc định, ví dụ của hợp đồng, thư mục thương hiệu của các mẫu cài) phải đọc
// được: tệp qua schema mà dưới AA sẽ lặng lẽ rơi về thương hiệu mặc định lúc chạy.
describe("tệp thương hiệu trong repo", () => {
  const files = Object.entries(
    import.meta.glob<unknown>(
      [
        "../brand/branding.json",
        "../../../contracts/examples/branding.example.json",
        "../../../presets/*/brand/branding.json",
      ],
      { eager: true, import: "default" },
    ),
  );

  it("có tệp của mẫu cài", () => {
    expect(files.some(([file]) => file.includes("/presets/"))).toBe(true);
  });

  it.each(files)("%s đọc được", (_, content) => {
    expect(parseBranding(content)).not.toBeNull();
  });
});
