// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Bộ quy ước giao diện dùng chung (ADR 0043, kiểu "Bento dịu" của ADR 0048): một thang cỡ chữ, một thang khoảng cách,
// bo góc, bóng và kiểu mặc định của thẻ, khung, bảng. Thành phần chỉ chọn bậc trong các thang này (size="sm", p="md"), không đặt số riêng. Màu chính,
// màu phụ, bo góc, phông và nền trang đến từ biến giao diện của bản cài (branding.ts, ADR 0063); theme.test.tsx và
// themeTokens.test.ts kiểm tương phản của mọi tổ hợp được phép.

import {
  Anchor,
  Badge,
  Button,
  Card,
  type CSSVariablesResolver,
  createTheme,
  darken,
  isLightColor,
  type MantineColorShade,
  type MantineColorsTuple,
  type MantineTheme,
  ModalHeader,
  NavLink,
  Paper,
  Table,
} from "@mantine/core";
import type { ColorChoice, ThemeTokens } from "./branding";

// Sắc độ của màu dùng làm nền nút và chữ màu trên nền trắng. Mặc định của Mantine là 6: teal.6 với chữ trắng chỉ
// khoảng 2,5:1. Sắc 8 (di chuột sang 9) đạt AA với mọi màu trong BRAND_COLORS.
const PRIMARY_SHADE: MantineColorShade = 8;

// Chữ phụ (c="dimmed"): mặc định của Mantine là gray.6, khoảng 3,3:1 trên nền trắng, dưới mức AA.
const DIMMED_SHADE: MantineColorShade = 7;

// Chữ trắng đạt 4,5:1 khi độ chói của nền không quá 0,1833, chữ đen khi từ 0,175 trở lên; ngưỡng ở giữa thì nền nào
// cũng có một màu chữ đạt AA. Màu thương hiệu đều dưới ngưỡng ở sắc 8 nên giữ chữ trắng.
const LUMINANCE_THRESHOLD = 0.183;

// Mức làm đậm chữ của biến thể light so với sắc 9 (cssVariablesResolver ở dưới).
const LIGHT_TEXT_DARKEN = 0.3;

// Viền ô nhập (theme.css đọc qua --mortise-input-border): mặc định của Mantine là gray.4, khoảng 1,5:1 trên nền trắng,
// dưới mức 3:1 mà WCAG 1.4.11 đòi cho đường viền giúp nhận ra ô.
const INPUT_BORDER_SHADE: MantineColorShade = 6;

// Nền sắc 0 của màu chính (`background: "tint"`) sẫm hơn gray.0 với blue, indigo, violet, grape: viền gray.6 chỉ còn
// khoảng 2,96:1 trên các nền đó, nên trên nền này viền đậm lên một sắc.
const TINT_INPUT_BORDER_SHADE: MantineColorShade = 7;

// Nền trang (theme.css đọc qua --mortise-page-background). Không đổi --mantine-color-body: Paper, Card, hộp thoại và
// thanh trên cũng tô bằng biến đó, nên ô trắng sẽ xám theo nền.
const PAGE_BACKGROUND: Record<ThemeTokens["background"], string> = {
  gray: "var(--mantine-color-gray-0)",
  white: "var(--mantine-color-white)",
  tint: "var(--mantine-primary-color-0)",
};

// Tên bảng màu Mantine của sắc độ tự khai (biến CSS là --mantine-color-brand-*, --mantine-color-accent-*).
export const CUSTOM_PRIMARY = "brand";
export const CUSTOM_SECONDARY = "accent";

// Thang bo góc theo bo góc của nút (bậc sm); thẻ, khung (bậc md) gấp đôi. Bậc 6 là thang của ADR 0048.
const RADIUS_SCALES: Record<ThemeTokens["radius"], MantineTheme["radius"]> = {
  4: { xs: "0.125rem", sm: "0.25rem", md: "0.5rem", lg: "0.75rem", xl: "1rem" },
  6: { xs: "0.25rem", sm: "0.375rem", md: "0.75rem", lg: "1rem", xl: "1.25rem" },
  8: { xs: "0.25rem", sm: "0.5rem", md: "1rem", lg: "1.25rem", xl: "1.5rem" },
};

// Be Vietnam Pro đóng gói cùng giao diện (main.tsx nạp ba độ đậm 400, 600, 800 từ @fontsource), phục vụ cùng origin
// nên CSP không phải mở thêm nguồn. Trình duyệt chưa tải xong hay không tải được phông thì dùng phông của hệ điều
// hành theo thứ tự dưới.
const SYSTEM_FONTS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, "Liberation Sans", sans-serif';
const FONT_FAMILIES: Record<ThemeTokens["font"], string> = {
  "be-vietnam-pro": `"Be Vietnam Pro", ${SYSTEM_FONTS}`,
  system: SYSTEM_FONTS,
};

