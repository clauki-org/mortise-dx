// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Đầu trang dùng chung (ADR 0047): đường về trang trước nếu có, tiêu đề là h1 duy nhất của trang, dòng phụ (mô tả ngắn
// hay nhãn trạng thái) và chỗ của việc chính bên phải; màn hình hẹp thì việc chính xuống dưới tiêu đề. Tiêu đề lấy
// nguyên từ cấu hình của gói: e2e và trình đọc màn hình tìm trang theo đúng chữ đó. Thành phần đặt trong một khối của
// trang (ADR 0061) thì tiêu đề là h2 dưới h1 của trang, để trang vẫn chỉ có một h1.

import { Box, Group, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";
import { useBlock } from "./blockContext";

type Props = {
  title: ReactNode;
  /** Mô tả ngắn dưới tiêu đề */
  description?: ReactNode;
  /** Đường về trang cha (breadcrumb, liên kết) đặt trên tiêu đề */
  before?: ReactNode;
  /** Dòng nhãn dưới tiêu đề, ví dụ nhãn trạng thái */
  meta?: ReactNode;
  /** Việc chính của trang: nút, bộ lọc chính */
  action?: ReactNode;
};

export function PageHeader({ title, description, before, meta, action }: Props) {
  const inBlock = useBlock() !== null;
  return (
    <Stack gap={4}>
      {before}
      <Group justify="space-between" align="flex-end" gap="sm">
        <Box maw={720}>
          <Title order={inBlock ? 2 : 1} size={inBlock ? "h3" : "h2"}>
            {title}
          </Title>
          {meta && (
            <Group gap={6} mt={4}>
              {meta}
            </Group>
          )}
          {description && (
            <Text c="dimmed" size="sm" mt={4}>
              {description}
            </Text>
          )}
        </Box>
        {action}
      </Group>
    </Stack>
  );
}
