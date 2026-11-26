// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thương hiệu theo bản cài (ADR 0043): tên, tên ngắn, logo và màu chính đọc từ /branding.json trước lần vẽ đầu.
// Hình dạng tệp là contracts/branding.schema.json; bản mặc định là brand/branding.json, vừa nằm trong image vừa là
// giá trị dự phòng khi tệp của bản cài thiếu hay sai.

import { createContext, useContext } from "react";
import shipped from "../brand/branding.json";

// Bảng màu Mantine được chọn làm màu chính: chữ trắng trên nền màu và chữ màu trên nền trắng hay nền nhạt đều đạt
// WCAG AA ở sắc độ theme.ts dùng (theme.test.ts kiểm). Phải giữ đúng thứ tự và nội dung như enum `color` của
// contracts/branding.schema.json; scripts/contracts.sh so hai danh sách.
export const BRAND_COLORS = ["blue", "indigo", "violet", "grape", "pink", "dark"] as const;

export type BrandColor = (typeof BRAND_COLORS)[number];

export type Branding = { name: string; shortName: string; logo?: string; color: BrandColor };

// Cùng luật với schema: logo phải là tệp trong /brand/ của chính origin. CSP chỉ cho ảnh cùng origin, và /brand/ là
// thư mục duy nhất người vận hành gắn vào được mà không dựng lại image.
const LOGO = /^\/brand\/[A-Za-z0-9][A-Za-z0-9._-]*\.(svg|png|webp)$/;

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() !== "" && value.length <= max ? value : null;

// Đọc nội dung tệp thương hiệu; sai một trường là bỏ cả tệp. Ghép tệp sai với mặc định từng trường sẽ ra tên của đơn
// vị này với màu của đơn vị khác mà không ai nhận ra tệp đang sai.
export function parseBranding(value: unknown): Branding | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { name, short_name, logo, color, ...rest } = value as Record<string, unknown>;
  const fullName = text(name, 80);
  const shortName = text(short_name, 24);
  if (!fullName || !shortName || Object.keys(rest).length > 0) return null;
  if (!BRAND_COLORS.includes(color as BrandColor)) return null;
  if (logo !== undefined && !(typeof logo === "string" && LOGO.test(logo))) return null;
  return { name: fullName, shortName, color: color as BrandColor, ...(logo === undefined ? {} : { logo }) };
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
