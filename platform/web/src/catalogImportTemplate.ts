// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Tệp mẫu .xlsx của hộp "nạp từ tệp" (ADR 0064), sinh từ biểu mẫu gói khai bằng write-excel-file: trang đầu chỉ có
// dòng tiêu đề (nhãn của từng trường, đúng chữ mà catalogImport.ts khớp lại), trang sau ghi cách điền từng cột. Thư
// viện chỉ nạp khi người dùng bấm tải tệp mẫu, như khi xuất danh sách (ADR 0052).

import type { Sheet } from "write-excel-file/universal";
import type { FormConfig, FormField } from "./formConfig";

const KINDS: Record<FormField["type"], string> = {
  string: "Chữ",
  number: "Số, dấu phẩy thập phân",
  integer: "Số nguyên",
  boolean: "Đúng/sai",
  date: "Ngày, dạng ngày/tháng/năm",
  choice: "Một giá trị trong danh sách",
};

function limits(field: FormField): string {
  const parts = [
    field.min !== undefined ? `từ ${field.min}` : "",
    field.max !== undefined ? `tới ${field.max}` : "",
    field.max_length !== undefined ? `tối đa ${field.max_length} ký tự` : "",
    ...(field.choices ? [field.choices.map((choice) => choice.label).join("; ")] : []),
  ];
  return parts.filter((part) => part !== "").join(", ");
}

const text = (value: string, bold = false) => ({
  value,
  type: String,
  ...(bold ? { fontWeight: "bold" as const } : {}),
});

/** Hai trang của tệp mẫu; ô tiêu đề khai kiểu chữ để nhãn bắt đầu bằng "=" không thành công thức. */
export function templateSheets(form: FormConfig): Sheet<Blob>[] {
  const guideHeader = ["Cột", "Bắt buộc", "Kiểu", "Giới hạn, giá trị được nhận", "Ghi chú"].map((t) => text(t, true));
  return [
    {
      sheet: "Dữ liệu",
      data: [form.fields.map((field) => text(field.label, true))],
      columns: form.fields.map(() => ({ width: 24 })),
      stickyRowsCount: 1,
    },
    {
      sheet: "Hướng dẫn",
      data: [
        guideHeader,
        ...form.fields.map((field) => [
          text(field.label),
          text(field.required ? "Có" : "Không"),
          text(KINDS[field.type]),
          text(limits(field)),
          text(field.help ?? ""),
        ]),
      ],
      columns: [{ width: 28 }, { width: 10 }, { width: 28 }, { width: 48 }, { width: 48 }],
    },
  ];
}

export async function templateBlob(form: FormConfig): Promise<Blob> {
  const { default: writeExcelFile } = await import("write-excel-file/universal");
  return writeExcelFile(templateSheets(form)).toBlob();
}
