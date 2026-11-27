// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm tương phản WCAG 2 của màu mặc định (theme.ts) bằng công thức độ chói tương đối, không ước bằng mắt: mỗi màu
// được phép làm màu chính phải đạt AA (4,5:1 cho chữ thường) ở mọi chỗ Mantine dùng nó. Màu của từng chỗ lấy từ biến
// CSS mà Mantine sinh ra cho theme thật (bộ sinh mặc định cộng cssVariablesResolver), không chép số sắc độ vào đây:
// đổi theme hay nâng Mantine làm đổi màu thì kiểm thử đo màu mới.

import {
  Anchor,
  Badge,
  Card,
  DEFAULT_THEME,
  defaultCssVariablesResolver,
  MantineProvider,
  mergeMantineTheme,
  TextInput,
} from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BRAND_COLORS, type BrandColor, DEFAULT_BRANDING } from "./branding";
import { contrast } from "./contrast";
import { createAppTheme, cssVariablesResolver } from "./theme";
import themeCss from "./theme.css?raw";
import { TONE_COLOR, TONES } from "./tones";

const AA = 4.5;
// WCAG 2.2, 1.4.11: thành phần giao diện (đường viền ô nhập) cần 3:1 với màu kề bên.
const NON_TEXT = 3;
const WHITE = "#ffffff";

const shade = (color: string, index: number): string => {
  const value = DEFAULT_THEME.colors[color]?.[index];
  if (!value) throw new Error(`Mantine không có màu ${color}.${index}`);
  return value;
};

// Biến CSS của nền sáng như trình duyệt thấy (biến chung và biến riêng của nền sáng): biến của Mantine, rồi biến của
// theme.ts đè lên.
// Bộ biến mặc định với một màu chính; tổ hợp với các biến khác đo ở themeTokens.test.tsx.
const withColor = (color: BrandColor) => ({ ...DEFAULT_BRANDING.theme, color });

function appTheme(color: BrandColor) {
  const theme = mergeMantineTheme(DEFAULT_THEME, createAppTheme(withColor(color)));
  const mantine = defaultCssVariablesResolver(theme);
  const ours = cssVariablesResolver(theme);
  return { theme, variables: { ...mantine.variables, ...mantine.light, ...ours.variables, ...ours.light } };
}

const lightVariables = (color: BrandColor) => appTheme(color).variables;

// Đổi một giá trị (màu, hay var() trỏ qua vài biến khác) thành màu đọc được.
function resolveValue(variables: Record<string, string>, value: string): string {
  const reference = /^var\((--mantine-[a-z0-9-]+)\)$/.exec(value);
  if (!reference?.[1]) return value;
  const palette = /^--mantine-color-([a-z]+)-(\d)$/.exec(reference[1]);
  return palette?.[1] && palette[2] ? shade(palette[1], Number(palette[2])) : resolve(variables, reference[1]);
}

function resolve(variables: Record<string, string>, name: string): string {
  const value = variables[name];
  if (value === undefined) throw new Error(`Không có biến ${name}`);
  return resolveValue(variables, value);
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
  const p = (suffix: string) => resolve(variables, `--mantine-primary-color-${suffix}`);
  it.each([
    ["chữ trắng trên nút filled", WHITE, v("filled")],
    ["chữ trắng trên nút filled khi di chuột", WHITE, v("filled-hover")],
    ["liên kết trên nền trắng", resolve(variables, "--mantine-color-anchor"), WHITE],
    ["liên kết trên nền trang gray.0", resolve(variables, "--mantine-color-anchor"), shade("gray", 0)],
    ["chữ màu trên nền trắng", v("text"), WHITE],
    ["chữ màu trên nền trang gray.0", v("text"), shade("gray", 0)],
    ["chữ của nút light, subtle trên nền trắng", v("light-color"), WHITE],
    ["chữ của nút subtle trên nền trang gray.0", v("light-color"), shade("gray", 0)],
    ["chữ của nút light trên nền nhạt", v("light-color"), v("light")],
    ["chữ của nút light, subtle khi di chuột", v("light-color"), v("light-hover")],
    // NavLink đọc biến --mantine-primary-color-light* (styles/NavLink.css), không đọc biến theo tên màu.
    ["mục menu đang chọn", p("light-color"), p("light")],
    ["mục menu đang chọn khi di chuột", p("light-color"), p("light-hover")],
  ])("%s đạt AA", (_, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(AA);
  });
});

describe.each([
  ["chữ phụ (dimmed)", "--mantine-color-dimmed"],
  ["chữ gợi ý trong ô nhập (placeholder)", "--mantine-color-placeholder"],
])("%s", (_, name) => {
  const color = resolve(lightVariables("blue"), name);
  it.each([
    ["nền trắng", WHITE],
    ["nền trang gray.0", shade("gray", 0)],
  ])("đạt AA trên %s", (_, background) => {
    expect(contrast(color, background)).toBeGreaterThanOrEqual(AA);
  });
});

// Màu trạng thái (Alert, Badge, Notification dùng color=) qua đúng bộ chọn màu theo biến thể mà các thành phần đó gọi.
// Badge mặc định là filled, Alert mặc định là light.
describe.each(["green", "yellow", "orange", "red", "blue", "teal", "cyan", "lime", "gray"])(
  "màu trạng thái %s",
  (color) => {
    const { theme, variables } = appTheme("blue");
    const variant = (name: string) => {
      const colors = theme.variantColorResolver({ color, theme, variant: name });
      return {
        background: resolveValue(variables, colors.background ?? ""),
        hover: resolveValue(variables, colors.hover ?? ""),
        text: resolveValue(variables, colors.color ?? ""),
      };
    };
    const filled = variant("filled");
    const light = variant("light");
    it.each([
      ["chữ của Badge, nút filled", filled.text, filled.background],
      ["chữ của nút filled khi di chuột", filled.text, filled.hover],
      ["chữ của Alert, Badge light trên nền nhạt", light.text, light.background],
      ["chữ của nút light khi di chuột", light.text, light.hover],
      ["chữ của nút subtle trên nền trắng", light.text, WHITE],
    ])("%s đạt AA", (_, foreground, background) => {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(AA);
    });
  },
);

