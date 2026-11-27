// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Ngữ cảnh của một khối trên trang (ADR 0061) hay trong chi tiết một dòng (ADR 0068): thành phần đọc nó để biết mình
// đang đứng trong một khối chứ không chiếm cả trang. Khi đó tiêu đề của thành phần không phải h1 của trang
// (PageHeader.tsx), và thành phần có đường dẫn con (danh mục, theo dõi hồ sơ) chỉ vẽ danh sách, giữ trạng thái trong
// bộ nhớ: địa chỉ trên thanh là của trang, không phải của khối, và nhiều khối cùng đọc một chuỗi truy vấn sẽ giẫm lên
// nhau. Khối trong chi tiết còn mang dòng đang xem và cách gắn của gói (attach); thành phần chỉ hỏi recordWhere cho
// nguồn của mình, không tự đọc attach. Tệp chỉ có context, không nhập thành phần nào, để thành phần nhập được mà không
// tạo vòng.

import { createContext, useContext } from "react";

/** Dòng đang xem: mục danh mục chứa nó, bảng, cột khóa, giá trị khóa và các trường đã đọc. */
export type RecordPlace = { app: string; item: string; source: string; key: string; id: unknown; row: object };

/** Gói khai trong detail.blocks: khối chỉ đọc dòng của `source` có `column` bằng khóa của dòng đang xem. */
export type Attach = { source: string; column: string };

export type BlockPlace = { app: string; item: string; record?: RecordPlace; attach?: Attach };

export const BlockContext = createContext<BlockPlace | null>(null);

/** Khối đang chứa thành phần, hay null khi thành phần là cả trang. */
export const useBlock = () => useContext(BlockContext);

/**
 * Điều kiện thêm vào truy vấn đọc `source`: cột của attach bằng khóa của dòng đang xem. Không có dòng, không có attach
 * hay attach trỏ tới nguồn khác thì không có điều kiện, và khối chạy như đứng riêng.
 */
export function recordWhere(block: BlockPlace | null, source: string): Record<string, unknown> | undefined {
  const { record, attach } = block ?? {};
  if (!record || !attach || attach.source !== source) return undefined;
  return { [attach.column]: { _eq: record.id } };
}

/** Giá trị biến của quy trình mà theo dõi hồ sơ lọc theo: như recordWhere, nhưng source là khóa quy trình. */
export function recordVariable(block: BlockPlace | null, processes: string[]) {
  const { record, attach } = block ?? {};
  if (!record || !attach || !processes.includes(attach.source)) return undefined;
  return { name: attach.column, value: String(record.id) };
}
