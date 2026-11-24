// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Ghi bảng xuất của danh mục (catalogExport.ts) ra Excel (.xlsx, write-excel-file) và PDF (pdfmake), ADR 0038. Mỗi
// định dạng có một hàm thuần dựng dữ liệu cho thư viện, để kiểm thử không cần thư viện, và một hàm nạp thư viện khi
// người dùng bấm xuất: hai thư viện nặng (PDF kèm font tiếng Việt) nên không nằm trong phần tải trang ban đầu.

import type { SheetData } from "write-excel-file/universal";
import type { ExportTable } from "./catalogExport";

/**
 * Phần đầu (nhãn đậm), một dòng trống, tiêu đề cột đậm, rồi các dòng; ô số ghi là số để bảng tính cộng trừ được.
 * Mọi ô chữ khai rõ kiểu String: chữ bắt đầu bằng "=" luôn là chữ, không bao giờ thành công thức.
 */
export function sheetData(table: ExportTable): SheetData {
  const text = (value: string, bold = false) => ({
    value,
    type: String,
    ...(bold ? { fontWeight: "bold" as const } : {}),
  });
  return [
    ...table.meta.map(([label, value]) => [text(label, true), text(value)]),
    [],
    table.columns.map((label) => text(label, true)),
    ...table.rows.map((row) =>
      row.map((cell) => (cell.kind === "number" ? { value: Number(cell.value), type: Number } : text(cell.value))),
    ),
  ];
}

export async function xlsxBlob(table: ExportTable): Promise<Blob> {
  // Bản universal ghi thẳng ra Blob trong trang; bản browser chạy trong Web Worker, thêm một đường tải mã cần CSP cho
  // phép mà không được gì cho danh sách tối đa 5.000 dòng.
  const { default: writeExcelFile } = await import("write-excel-file/universal");
  return writeExcelFile(sheetData(table)).toBlob();
}

type PdfCell = { text: string; bold?: boolean; alignment?: "right" };
type PdfDocument = {
  pageSize: "A4";
  pageOrientation: "portrait" | "landscape";
  pageMargins: [number, number, number, number];
  info: { title: string };
  defaultStyle: { font: "Roboto"; fontSize: number };
  footer: (page: number, pages: number) => { text: string; alignment: "center"; fontSize: number };
  content: unknown[];
};

/**
 * Tài liệu pdfmake: tiêu đề, phần đầu dạng bảng hai cột, rồi bảng dữ liệu có dòng tiêu đề lặp lại ở mỗi trang và số
 * trang ở chân trang. Bảng nhiều hơn bốn cột thì in ngang cho đủ chỗ. Font Roboto đi kèm pdfmake có đủ chữ tiếng
 * Việt; font mặc định của PDF thì không.
 */
export function pdfDocument(table: ExportTable): PdfDocument {
  const title = table.meta.find(([label]) => label === "Danh sách")?.[1] ?? "Danh sách";
  const cell = (text: string, bold = false, right = false): PdfCell => ({
    text,
    ...(bold ? { bold: true } : {}),
    ...(right ? { alignment: "right" as const } : {}),
  });
  return {
    pageSize: "A4",
    pageOrientation: table.columns.length > 4 ? "landscape" : "portrait",
    pageMargins: [32, 32, 32, 40],
    info: { title },
    defaultStyle: { font: "Roboto", fontSize: 9 },
    footer: (page, pages) => ({ text: `Trang ${page}/${pages}`, alignment: "center", fontSize: 8 }),
    content: [
      { text: title, fontSize: 14, bold: true, margin: [0, 0, 0, 8] },
      {
        table: { widths: ["auto", "*"], body: table.meta.map(([label, value]) => [cell(label, true), cell(value)]) },
        layout: "noBorders",
        margin: [0, 0, 0, 12],
      },
      {
        table: {
          headerRows: 1,
          widths: table.columns.map(() => "*"),
          body: [
            table.columns.map((label) => cell(label, true)),
            ...table.rows.map((row) => row.map((item) => cell(item.value, false, item.kind === "number"))),
          ],
        },
        layout: "lightHorizontalLines",
      },
    ],
  };
}

export async function pdfBlob(table: ExportTable): Promise<Blob> {
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  pdfMake.addVirtualFileSystem(fonts);
  return pdfMake.createPdf(pdfDocument(table)).getBlob();
}
