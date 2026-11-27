// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thương hiệu theo bản cài (ADR 0043, bộ biến giao diện của ADR 0063): tên, tên ngắn, logo và các biến giao diện
// (màu chính, màu phụ, bo góc, phông, nền trang) đọc từ /branding.json trước lần vẽ đầu.
// Hình dạng tệp là contracts/branding.schema.json; bản mặc định là brand/branding.json, vừa nằm trong image vừa là
// giá trị dự phòng khi tệp của bản cài thiếu hay sai.

import { createContext, useContext } from "react";
import shipped from "../brand/branding.json";
import { contrastProblems } from "./themeContrast";

// Bảng màu Mantine được chọn làm màu chính: chữ trắng trên nền màu và chữ màu trên nền trắng hay nền nhạt đều đạt
// WCAG AA ở sắc độ theme.ts dùng (theme.test.tsx kiểm). Phải giữ đúng thứ tự và nội dung như enum `color` của
// contracts/branding.schema.json (`$defs.palette`); scripts/contracts.sh so hai danh sách.
export const BRAND_COLORS = ["blue", "indigo", "violet", "grape", "pink", "dark"] as const;

export type BrandColor = (typeof BRAND_COLORS)[number];

// Các biến còn lại chỉ nhận giá trị trong danh sách, để kiểm thử đo được mọi tổ hợp. Cũng phải trùng enum của schema
// (scripts/contracts.sh so). Giá trị đầu mỗi danh sách là mặc định, giữ nguyên giao diện trước ADR 0063.
// Bo góc là số px của nút, ô nhập, nhãn; thẻ và khung gấp đôi (theme.ts).
export const BRAND_RADII = [6, 4, 8] as const;
// Chỉ phông đã đóng gói cùng giao diện hay phông của hệ điều hành: CSP không cho tải phông từ nơi khác.
export const BRAND_FONTS = ["be-vietnam-pro", "system"] as const;
// Nền trang: xám nhạt (gray.0), trắng, hay sắc 0 của màu chính.
export const BRAND_BACKGROUNDS = ["gray", "white", "tint"] as const;

// Mười sắc độ tự khai (0 sáng nhất, 9 tối nhất) thay cho một bảng màu có tên. Schema chỉ kiểm được dạng; tương phản
// đo khi đọc tệp (themeContrast.ts).
export type BrandShades = readonly string[];
export type ColorChoice = BrandColor | BrandShades;

export type ThemeTokens = {
  color: ColorChoice;
  secondaryColor?: ColorChoice;
  radius: (typeof BRAND_RADII)[number];
  font: (typeof BRAND_FONTS)[number];
  background: (typeof BRAND_BACKGROUNDS)[number];
};

export type Branding = { name: string; shortName: string; logo?: string; theme: ThemeTokens };

// Cùng luật với schema: logo phải là tệp trong /brand/ của chính origin. CSP chỉ cho ảnh cùng origin, và /brand/ là
// thư mục duy nhất người vận hành gắn vào được mà không dựng lại image.
const LOGO = /^\/brand\/[A-Za-z0-9][A-Za-z0-9._-]*\.(svg|png|webp)$/;

const SHADE = /^#[0-9a-fA-F]{6}$/;

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() !== "" && value.length <= max ? value : null;

function colorChoice(value: unknown): ColorChoice | null {
  if (BRAND_COLORS.includes(value as BrandColor)) return value as BrandColor;
  if (
    Array.isArray(value) &&
    value.length === 10 &&
    value.every((shade) => typeof shade === "string" && SHADE.test(shade))
  )
    return value.map((shade: string) => shade.toLowerCase());
  return null;
}

// Trường không ghi thì lấy giá trị đầu của danh sách; ghi mà sai thì null (bỏ cả tệp như trường khác).
function oneOf<T>(list: readonly T[], value: unknown): T | null {
  if (value === undefined) return list[0] ?? null;
  return list.includes(value as T) ? (value as T) : null;
}

function parseTokens(fields: Record<string, unknown>): ThemeTokens | null {
  const color = colorChoice(fields.color);
  const secondaryColor = fields.secondary_color === undefined ? undefined : colorChoice(fields.secondary_color);
  const radius = oneOf(BRAND_RADII, fields.radius);
  const font = oneOf(BRAND_FONTS, fields.font);
  const background = oneOf(BRAND_BACKGROUNDS, fields.background);
  if (!color || secondaryColor === null || radius === null || !font || !background) return null;
  return { color, radius, font, background, ...(secondaryColor === undefined ? {} : { secondaryColor }) };
}

// Đọc nội dung tệp thương hiệu; sai một trường là bỏ cả tệp. Ghép tệp sai với mặc định từng trường sẽ ra tên của đơn
// vị này với màu của đơn vị khác mà không ai nhận ra tệp đang sai. Tổ hợp màu dưới AA cũng là tệp sai: sắc độ tự khai
// chỉ đo được ở đây, và bỏ qua thì cả giao diện của bản cài dưới AA.
export function parseBranding(value: unknown): Branding | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { name, short_name, logo, color, secondary_color, radius, font, background, ...rest } = value as Record<
    string,
    unknown
  >;
  const fullName = text(name, 80);
  const shortName = text(short_name, 24);
  if (!fullName || !shortName || Object.keys(rest).length > 0) return null;
  if (logo !== undefined && !(typeof logo === "string" && LOGO.test(logo))) return null;
  const theme = parseTokens({ color, secondary_color, radius, font, background });
  if (!theme) return null;
  const problems = contrastProblems(theme);
  if (problems.length > 0) {
    console.warn(`/branding.json có màu dưới mức tương phản AA: ${problems.join("; ")}.`);
    return null;
  }
  return { name: fullName, shortName, theme, ...(logo === undefined ? {} : { logo }) };
}

const parsedDefault = parseBranding(shipped);
if (!parsedDefault) throw new Error("brand/branding.json không đúng contracts/branding.schema.json");
export const DEFAULT_BRANDING: Branding = parsedDefault;

// Không bao giờ ném lỗi hay treo: trang phải vẽ được kể cả khi tệp thương hiệu hỏng. Thiếu tệp thì nginx trả 404,
// còn máy chủ phát triển của Vite trả index.html với mã 200, nên kiểm loại nội dung trước khi đọc JSON.
export async function loadBranding(fetcher: typeof fetch = fetch): Promise<Branding> {
  try {
    const response = await fetcher("/branding.json", { signal: AbortSignal.timeout(5000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      return DEFAULT_BRANDING;
    }
    const parsed = parseBranding(await response.json());
    if (!parsed) console.warn("/branding.json không đúng contracts/branding.schema.json; dùng thương hiệu mặc định.");
    return parsed ?? DEFAULT_BRANDING;
  } catch {
    return DEFAULT_BRANDING;
  }
}

// Giá trị mặc định của context là thương hiệu mặc định, để thành phần vẽ trong kiểm thử không cần bọc provider.
export const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

export const useBranding = () => useContext(BrandingContext);
