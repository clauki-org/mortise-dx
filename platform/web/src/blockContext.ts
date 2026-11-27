// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Ngữ cảnh của một khối trên trang (ADR 0061): thành phần đọc nó để biết mình đang đứng trong một khối chứ không chiếm
// cả trang. Khi đó tiêu đề của thành phần không phải h1 của trang (PageHeader.tsx), và thành phần có đường dẫn con
// (danh mục, theo dõi hồ sơ) chỉ vẽ danh sách, giữ trạng thái trong bộ nhớ: địa chỉ trên thanh là của trang, không
// phải của khối, và nhiều khối cùng đọc một chuỗi truy vấn sẽ giẫm lên nhau. Tệp chỉ có context, không nhập thành phần
// nào, để thành phần nhập được mà không tạo vòng.

import { createContext, useContext } from "react";

export type BlockPlace = { app: string; item: string };

export const BlockContext = createContext<BlockPlace | null>(null);

/** Khối đang chứa thành phần, hay null khi thành phần là cả trang. */
export const useBlock = () => useContext(BlockContext);
