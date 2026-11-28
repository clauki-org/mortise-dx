// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Khối trong chi tiết một dòng của danh mục (detail.blocks, ADR 0068): mỗi khối là một mục của chính gói, vẽ bằng
// Block.tsx như trên trang, kèm dòng đang xem và cách gắn (attach) mà gói khai. Thành phần trong khối tự thêm điều kiện
// của dòng vào truy vấn của nguồn được gắn (blockContext.ts). Mục dành cho vai trò khác không có trong menu của người
// xem nên khối của nó không hiện, như ở trang (Page.tsx).

import { Stack } from "@mantine/core";
import { Block } from "./Block";
import type { RecordPlace } from "./blockContext";
import type { RecordBlock } from "./catalog";
import { findItem } from "./menu";
import { usePackageMenu } from "./PackagePage";

export function RecordBlocks({ blocks, record }: { blocks: RecordBlock[]; record: RecordPlace }) {
  const { items } = usePackageMenu();
  const placed = blocks.flatMap((block) => {
    const entry = findItem(items, record.app, block.item);
    return entry ? [{ entry, block }] : [];
  });
  if (placed.length === 0) return null;
  return (
    <Stack>
      {placed.map(({ entry, block }, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: danh sách khối cố định theo cấu hình, một mục đặt được nhiều lần.
        <Block key={index} entry={entry} variant={block.variant} record={record} attach={block.attach} />
      ))}
    </Stack>
  );
}
