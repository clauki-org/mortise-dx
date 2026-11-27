// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần xem trước của hộp "nạp từ tệp" (ADR 0064): mỗi dòng của tệp một dòng bảng, số dòng như bảng tính hiện, giá
// trị đã gõ ở từng cột và lỗi viết bằng chữ ngay dưới ô sai. Lỗi không chỉ là màu: ô sai mang chữ "Lỗi:" và cột
// "Dòng" ghi "có lỗi", nên đọc được khi không phân biệt màu và qua trình đọc màn hình. CatalogImport.tsx vẽ khối này.

import { Alert, Checkbox, Stack, Table, Text } from "@mantine/core";
import { useState } from "react";
import { hasErrors, type ImportRow } from "./catalogImport";
import type { FormConfig } from "./formConfig";
import { Blank, TableScroll } from "./TableScroll";

function Cell({ text, error }: { text: string; error?: string }) {
  return (
    <Table.Td>
      {text === "" ? <Blank /> : text}
      {error && (
        <Text size="xs" c="red.9" fw={600}>
          Lỗi: {error}
        </Text>
      )}
    </Table.Td>
  );
}

export function CatalogImportPreview({ form, rows }: { form: FormConfig; rows: ImportRow[] }) {
  const wrong = rows.filter(hasErrors);
  const [onlyWrong, setOnlyWrong] = useState(false);
  const shown = onlyWrong ? wrong : rows;
  return (
    <Stack gap="xs">
      {wrong.length > 0 ? (
        <Alert color="red" title={`${wrong.length} trong ${rows.length} dòng có lỗi`}>
          Sửa các ô ghi "Lỗi" trong tệp rồi chọn lại tệp. Chưa sửa hết thì không dòng nào được thêm.
        </Alert>
      ) : (
        <Alert color="green" title={`${rows.length} dòng hợp lệ`}>
          Xem lại rồi bấm nút bên dưới để thêm tất cả trong một lần.
        </Alert>
      )}
      {wrong.length > 0 && (
        <Checkbox
          label="Chỉ hiện dòng có lỗi"
          checked={onlyWrong}
          onChange={(event) => setOnlyWrong(event.currentTarget.checked)}
        />
      )}
      <TableScroll label="Xem trước dữ liệu của tệp" minWidth={120 + form.fields.length * 140}>
        <Table striped withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Dòng</Table.Th>
              {form.fields.map((field) => (
                <Table.Th key={field.name}>{field.label}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((row) => (
              <Table.Tr key={row.line}>
                <Table.Th scope="row" fw={hasErrors(row) ? 700 : 400}>
                  {row.line}
                  {hasErrors(row) && " (có lỗi)"}
                </Table.Th>
                {form.fields.map((field) => (
                  <Cell key={field.name} text={row.shown[field.name] ?? ""} error={row.errors[field.name]} />
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </TableScroll>
    </Stack>
  );
}