// Bộ nghĩa màu chung của nhãn trạng thái (tones.ts): StatusBadge dùng biến thể light, nhãn nằm trên thẻ trắng hay trên
// nền trang. Lặp theo bảng thật, không chép danh sách màu.
describe.each(TONES)("nghĩa %s", (tone) => {
  const { theme, variables } = appTheme("blue");
  const light = theme.variantColorResolver({ color: TONE_COLOR[tone], theme, variant: "light" });
  const text = resolveValue(variables, light.color ?? "");
  it.each([
    ["nền nhạt của nhãn", resolveValue(variables, light.background ?? "")],
    ["nền trắng", WHITE],
    ["nền trang gray.0", shade("gray", 0)],
  ])("chữ của nhãn đạt AA trên %s", (_, background) => {
    expect(contrast(text, background)).toBeGreaterThanOrEqual(AA);
  });
});

describe("mỗi nghĩa một màu", () => {
  it("không hai nghĩa chung màu", () => {
    expect(new Set(Object.values(TONE_COLOR)).size).toBe(TONES.length);
  });
});

// Viền ô nhập và nền trang đặt qua biến riêng mà theme.css đọc (Mantine viết cứng hai giá trị này trong CSS của nó).
describe("Bento dịu", () => {
  const { theme, variables } = appTheme("blue");
  const css = themeCss;

  it.each([
    ["nền trắng của ô nhập", WHITE],
    ["nền trang gray.0", shade("gray", 0)],
  ])("viền ô nhập đạt 3:1 trên %s", (_, background) => {
    expect(contrast(resolve(variables, "--mortise-input-border"), background)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it("viền ô nhập mặc định của Mantine (gray.4) dưới 3:1, lý do đổi", () => {
    expect(contrast(shade("gray", 4), WHITE)).toBeLessThan(NON_TEXT);
  });

  // Bộ chọn của theme.css dựa vào lớp tĩnh và data-variant mà Mantine gắn lên khung ô nhập; nâng Mantine mà đổi tên
  // lớp thì viền lặng lẽ quay về gray.4, nên kiểm trên ô nhập thật.
  it("khung ô nhập mang lớp và biến thể mà theme.css chọn", () => {
    const html = renderToStaticMarkup(
      <MantineProvider>
        <TextInput label="a" />
      </MantineProvider>,
    );
    expect(html).toMatch(/class="[^"]*\bmantine-Input-wrapper\b[^"]*"[^>]*data-variant="default"/);
    expect(css).toContain('.mantine-Input-wrapper[data-variant="default"]');
  });

  it("theme.css dùng hai biến đó", () => {
    expect(css).toContain("--input-bd: var(--mortise-input-border)");
    expect(css).toContain("background-color: var(--mortise-page-background");
    expect(resolve(variables, "--mortise-page-background")).toBe(shade("gray", 0));
  });

  it("thẻ viền 1px không bóng, bo 12px; nút, ô nhập, nhãn bo 6px", () => {
    expect(theme.components.Card?.defaultProps).toMatchObject({ withBorder: true, radius: "md" });
    expect(theme.components.Card?.defaultProps).not.toHaveProperty("shadow");
    expect(theme.radius.md).toBe("0.75rem");
    expect(theme.defaultRadius).toBe("sm");
    expect(theme.radius.sm).toBe("0.375rem");
    expect(theme.components.Badge?.defaultProps).toMatchObject({ radius: "sm" });
  });

  it("theme thật vẽ nhãn bo 6px chữ 600, liên kết gạch chân, thẻ không bóng", () => {
    const html = renderToStaticMarkup(
      <MantineProvider theme={createAppTheme(withColor("blue"))}>
        <Badge>x</Badge>
        <Anchor href="/x">y</Anchor>
        <Card>z</Card>
      </MantineProvider>,
    );
    expect(html).toMatch(/--badge-radius:var\(--mantine-radius-sm\)/);
    expect(html).toMatch(/font-weight:600/);
    expect(html).toContain('data-underline="always"');
    expect(html).not.toMatch(/--card-shadow|--paper-shadow/);
  });

  it("liên kết luôn gạch chân", () => {
    expect(theme.components.Anchor?.defaultProps).toMatchObject({ underline: "always" });
  });

  it("Be Vietnam Pro trước phông hệ điều hành, tiêu đề đậm 800, nhãn 600", () => {
    expect(theme.fontFamily).toMatch(/^"Be Vietnam Pro", system-ui/);
    expect(theme.headings.fontFamily).toBe(theme.fontFamily);
    expect(theme.headings.fontWeight).toBe("800");
    expect(theme.components.Badge?.defaultProps).toMatchObject({ fw: 600 });
  });
});

// Hộp thoại không vẽ được ở đây (cổng và hiệu ứng chỉ chạy trên trình duyệt; e2e/visual.spec.ts chạy axe trên hộp
// thật), nên chỉ kiểm giá trị mặc định mà ModalHeader nhận từ theme.
describe("đầu hộp thoại", () => {
  it("không là vùng banner thứ hai cạnh thanh trên của trang", () => {
    const theme = mergeMantineTheme(DEFAULT_THEME, createAppTheme(withColor("blue")));
    expect(theme.components.ModalHeader?.defaultProps).toMatchObject({ role: "none" });
  });
});
