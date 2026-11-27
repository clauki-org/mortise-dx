// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Bộ quy ước giao diện dùng chung (ADR 0043): một thang cỡ chữ, một thang khoảng cách, bo góc, bóng và kiểu mặc định
// của thẻ, khung, bảng. Thành phần chỉ chọn bậc trong các thang này (size="sm", p="md"), không đặt số riêng. Màu chính
// đến từ thương hiệu của bản cài (branding.ts); theme.test.ts kiểm tương phản của mọi màu được phép.

import {
  Card,
  type CSSVariablesResolver,
  createTheme,
  darken,
  isLightColor,
  type MantineColorShade,
  type MantineTheme,
  ModalHeader,
  Paper,
  Table,
} from "@mantine/core";
import type { BrandColor } from "./branding";

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

// Phông có sẵn của hệ điều hành, không tải phông web: không thêm tệp phải tải trước lần vẽ đầu, không thêm giấy phép
// phông phải kiểm. Trình duyệt lấy phông đầu tiên có trên máy.
const SYSTEM_FONTS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, "Liberation Sans", sans-serif';

export function createAppTheme(primaryColor: BrandColor) {
  return createTheme({
    primaryColor,
    primaryShade: { light: PRIMARY_SHADE, dark: PRIMARY_SHADE },
    // Nút và nhãn filled của màu trạng thái (green, yellow, orange) quá sáng cho chữ trắng: autoContrast đổi sang chữ
    // đen khi độ chói của nền vượt ngưỡng (cssVariablesResolver đổi luôn màu khi di chuột cho các nền đó).
    autoContrast: true,
    luminanceThreshold: LUMINANCE_THRESHOLD,
    fontFamily: SYSTEM_FONTS,
    headings: {
      fontFamily: SYSTEM_FONTS,
      fontWeight: "700",
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
    radius: { xs: "0.125rem", sm: "0.25rem", md: "0.5rem", lg: "0.75rem", xl: "1rem" },
    defaultRadius: "md",
    shadows: {
      xs: "0 1px 2px rgba(0, 0, 0, 0.06)",
      sm: "0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)",
      md: "0 4px 8px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)",
      lg: "0 8px 16px rgba(0, 0, 0, 0.1), 0 4px 8px rgba(0, 0, 0, 0.04)",
      xl: "0 16px 32px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.04)",
    },
    // Thẻ, khung và bảng cùng một kiểu viền, bo góc, khoảng đệm, để trang ghép từ nhiều thành phần vẫn nhìn như một.
    components: {
      Card: Card.extend({ defaultProps: { withBorder: true, radius: "md", padding: "lg", shadow: "xs" } }),
      Paper: Paper.extend({ defaultProps: { withBorder: true, radius: "md" } }),
      Table: Table.extend({ defaultProps: { verticalSpacing: "sm", horizontalSpacing: "md" } }),
      // Đầu hộp thoại của Mantine là thẻ <header>, trình đọc màn hình coi là vùng "banner" thứ hai bên cạnh thanh trên
      // của trang. Tên hộp đã có từ tiêu đề (aria-labelledby) nên đầu hộp chỉ cần là khối thường: role="none" bỏ vai
      // trò vùng, giữ nguyên thẻ và kiểu của Mantine (đầu hộp không nhận prop component).
      ModalHeader: ModalHeader.extend({ defaultProps: { role: "none" } }),
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
export const cssVariablesResolver: CSSVariablesResolver = (theme: MantineTheme) => ({
  variables: {},
  light: {
    "--mantine-color-dimmed": `var(--mantine-color-gray-${DIMMED_SHADE})`,
    "--mantine-color-placeholder": `var(--mantine-color-gray-${DIMMED_SHADE})`,
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
