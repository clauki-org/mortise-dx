// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Bộ nghĩa màu dùng chung cho mọi nhãn trạng thái của Tầng 2 (ADR 0048): trang và thành phần chọn nghĩa, không chọn
// màu, để một màu không mang hai nghĩa ở hai trang. StatusBadge đọc bảng này; theme.test.tsx kiểm tương phản AA của
// từng nghĩa ở biến thể light. Tách khỏi StatusBadge để thành phần khác dùng lại bảng mà không kéo theo component.

export const TONES = ["bad", "warn", "info", "ok", "neutral"] as const;

export type Tone = (typeof TONES)[number];

// bad: cần xử lý ngay (quá hạn); warn: cần để ý; info: đang diễn ra; ok: đã xong, đạt; neutral: không có hạn, đã dừng.
// Màu chỉ là tín hiệu phụ: nhãn nào cũng có chữ nêu trạng thái.
export const TONE_COLOR: Record<Tone, string> = {
  bad: "red",
  warn: "orange",
  info: "blue",
  ok: "green",
  neutral: "gray",
};
