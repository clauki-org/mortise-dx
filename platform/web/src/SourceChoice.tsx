// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Ô chọn của thành phần biểu mẫu đọc danh sách từ một bảng của gói qua GraphQL (field.source, ADR 0030). FormPanel.tsx
// đăng ký ô này cho rjsf với tên sourceChoice; giá trị của các trường khác và vai trò Hasura đến qua formContext. Ô có
// nhãn, id, dấu bắt buộc và lỗi của Mantine Select để trình đọc màn hình đọc được như mọi ô khác.

import { Select, Stack, Text } from "@mantine/core";
import type { WidgetProps } from "@rjsf/utils";
import { useMemo } from "react";
import { useQuery } from "urql";
import { type Source, sourceLimit, sourceOptions, sourceQuery, type Values } from "./formConfig";

/** Dữ liệu chung FormPanel đưa cho mọi ô: giá trị hiện tại của biểu mẫu và vai trò gửi kèm truy vấn (formRole). */
export type FormContext = { values: Values; role: string };

export function SourceChoice(props: WidgetProps) {
  const { id, value, required, disabled, readonly, label, rawErrors, onChange, onBlur, onFocus, options } = props;
  const source = options.source as Source;
  const { values, role } = props.registry.formContext as FormContext;
  const parent = source.where ? values[source.where.field] : undefined;
  // Trường cha chưa chọn thì chưa có gì để lọc; truy vấn không điều kiện sẽ trả mục của mọi trường cha.
  const waiting = source.where !== undefined && (parent === undefined || parent === "");
  const { query, variables } = useMemo(() => sourceQuery(source, parent), [source, parent]);
  const context = useMemo(() => ({ role }), [role]);
  // Mỗi lần mở biểu mẫu đọc lại từ máy chủ: danh sách vừa được thêm mục (ví dụ một dòng mới) phải hiện ngay, và bộ nhớ
  // đệm của urql không phân biệt vai trò.
  const [{ data, fetching, error }] = useQuery<{ rows: Values[] }>({
    query,
    variables,
    context,
    pause: waiting,
    requestPolicy: "network-only",
  });
  // Đổi trường cha thì urql giữ kết quả của trường cha cũ tới khi kết quả mới về; hiện các mục đó lúc ấy là cho chọn
  // một mục không thuộc trường cha vừa chọn.
  const items = useMemo(() => (fetching ? [] : sourceOptions(source, data?.rows ?? [])), [source, data, fetching]);
  const limit = sourceLimit(source);
  const problem = error
    ? `Không tải được danh sách: ${error.message}. Tải lại trang; nếu vẫn lỗi, báo người quản trị.`
    : undefined;
  return (
    <Stack gap={4}>
      <Select
        id={id}
        label={label}
        required={required}
        value={typeof value === "string" ? value : null}
        data={items}
        onChange={(next) => onChange(next ?? undefined)}
        onBlur={() => onBlur(id, value)}
        onFocus={() => onFocus(id, value)}
        disabled={disabled || readonly || waiting}
        searchable
        nothingFoundMessage="Không có mục nào khớp"
        placeholder={
          waiting ? `Chọn ${String(options.parentLabel ?? "trường trước")} trước` : fetching ? "Đang tải…" : undefined
        }
        error={rawErrors?.length ? rawErrors.join("; ") : problem}
        comboboxProps={{ withinPortal: false }}
      />
      {!waiting && !fetching && !error && items.length === 0 && (
        <Text size="sm" c="dimmed">
          Danh sách chưa có mục nào. Báo người quản trị thêm mục trước khi điền biểu mẫu này.
        </Text>
      )}
      {(data?.rows.length ?? 0) > limit && (
        <Text size="sm" c="dimmed">
          Danh sách có hơn {limit} mục; chỉ hiện {limit} mục đầu theo thứ tự tên. Không thấy mục cần chọn thì báo người
          quản trị.
        </Text>
      )}
    </Stack>
  );
}
