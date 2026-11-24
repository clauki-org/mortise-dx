// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Xuất danh sách của thành phần danh mục ra tệp CSV (ADR 0038): đọc mọi dòng khớp tìm, lọc và thứ tự đang xem bằng
// chính câu truy vấn của bảng (catalogQuery.ts), rồi dựng tệp. Không có React ở đây để kiểm thử được bằng hàm thuần;
// nút và việc tải tệp ở CatalogExport.tsx.

import { type CatalogNode, display, type Field, fieldOf, type Row } from "./catalog";
import { type ListState, listVariables, sortOf } from "./catalogQuery";

/** Số dòng tối đa một tệp. Vượt thì không xuất, để không ai nhận một tệp thiếu dòng mà tưởng là đủ. */
export const LIMIT = 5000;

/** Danh sách có nhiều dòng hơn LIMIT khớp điều kiện đang xem. */
export class TooManyRows extends Error {}

/**
 * Đọc mọi dòng khớp điều kiện trong một lần, xin LIMIT + 1 dòng để biết danh sách có vượt giới hạn hay không. Một lần
 * đọc là một câu SQL, tức một ảnh chụp nhất quán: đọc theo lô thì dòng được thêm hay xóa giữa hai lô làm tệp lặp
 * hay sót dòng mà không ai biết.
 */
export async function readAll(fetch: (limit: number) => Promise<Row[]>): Promise<Row[]> {
  const rows = await fetch(LIMIT + 1);
  if (rows.length > LIMIT) {
    throw new TooManyRows(`Danh sách có hơn ${LIMIT} dòng; thu hẹp bằng tìm hay lọc rồi xuất lại.`);
  }
  return rows;
}

/** Biến của lần đọc: cùng điều kiện và thứ tự với bảng đang xem, từ dòng đầu, tối đa `limit` dòng. */
export function exportVariables(config: CatalogNode, state: ListState, limit: number) {
  return { ...listVariables(config, state), offset: 0, limit };
}

// Ô bắt đầu bằng các ký tự này được Excel và LibreOffice hiểu là công thức (CSV injection): tên cơ sở do người dùng
// gõ như "=HYPERLINK(...)" sẽ chạy khi người nhận mở tệp. Thêm dấu ' phía trước để chúng chỉ là chữ.
const FORMULA = /^[=+\-@\t\r]/;
// Số Hasura trả dạng chuỗi cho kiểu numeric của PostgreSQL (để không mất độ chính xác), và cột chữ cũng có thể chứa
// một số như vĩ độ "-21.03". Chuỗi chỉ gồm một số thì không phải công thức, nên không thêm dấu '.
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

/** Một ô CSV theo RFC 4180, đã chặn công thức: chữ có dấu phẩy, nháy kép hay xuống dòng thì bọc trong nháy kép. */
export function csvCell(text: string): string {
  const safe = FORMULA.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const isNumber = (value: unknown) =>
  (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && PLAIN_NUMBER.test(value));

/**
 * Giá trị của một trường trong tệp: chữ của choices và ngày giờ như trên màn hình (giờ của máy người xuất, múi giờ
 * ghi ở đầu tệp); số giữ dạng máy đọc được, không có dấu ngăn hàng nghìn, để bảng tính cộng trừ được.
 */
export function cellOf(field: Field, value: unknown): string {
  if (field.type === "number" && !field.choices && isNumber(value)) return csvCell(String(value));
  return csvCell(display(field, value));
}

/**
 * Điều kiện đang áp, viết thành chữ cho phần đầu tệp: người nhận biết tệp là một phần hay toàn bộ danh sách. Chỉ ghi
 * điều kiện mà listVariables thật sự áp: tham số lọc lạ trên đường dẫn không lọc gì thì không được ghi như đã lọc.
 */
export function describeConditions(config: CatalogNode, state: ListState): string {
  const parts: string[] = [];
  if (state.search.trim() !== "" && (config.list.search?.length ?? 0) > 0) parts.push(`Tìm "${state.search.trim()}"`);
  for (const name of config.list.filters ?? []) {
    const field = fieldOf(config, name);
    const value = state.filters[name];
    if (field && value) parts.push(`${field.label}: ${display(field, value)}`);
  }
  const sort = sortOf(config, state);
  const sortField = fieldOf(config, sort.field);
  parts.push(`Sắp xếp theo ${sortField?.label ?? sort.field} ${sort.direction === "asc" ? "tăng dần" : "giảm dần"}`);
  return parts.join("; ");
}

export type ExportInfo = {
  title: string;
  source: string;
  tenant: string;
  user: string;
  exportedAt: Date;
  timeZone: string;
  conditions: string;
};

const pad = (value: number) => String(value).padStart(2, "0");

/** Ngày theo giờ của máy người xuất, YYYY-MM-DD: xuất lúc sáng sớm ở Việt Nam không mang ngày hôm trước như UTC. */
export function localDate(time: Date): string {
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`;
}

/** Thời điểm theo giờ của máy người xuất, ISO 8601 kèm độ lệch múi giờ, ví dụ 2026-11-24T21:40:05+07:00. */
export function localTimestamp(time: Date): string {
  const offset = -time.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${localDate(time)}T${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}${zone}`;
}

const BOM = "\uFEFF";

/**
 * Nội dung tệp: BOM UTF-8 để bảng tính nhận đúng chữ có dấu; tám dòng đầu ghi tên danh sách, nguồn, đơn vị, thời
 * điểm, múi giờ, người xuất, điều kiện và số dòng; một dòng trống; rồi bảng với tiêu đề cột theo nhãn. Xuống dòng
 * CRLF theo RFC 4180.
 */
export function buildCsv(config: CatalogNode, info: ExportInfo, rows: Row[]): string {
  const columns = config.list.columns.map((name) => fieldOf(config, name)).filter((field) => field !== undefined);
  const header = [
    ["Danh sách", info.title],
    ["Nguồn", info.source],
    ["Đơn vị", info.tenant],
    ["Thời điểm xuất", localTimestamp(info.exportedAt)],
    ["Múi giờ", info.timeZone],
    ["Người xuất", info.user],
    ["Điều kiện", info.conditions],
    ["Số dòng", String(rows.length)],
  ].map((pair) => pair.map((text) => csvCell(text)).join(","));
  const table = [
    columns.map((field) => csvCell(field.label)).join(","),
    ...rows.map((row) => columns.map((field) => cellOf(field, row[field.name])).join(",")),
  ];
  return `${BOM}${[...header, "", ...table].join("\r\n")}\r\n`;
}

/** Tên tệp: tiêu đề bỏ dấu, chỉ còn chữ, số và gạch nối, kèm ngày xuất theo giờ địa phương. */
export function fileName(title: string, exportedAt: Date): string {
  const slug = title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replaceAll("đ", "d")
    .replaceAll("Đ", "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "danh-sach"}-${localDate(exportedAt)}.csv`;
}
