// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Tỷ lệ tương phản WCAG 2 tính bằng công thức độ chói tương đối. Dùng chung cho kiểm thử của theme (theme.test.tsx)
// và cho bước kiểm thương hiệu lúc chạy (themeContrast.ts): màu do bản cài tự khai chỉ đo được khi đọc tệp.

// Kênh màu 0–255 của #rgb, #rrggbb hay rgba(r, g, b, a) (dạng darken của Mantine trả về).
export function channelsOf(color: string): number[] {
  const rgba = /^rgba?\((\d+), (\d+), (\d+)/.exec(color);
  if (rgba) return rgba.slice(1, 4).map(Number);
  if (/^#[0-9a-f]{3}$/i.test(color)) return [1, 2, 3].map((i) => Number.parseInt(`${color[i]}${color[i]}`, 16));
  if (/^#[0-9a-f]{6}$/i.test(color))
    return [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16));
  throw new Error(`Không đọc được màu ${color}`);
}

// Độ chói tương đối của một màu sRGB (WCAG 2.2, định nghĩa "relative luminance").
export function luminance(color: string): number {
  const channels = channelsOf(color).map((c) => c / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
