// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Đọc định nghĩa trường tùy chỉnh của một bảng (ADR 0059) cho danh mục, chi tiết, biểu mẫu, nút xuất và hộp thoại quản
// lý. Mọi nơi dùng cùng câu và cùng context nên urql gửi một truy vấn cho mỗi bảng; phần hàm thuần ở customFields.ts.

import { useEffect, useMemo } from "react";
import { useQuery } from "urql";
import { CUSTOM_FIELDS_QUERY, CUSTOM_FIELDS_TYPENAME, type CustomField, definitions } from "./customFields";

// Danh sách rỗng không mang kiểu nào trong kết quả, nên urql chỉ biết đọc lại sau lần thêm trường đầu tiên nhờ khai kiểu
// ở đây. Khai ở mức module: urql so context theo tham chiếu, đối tượng mới mỗi lần vẽ thì truy vấn chạy lại mãi.
const CONTEXT = { additionalTypenames: [CUSTOM_FIELDS_TYPENAME] };

const NONE: CustomField[] = [];

export type CustomFieldsState = {
  fields: CustomField[];
  /** Đã có kết quả hay lỗi. Câu đọc dòng chờ tới lúc này để biết có đọc cột `custom` hay không. */
  settled: boolean;
};

/**
 * Định nghĩa của bảng `source`, hay rỗng khi không có `source` (biểu mẫu khởi tạo quy trình). Đọc lỗi (bản cài chưa
 * có bảng định nghĩa, mạng) thì coi như không có trường nào: danh mục vẫn hiện các trường của gói, chỉ thiếu phần
 * tùy chỉnh, và lỗi ghi ở console.
 */
export function useCustomFields(source: string | undefined): CustomFieldsState {
  const [{ data, error }] = useQuery<{ platform_custom_fields: unknown }>({
    query: CUSTOM_FIELDS_QUERY,
    variables: { source: source ?? "" },
    context: CONTEXT,
    pause: source === undefined,
  });
  const fields = useMemo(() => (data ? definitions(data.platform_custom_fields) : NONE), [data]);
  useEffect(() => {
    if (error) console.warn(`Không đọc được trường tùy chỉnh của ${source}: ${error.message}`);
  }, [error, source]);
  if (source === undefined) return { fields: NONE, settled: true };
  if (error && !data) return { fields: NONE, settled: true };
  return { fields, settled: data !== undefined };
}