// Chỉ ba độ đậm có tệp phông: chữ thường, chữ nhấn (nhãn, nút), tiêu đề. Độ đậm khác trình duyệt lấy tệp gần nhất.
const FONT_WEIGHTS = { regular: 400, emphasis: 600, heading: 800 } as const;

// Tên bảng màu cho Mantine và bảng sắc độ cần thêm vào theme khi màu là sắc độ tự khai.
function paletteOf(choice: ColorChoice, customName: string): [string, Record<string, MantineColorsTuple>] {
  return typeof choice === "string"
    ? [choice, {}]
    : [customName, { [customName]: choice as unknown as MantineColorsTuple }];
}

// Nút light, subtle không ghi color là nút phụ (ADR 0047): khi bản cài khai màu phụ, chúng và mục menu đang chọn lấy
// màu phụ, nút filled và liên kết giữ màu chính. Không khai màu phụ thì không đặt gì, giao diện như trước ADR 0063.
function secondaryComponents(secondary: string | undefined) {
  if (!secondary) return {};
  return {
    NavLink: NavLink.extend({ defaultProps: { color: secondary } }),
    Button: Button.extend({
      vars: (theme, props) => {
        if (props.color || (props.variant !== "light" && props.variant !== "subtle")) return { root: {} };
        const colors = theme.variantColorResolver({ color: secondary, theme, variant: props.variant });
        return {
          root: {
            "--button-bg": colors.background,
            "--button-hover": colors.hover,
            "--button-color": colors.color,
            "--button-bd": colors.border,
          },
        };
      },
    }),
  };
}

export function createAppTheme(tokens: ThemeTokens) {
  const [primaryColor, primaryShades] = paletteOf(tokens.color, CUSTOM_PRIMARY);
  const [secondaryColor, secondaryShades] = tokens.secondaryColor
    ? paletteOf(tokens.secondaryColor, CUSTOM_SECONDARY)
    : [undefined, {}];
  const fontFamily = FONT_FAMILIES[tokens.font];
  const colors = { ...primaryShades, ...secondaryShades };
  return createTheme({
    ...(Object.keys(colors).length > 0 ? { colors } : {}),
    // cssVariablesResolver chỉ nhận theme nên nền trang đi qua theme.other; nền mặc định không ghi, để theme của bản
    // cài không khai biến nào giữ đúng như trước ADR 0063.
    ...(tokens.background === "gray" ? {} : { other: { pageBackground: tokens.background } }),
    primaryColor,
    primaryShade: { light: PRIMARY_SHADE, dark: PRIMARY_SHADE },
    // Nút và nhãn filled của màu trạng thái (green, yellow, orange) quá sáng cho chữ trắng: autoContrast đổi sang chữ
    // đen khi độ chói của nền vượt ngưỡng (cssVariablesResolver đổi luôn màu khi di chuột cho các nền đó).
    autoContrast: true,
    luminanceThreshold: LUMINANCE_THRESHOLD,
    fontFamily,
    headings: {
      fontFamily,
      fontWeight: String(FONT_WEIGHTS.heading),
      sizes: {
        h1: { fontSize: "1.75rem", lineHeight: "1.3" },
        h2: { fontSize: "1.375rem", lineHeight: "1.35" },
        h3: { fontSize: "1.125rem", lineHeight: "1.4" },
        h4: { fontSize: "1rem", lineHeight: "1.45" },
      },
    },
    fontSizes: { xs: "0.75rem", sm: "0.875rem", md: "1rem", lg: "1.125rem", xl: "1.25rem" },
    lineHeights: { xs: "1.4", sm: "1.45", md: "1.55", lg: "1.6", xl: "1.65" },
    // Bậc khoảng cách theo bội 4px để mọi khối căn cùng một lưới.
    spacing: { xs: "0.5rem", sm: "0.75rem", md: "1rem", lg: "1.5rem", xl: "2rem" },
    // sm (6px) cho nút, ô nhập, nhãn; md (12px) cho thẻ và khung. Các trang đặt radius="md" cho khung nên đổi giá trị
    // của bậc thay vì đổi bậc ở từng trang.
    radius: RADIUS_SCALES[tokens.radius],
    defaultRadius: "sm",
    shadows: {
      xs: "0 1px 2px rgba(0, 0, 0, 0.06)",
      sm: "0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)",
      md: "0 4px 8px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)",
      lg: "0 8px 16px rgba(0, 0, 0, 0.1), 0 4px 8px rgba(0, 0, 0, 0.04)",
      xl: "0 16px 32px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.04)",
    },
    // Thẻ, khung và bảng cùng một kiểu viền, bo góc, khoảng đệm, để trang ghép từ nhiều thành phần vẫn nhìn như một.
    // Thẻ phân lớp bằng viền 1px trên nền xám nhạt, không bằng bóng.
    components: {
      Card: Card.extend({ defaultProps: { withBorder: true, radius: "md", padding: "lg" } }),
      Paper: Paper.extend({ defaultProps: { withBorder: true, radius: "md" } }),
      // Badge không theo defaultRadius (mặc định của nó là bo tròn hẳn), và chữ đậm 700 của nó không có tệp phông.
      Badge: Badge.extend({ defaultProps: { radius: "sm", fw: FONT_WEIGHTS.emphasis } }),
      // Liên kết luôn gạch chân để nhận ra không cần dựa vào màu. Thẻ <a> không qua Anchor giữ gạch chân mặc định
      // của trình duyệt, vì CSS của Mantine không bỏ nó.
      Anchor: Anchor.extend({ defaultProps: { underline: "always" } }),
      Table: Table.extend({ defaultProps: { verticalSpacing: "sm", horizontalSpacing: "md" } }),
      // Đầu hộp thoại của Mantine là thẻ <header>, trình đọc màn hình coi là vùng "banner" thứ hai bên cạnh thanh trên
      // của trang. Tên hộp đã có từ tiêu đề (aria-labelledby) nên đầu hộp chỉ cần là khối thường: role="none" bỏ vai
      // trò vùng, giữ nguyên thẻ và kiểu của Mantine (đầu hộp không nhận prop component).
      ModalHeader: ModalHeader.extend({ defaultProps: { role: "none" } }),
      ...secondaryComponents(secondaryColor),
    },
  });
}

