// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Nhãn trạng thái dùng chung, ADR 0047, 0048 và 0050. Trang chọn nghĩa trong bộ nghĩa chung (tones.ts), không chọn
// màu: với trạng thái Tầng 2 tự biết, quá hạn là bad, đang diễn ra là info, đã xong là ok, không có hạn hay đã dừng là
// neutral; với giá trị của danh mục, nghĩa do gói khai ở tone của từng lựa chọn. Nhãn luôn có chữ, màu không là tín
// hiệu duy nhất.

import { Badge } from "@mantine/core";
import type { ReactNode } from "react";
import { TONE_COLOR, type Tone } from "./tones";

type Props = { tone: Tone; children: ReactNode; title?: string };

export function StatusBadge({ tone, children, title }: Props) {
  return (
    <Badge variant="light" color={TONE_COLOR[tone]} tt="none" title={title}>
      {children}
    </Badge>
  );
}
