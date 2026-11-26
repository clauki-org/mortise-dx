// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Khung cuộn ngang cho bảng nhiều cột (ADR 0047). Trên điện thoại bảng rộng hơn màn hình; khung cuộn của Mantine giấu
// thanh cuộn nên cột bên phải trông như mất. Khung này là một vùng có nhãn, nhận được tiêu điểm bàn phím (WCAG:
// vùng cuộn phải tới được bằng bàn phím), cuộn bằng phím mũi tên, và giữ mọi cột gói đã khai.

import { Box, VisuallyHidden } from "@mantine/core";
import type { ReactNode } from "react";

type Props = { label: string; minWidth: number; children: ReactNode };

export function TableScroll({ label, minWidth, children }: Props) {
  return (
    <Box role="region" aria-label={label} tabIndex={0} style={{ overflowX: "auto" }}>
      <Box miw={minWidth}>{children}</Box>
    </Box>
  );
}

/** Ô của giá trị ngắn không có khoảng trắng (mã, số hiệu) không xuống dòng giữa chừng như "TS-" / "A1". */
export const keepTogether = (text: string) => text.length <= 16 && !/\s/.test(text);

/** Giá trị trống hiện một gạch mờ, trình đọc màn hình đọc "Chưa có"; mọi bảng cùng một kiểu. */
export function Blank() {
  return (
    <>
      <Box component="span" c="dimmed" aria-hidden="true">
        —
      </Box>
      <VisuallyHidden>Chưa có</VisuallyHidden>
    </>
  );
}