// Biến CSS mà theme không đặt được, cho nền sáng:
// - Chữ của biến thể light (Alert, Badge, nút light, subtle, mục menu đang chọn) mặc định là sắc 9 trên nền sắc 1, di
//   chuột thì sắc 2: yellow chỉ khoảng 2,7:1, orange, green dưới 4:1. Chữ đậm thêm 30% từ sắc 9 đạt AA trên cả hai nền
//   với mọi bảng màu, mà vẫn đọc ra màu của trạng thái.
// - Nút filled chữ đen sáng lên khi di chuột (xem dưới).
// - Chữ phụ (dimmed) là gray.7 thay vì gray.6.
// - Chữ gợi ý trong ô nhập (placeholder, như "Chưa chọn tệp" của ô chọn tệp) mặc định là gray.5, khoảng 2:1; dùng
//   cùng màu với chữ phụ.
// - Viền ô nhập và nền trang: biến riêng của dự án mà theme.css đọc, vì Mantine viết cứng hai giá trị này trong CSS.
const backgroundOf = (theme: MantineTheme): ThemeTokens["background"] => theme.other.pageBackground ?? "gray";

export const cssVariablesResolver: CSSVariablesResolver = (theme: MantineTheme) => ({
  variables: {},
  light: {
    "--mantine-color-dimmed": `var(--mantine-color-gray-${DIMMED_SHADE})`,
    "--mantine-color-placeholder": `var(--mantine-color-gray-${DIMMED_SHADE})`,
    "--mortise-input-border": `var(--mantine-color-gray-${backgroundOf(theme) === "tint" ? TINT_INPUT_BORDER_SHADE : INPUT_BORDER_SHADE})`,
    "--mortise-page-background": PAGE_BACKGROUND[backgroundOf(theme)],
    ...Object.fromEntries(
      Object.entries(theme.colors).flatMap(([name, shades]) => [
        [`--mantine-color-${name}-light-color`, darken(shades[9], LIGHT_TEXT_DARKEN)],
        // Nền filled đủ sáng để mang chữ đen thì khi di chuột sáng lên một sắc thay vì tối đi: tối đi (sắc 9) làm chữ
        // đen tụt dưới AA với teal, cyan.
        ...(isLightColor(shades[PRIMARY_SHADE], LUMINANCE_THRESHOLD)
          ? [[`--mantine-color-${name}-filled-hover`, `var(--mantine-color-${name}-${PRIMARY_SHADE - 1})`]]
          : []),
      ]),
    ),
  },
  dark: {},
});
