// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Một chỗ định dạng ngày giờ và số cho mọi trang (ADR 0047): danh mục, bảng việc, hồ sơ, bản đồ cùng viết ngày giờ
// và số theo vi-VN một kiểu. Trang nào tự tạo Intl riêng thì ngày giờ của trang đó lệch kiểu với trang khác.

// Năm đủ bốn chữ số: kiểu ngắn của vi-VN viết năm hai chữ số, nên 1820 và 2020 hiện giống nhau.
const day = { day: "2-digit", month: "2-digit", year: "numeric" } as const;

/** Ngày giờ theo múi giờ của trình duyệt, ví dụ "08:30 01/11/2026". */
export const dateTime = new Intl.DateTimeFormat("vi-VN", { ...day, hour: "2-digit", minute: "2-digit" });
// Cột ngày không có giờ: đọc theo UTC, nếu không thì ở múi giờ phía tây ngày hiện ra lùi một ngày.
const date = new Intl.DateTimeFormat("vi-VN", { ...day, timeZone: "UTC" });
const number = new Intl.NumberFormat("vi-VN");
const oneDecimal = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

/** Ngày giờ của một mốc ISO 8601; chuỗi không đọc được thì hiện nguyên để không mất thông tin. */
export function formatDateTime(value: string): string {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : dateTime.format(time);
}

/** Ngày (không giờ) của một chuỗi ngày ISO, ví dụ "17/11/2026". */
export function formatDate(value: string): string {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : date.format(time);
}

/** Số theo kiểu Việt Nam: dấu chấm ngăn nghìn, dấu phẩy thập phân. */
export const formatNumber = (value: number) => number.format(value);

/** Số làm tròn tới một chữ số thập phân, cho cỡ tệp tính bằng KB, MB. */
export const formatRounded = (value: number) => oneDecimal.format(value);
