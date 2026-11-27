// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần tính thuần của lưới "Bento" trên bảng điều hành (ADR 0049): mức độ của một thẻ số theo hằng số của gói, độ dài
// hai vòng của vòng đo theo cột phần trăm, và bề rộng của từng khối trên lưới. Không có React ở đây để kiểm thử bằng
// hàm thuần; DashboardView.tsx, DashboardGauge.tsx và DashboardPanel.tsx vẽ theo kết quả. Không số nào người xem đọc
// được tính ở đây: mức độ chỉ so một cột với hằng số, vòng đo chỉ đọc cột phần trăm mà gói tính sẵn (ADR 0033).

import { type Card, type Level, numeric, OPERATORS, type Panel } from "./dashboardConfig";
import type { Tone } from "./tones";

const compare: Record<(typeof OPERATORS)[number], (value: number, bound: number) => boolean> = {
  gt: (value, bound) => value > bound,
  gte: (value, bound) => value >= bound,
  lt: (value, bound) => value < bound,
  lte: (value, bound) => value <= bound,
};

/** Một mức có khớp với số không; mức khai sai dạng (đã bị dashboardProblems chặn) thì không khớp. */
function matches(level: Level, value: number): boolean {
  const operator = OPERATORS.find((name) => typeof level[name] === "number");
  return operator !== undefined && compare[operator](value, level[operator] as number);
}

export type CardLevel = { tone: Extract<Tone, "warn" | "bad">; label: string };

/**
 * Mức độ của thẻ với giá trị của ô: bad thắng warn; ô trống hay không phải số thì không có mức, vì không so được.
 * Chữ của mức lấy từ cấu hình của gói, nên Tầng 2 không chứa chữ nghiệp vụ nào.
 */
export function cardLevel(card: Card, value: unknown): CardLevel | undefined {
  const number = numeric(value);
  if (number === undefined || !card.tone) return undefined;
  const { bad_when: bad, warn_when: warn } = card.tone;
  if (bad && matches(bad, number)) return { tone: "bad", label: bad.label };
  if (warn && matches(warn, number)) return { tone: "warn", label: warn.label };
  return undefined;
}

/**
 * Độ dài hai vòng của vòng đo, mỗi vòng từ 0 tới 1: vòng ngoài tới 100%, phần trên 100% là vòng trong, tối đa thêm
 * một vòng. Chỉ đọc cột phần trăm; không chia value cho limit. Không có số thì không vẽ vòng nào.
 */
export function gaugeLaps(percent: unknown): { outer: number; inner: number } | undefined {
  const value = numeric(percent);
  if (value === undefined) return undefined;
  const clamp = (lap: number) => Math.min(Math.max(lap, 0), 1);
  return { outer: clamp(value / 100), inner: clamp((value - 100) / 100) };
}

const WIDTH: Record<NonNullable<Panel["size"]>, number> = { quarter: 1, half: 2, full: 4 };

/**
 * Số cột mỗi khối chiếm trên lưới `columns` cột, theo thứ tự khai. Khối không vừa phần còn lại của hàng thì xuống hàng
 * mới, và khối cuối của hàng cũ được nới ra cho hết hàng; khối cuối trang cũng vậy. Nhờ đó lưới không có ô trống dù
 * khối nào bị ẩn theo vai trò, mà không phải đảo thứ tự (dense) làm thứ tự Tab khác thứ tự nhìn.
 */
export function panelSpans(panels: Panel[], columns: number): number[] {
  const spans = panels.map((panel) => Math.min(WIDTH[panel.size ?? "full"], columns));
  let used = 0;
  spans.forEach((span, index) => {
    if (used + span > columns) {
      spans[index - 1] = (spans[index - 1] ?? 0) + columns - used;
      used = 0;
    }
    used = (used + span) % columns;
  });
  if (used > 0) spans[spans.length - 1] = (spans[spans.length - 1] ?? 0) + columns - used;
  return spans;
}
