// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Nhãn trạng thái mà Tầng 2 tự biết (hạn của việc, bước của hồ sơ), ADR 0047 và 0048. Trang chọn nghĩa trong bộ nghĩa
// chung (tones.ts), không chọn màu: quá hạn là bad, đang diễn ra là info, đã xong là ok, không có hạn hay đã dừng là
// neutral. Nhãn luôn có chữ, màu không là tín hiệu duy nhất. Cột trạng thái của danh mục là chữ của gói, không qua đây.

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
