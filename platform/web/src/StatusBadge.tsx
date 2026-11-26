// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Nhãn trạng thái mà Tầng 2 tự biết (hạn của việc, bước của hồ sơ), ADR 0047. Mỗi màu một nghĩa ở mọi trang: đỏ là
// quá hạn, xanh dương là đang diễn ra, xanh lá là đã xong, xám là không có hạn hay đã dừng. Trang chọn nghĩa, không
// chọn màu, để cùng một màu không mang hai nghĩa ở hai trang. Cột trạng thái của danh mục là chữ của gói, không qua đây.

import { Badge } from "@mantine/core";
import type { ReactNode } from "react";

export type Tone = "overdue" | "active" | "done" | "neutral";

const COLOR: Record<Tone, string> = { overdue: "red", active: "blue", done: "green", neutral: "gray" };

type Props = { tone: Tone; children: ReactNode; title?: string };

export function StatusBadge({ tone, children, title }: Props) {
  return (
    <Badge variant="light" color={COLOR[tone]} tt="none" title={title}>
      {children}
    </Badge>
  );
}
