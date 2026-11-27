// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Đọc tệp người dùng chọn ở hộp "nạp từ tệp" của danh mục (ADR 0064) thành một lưới ô: .xlsx qua read-excel-file,
// CSV UTF-8 bằng bộ tách tự viết. Ô số, ô ngày của Excel giữ kiểu Excel trả (number, Date); ô của CSV luôn là chữ.
// Lưới đi tiếp sang catalogImport.ts để khớp cột và kiểm từng dòng. Thư viện đọc Excel chỉ nạp khi có tệp .xlsx.

import { ReadableError } from "./errorText";

/** Một ô như read-excel-file trả: chữ, số, đúng/sai, ngày (Date theo UTC), hay trống. */
export type Cell = string | number | boolean | Date | null;
export type Grid = Cell[][];

/** Lỗi đọc tệp mà người dùng tự sửa được; thông điệp nói cách sửa, hiện nguyên văn như mọi ReadableError. */
export class FileProblem extends ReadableError {}

/**
 * Trần cỡ tệp. Tệp được đọc hết trong trang; một tệp rất lớn làm treo thẻ trình duyệt trước khi kịp đếm dòng và báo
 * vượt max_rows. catalogImportFile.test.ts kiểm một tệp 1.000 dòng (trần của max_rows) nằm dưới trần này.
 */
export const FILE_LIMIT_BYTES = 5 * 1024 * 1024;

const isXlsx = (name: string) => /\.xlsx$/i.test(name);
const isCsv = (name: string) => /\.csv$/i.test(name);

/** Dấu phân cách đếm được nhiều hơn ở dòng đầu, bỏ qua phần trong nháy kép; hòa thì là dấu phẩy. */
function delimiterOf(text: string): "," | ";" {
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && char === ",") commas += 1;
    else if (!quoted && char === ";") semicolons += 1;
  }
  return semicolons > commas ? ";" : ",";
}

/**
 * Tách CSV theo RFC 4180: ô trong nháy kép chứa được dấu phân cách, xuống dòng và "" là một dấu nháy; dòng kết thúc
 * bằng CRLF hay LF. Excel tiếng Việt lưu CSV bằng dấu chấm phẩy vì dấu phẩy là dấu thập phân, nên dấu phân cách đoán
 * từ dòng tiêu đề thay vì cố định.
 */
export function parseCsv(input: string): Grid {
  const text = input.startsWith("﻿") ? input.slice(1) : input;
  const delimiter = delimiterOf(text);
  const rows: Grid = [];
  let row: Cell[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new FileProblem("Tệp CSV có một dấu nháy kép không được đóng. Mở tệp, sửa ô đó rồi chọn lại.");
  if (cell !== "" || row.length > 0) rows.push([...row, cell]);
  return rows;
}

function decodeUtf8(buffer: ArrayBuffer): string {
  try {
    // fatal: tệp lưu theo bảng mã khác (Windows-1258) báo lỗi thay vì thành chữ vỡ dấu mà vẫn được nạp.
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new FileProblem(
      'Tệp CSV không phải UTF-8. Trong Excel chọn "Lưu thành" kiểu "CSV UTF-8", hoặc dùng tệp mẫu .xlsx.',
    );
  }
}

/** Ngưỡng của fflate (thư viện giải nén của read-excel-file): phần nén lớn hơn thì giải nén trong Web Worker. */
const SYNC_INFLATE_BYTES = 524288;

/**
 * Tệp .xlsx có phần nén mà fflate sẽ giải nén trong Web Worker dựng từ blob:. CSP của giao diện (worker-src 'self')
 * chặn worker đó và lần đọc treo, không báo lỗi; nên đọc danh mục của tệp zip trước, gặp phần như vậy thì báo ngay.
 * Điều kiện giống fflate: nén kiểu deflate, giải ra từ 512 KB và nén được hơn 20%.
 */
export function needsWorker(buffer: ArrayBuffer): boolean {
  const view = new DataView(buffer);
  // Bản ghi cuối danh mục (EOCD) nằm trong 22 byte cuối, cộng tối đa 65.535 byte ghi chú của tệp zip.
  let end = -1;
  for (let at = buffer.byteLength - 22; at >= Math.max(0, buffer.byteLength - 22 - 65535); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) return false;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  for (let index = 0; index < count && at + 46 <= buffer.byteLength; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) return false;
    const method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    if (method === 8 && size >= SYNC_INFLATE_BYTES && packed <= 0.8 * size) return true;
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return false;
}

async function readXlsx(file: Blob): Promise<Grid> {
  const buffer = await file.arrayBuffer();
  if (needsWorker(buffer)) {
    throw new FileProblem(
      "Tệp Excel quá lớn để đọc trong trình duyệt. Xóa dòng, cột, trang thừa hoặc tách thành nhiều tệp, rồi chọn lại.",
    );
  }
  // Bản universal đọc ngay trong trang; bản browser dựng Web Worker mà CSP của giao diện không cho.
  const { readSheet } = await import("read-excel-file/universal");
  try {
    return (await readSheet(buffer)) as Grid;
  } catch {
    throw new FileProblem(
      "Không đọc được tệp Excel: tệp hỏng hoặc không phải .xlsx. Mở lại bằng Excel, lưu rồi thử lại.",
    );
  }
}

/** Đọc tệp thành lưới ô; tệp sai loại, quá lớn hay không đọc được thì ném FileProblem kèm cách sửa. */
export async function readGrid(file: File): Promise<Grid> {
  if (file.size > FILE_LIMIT_BYTES) {
    throw new FileProblem("Tệp lớn hơn 5 MB. Tách thành nhiều tệp nhỏ hơn rồi nạp từng tệp.");
  }
  if (isXlsx(file.name)) return readXlsx(file);
  if (isCsv(file.name)) return parseCsv(decodeUtf8(await file.arrayBuffer()));
  throw new FileProblem("Chỉ nhận tệp Excel (.xlsx) hoặc CSV. Tệp .xls cũ: mở bằng Excel, lưu thành .xlsx.");
}
