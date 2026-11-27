// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Đo tương phản của một bộ biến giao diện (ADR 0063) trên theme thật: dựng theme bằng createAppTheme, lấy biến CSS mà
// Mantine sinh (bộ sinh mặc định cộng cssVariablesResolver) rồi đo từng cặp chữ và nền mà giao diện dùng. branding.ts
// gọi khi đọc /branding.json để bỏ tệp có tổ hợp dưới AA; themeTokens.test.ts gọi cho mọi tổ hợp mà schema cho phép.

import { DEFAULT_THEME, defaultCssVariablesResolver, type MantineTheme, mergeMantineTheme } from "@mantine/core";
import type { ThemeTokens } from "./branding";
import { contrast } from "./contrast";
import { CUSTOM_SECONDARY, createAppTheme, cssVariablesResolver } from "./theme";
import { TONE_COLOR, TONES } from "./tones";

export const AA = 4.5;
// WCAG 2.2, 1.4.11: thành phần giao diện (đường viền ô nhập) cần 3:1 với màu kề bên.
export const NON_TEXT = 3;
const WHITE = "#ffffff";

export type ContrastPair = { label: string; foreground: string; background: string; minimum: number };

type Variables = Record<string, string>;

// Biến CSS của nền sáng như trình duyệt thấy: biến của Mantine, rồi biến của theme.ts đè lên.
export function lightTheme(tokens: ThemeTokens): { theme: MantineTheme; variables: Variables } {
  const theme = mergeMantineTheme(DEFAULT_THEME, createAppTheme(tokens));
  const mantine = defaultCssVariablesResolver(theme);
  const ours = cssVariablesResolver(theme);
  return { theme, variables: { ...mantine.variables, ...mantine.light, ...ours.variables, ...ours.light } };
}

// Đổi một giá trị (màu, hay var() trỏ qua vài biến khác) thành mã màu. Sắc độ đọc từ bảng màu của chính theme, nên
// sắc độ tự khai của bản cài cũng đọc được.
export function resolveValue(theme: MantineTheme, variables: Variables, value: string): string {
  const reference = /^var\((--(?:mantine|mortise)-[a-z0-9-]+)\)$/.exec(value);
  if (!reference?.[1]) return value;
  const palette = /^--mantine-color-([a-z]+)-(\d)$/.exec(reference[1]);
  if (palette?.[1] && palette[2]) {
    const shade = theme.colors[palette[1]]?.[Number(palette[2])];
    if (!shade) throw new Error(`Theme không có màu ${palette[1]}.${palette[2]}`);
    return shade;
  }
  const next = variables[reference[1]];
  if (next === undefined) {
    if (reference[1] === "--mantine-color-white") return theme.white;
    throw new Error(`Không có biến ${reference[1]}`);
  }
  return resolveValue(theme, variables, next);
}

type Pair = readonly [string, string, string];

// Chữ của nút light, subtle và mục menu đang chọn: màu chính khi bản cài không khai màu phụ, màu phụ khi có.
function lightPairs(theme: MantineTheme, at: (value: string) => string, color: string, page: string): Pair[] {
  const light = theme.variantColorResolver({ color, theme, variant: "light" });
  const text = at(light.color ?? "");
  return [
    [`chữ nút light, subtle ${color} trên nền trắng`, text, WHITE],
    [`chữ nút subtle ${color} trên nền trang`, text, page],
    [`chữ nút light, mục menu ${color} trên nền nhạt`, text, at(light.background ?? "")],
    [`chữ nút light, subtle, mục menu ${color} khi di chuột`, text, at(light.hover ?? "")],
  ];
}

// Chỉ màu chính mang nút filled và chữ màu (color= không ghi màu, liên kết).
function primaryPairs(theme: MantineTheme, at: (value: string) => string, page: string): Pair[] {
  const color = theme.primaryColor;
  const filled = theme.variantColorResolver({ color, theme, variant: "filled" });
  const text = at(`var(--mantine-color-${color}-text)`);
  return [
    [`chữ trên nút filled ${color}`, at(filled.color ?? ""), at(filled.background ?? "")],
    [`chữ trên nút filled ${color} khi di chuột`, at(filled.color ?? ""), at(filled.hover ?? "")],
    [`chữ màu ${color} trên nền trắng`, text, WHITE],
    [`chữ màu ${color} trên nền trang`, text, page],
  ];
}

export function contrastPairs(tokens: ThemeTokens): ContrastPair[] {
  const { theme, variables } = lightTheme(tokens);
  const at = (value: string) => resolveValue(theme, variables, value);
  const v = (name: string) => at(`var(${name})`);
  const page = v("--mortise-page-background");
  const text: Pair[] = [
    ...primaryPairs(theme, at, page),
    ...lightPairs(theme, at, theme.primaryColor, page),
    ["liên kết trên nền trắng", v("--mantine-color-anchor"), WHITE],
    ["liên kết trên nền trang", v("--mantine-color-anchor"), page],
    ["chữ phụ trên nền trắng", v("--mantine-color-dimmed"), WHITE],
    ["chữ phụ trên nền trang", v("--mantine-color-dimmed"), page],
    ["chữ gợi ý trong ô nhập trên nền trắng", v("--mantine-color-placeholder"), WHITE],
    ["chữ gợi ý trong ô nhập trên nền trang", v("--mantine-color-placeholder"), page],
  ];
  // Màu phụ mang mục menu đang chọn và nút phụ (theme.ts). Không khai thì mục menu đọc biến của màu chính.
  const secondary = tokens.secondaryColor;
  if (secondary)
    text.push(...lightPairs(theme, at, typeof secondary === "string" ? secondary : CUSTOM_SECONDARY, page));
  else
    text.push(
      ["mục menu đang chọn", v("--mantine-primary-color-light-color"), v("--mantine-primary-color-light")],
      [
        "mục menu đang chọn khi di chuột",
        v("--mantine-primary-color-light-color"),
        v("--mantine-primary-color-light-hover"),
      ],
    );
  // Nhãn trạng thái (tones.ts) nằm trên thẻ trắng hay trực tiếp trên nền trang.
  for (const tone of TONES) {
    const light = theme.variantColorResolver({ color: TONE_COLOR[tone], theme, variant: "light" });
    text.push([`nhãn ${tone} trên nền trang`, at(light.color ?? ""), page]);
  }
  return [
    ...text.map(([label, foreground, background]) => ({ label, foreground, background, minimum: AA })),
    {
      label: "viền ô nhập trên nền trắng",
      foreground: v("--mortise-input-border"),
      background: WHITE,
      minimum: NON_TEXT,
    },
    {
      label: "viền ô nhập trên nền trang",
      foreground: v("--mortise-input-border"),
      background: page,
      minimum: NON_TEXT,
    },
  ];
}

// Các cặp dưới mức, kèm tỷ lệ đo được để người vận hành biết sửa sắc nào. Rỗng là bộ biến đạt AA.
export function contrastProblems(tokens: ThemeTokens): string[] {
  return contrastPairs(tokens)
    .map((pair) => ({ ...pair, ratio: contrast(pair.foreground, pair.background) }))
    .filter((pair) => pair.ratio < pair.minimum)
    .map((pair) => `${pair.label} ${pair.ratio.toFixed(2)}:1 (cần ${pair.minimum}:1)`);
}
