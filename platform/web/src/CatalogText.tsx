// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Khối chữ dài trên màn hình chi tiết của danh mục (detail.text): một trường do CSDL dựng sẵn, ví dụ một văn bản mẫu
// sinh từ dữ liệu, hiện nguyên các dòng và tải về được thành tệp .txt. Chữ không tính hay sửa ở trình duyệt, nên tệp
// tải về đúng bằng chữ trên màn hình. CatalogRecord.tsx gọi khối này.

import { Button, Group, Paper, Text, Title } from "@mantine/core";
import type { TextBlock } from "./catalog";

// Dấu BOM để Notepad cũ trên Windows đọc đúng chữ tiếng Việt UTF-8; trình soạn thảo khác bỏ qua nó.
const BOM = "﻿";

/** Tên tệp tải về: tiền tố gói khai cùng khóa của dòng, chỉ giữ chữ, số, gạch nối để hệ điều hành nào cũng nhận. */
export function textFileName(prefix: string, key: unknown): string {
  const safe = String(key ?? "")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}${safe ? `-${safe}` : ""}.txt`;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([BOM, text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function CatalogText({ block, value, recordKey }: { block: TextBlock; value: unknown; recordKey: unknown }) {
  const text = typeof value === "string" ? value : "";
  return (
    <Paper withBorder radius="md" p="md" component="section" aria-label={block.title}>
      <Group justify="space-between" align="flex-start" mb="xs">
        <Title order={2} size="h4">
          {block.title}
        </Title>
        <Button
          variant="default"
          disabled={text === ""}
          onClick={() => download(textFileName(block.download, recordKey), text)}
        >
          Tải về tệp văn bản
        </Button>
      </Group>
      {text === "" ? (
        <Text c="dimmed">Chưa có nội dung.</Text>
      ) : (
        <Text component="pre" m={0} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit" }}>
          {text}
        </Text>
      )}
    </Paper>
  );
}
