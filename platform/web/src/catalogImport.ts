// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Nạp nhiều dòng con từ tệp (ADR 0064): khớp tiêu đề cột của lưới ô (catalogImportFile.ts) với trường của biểu mẫu
// gói khai, đổi từng ô theo kiểu của trường, kiểm từng dòng bằng chính bộ kiểm của biểu mẫu (formValidator.ts), tìm
// giá trị trùng trong tệp và với dòng đã có, rồi dựng lệnh thêm nhiều dòng. CatalogImport.tsx vẽ phần xem trước và
// gửi. Không có React ở đây để kiểm thử được bằng hàm thuần.

import type { Cell, Grid } from "./catalogImportFile";
import { type FormConfig, type FormField, formSchema, payloadOf, type Values } from "./formConfig";
import { formValidator } from "./formValidator";

/** Một dòng dữ liệu của tệp: số dòng như bảng tính hiện, giá trị đã đổi kiểu, chữ hiện ở xem trước, lỗi theo trường. */
export type ImportRow = {
  line: number;
  values: Values;
  shown: Record<string, string>;
  errors: Record<string, string>;
};

/** Kết quả đọc tệp: lỗi cả tệp (thiếu cột, quá nhiều dòng) thì không có dòng nào để xem trước. */
export type ImportSheet = { problems: string[]; rows: ImportRow[] };

const normal = (text: string) => text.normalize("NFC").trim().toLocaleLowerCase("vi");

const blank = (cell: Cell | undefined) =>
  cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === "");

const pad = (value: number) => String(value).padStart(2, "0");

/** Ô ngày của Excel về ngày theo lịch: read-excel-file trả Date lúc 0 giờ UTC, đọc theo giờ máy thì lệch một ngày. */
const isoDate = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/** Chữ hiện ở xem trước: đúng điều người dùng đã gõ, để họ tìm lại ô trong bảng tính. */
function cellText(cell: Cell | undefined): string {
  if (blank(cell)) return "";
  if (cell instanceof Date) return isoDate(cell);
  return String(cell).trim();
}

/**
 * Số gõ dạng chữ: dấu phẩy là dấu thập phân như Excel tiếng Việt ghi ra CSV ("12,5"), dấu chấm cũng nhận ("12.5");
 * có cả hai thì dấu chấm ngăn hàng nghìn ("1.234,5"). Cách viết khác trả undefined thay vì đoán.
 */
export function parseNumber(text: string): number | undefined {
  const compact = text.replace(/\s/g, "");
  if (/^[+-]?\d+([.,]\d+)?$/.test(compact)) return Number(compact.replace(",", "."));
  if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(compact)) return Number(compact.replaceAll(".", "").replace(",", "."));
  return undefined;
}

/** Ngày gõ dạng chữ: năm-tháng-ngày hoặc ngày/tháng/năm; ngày không có thật (31/02) thì không nhận. */
export function parseDate(text: string): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const vn = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const parts = iso ? [iso[1], iso[2], iso[3]] : vn ? [vn[3], vn[2], vn[1]] : undefined;
  if (!parts) return undefined;
  const [year, month, day] = parts.map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return isoDate(date);
}

type Coerced = { value?: unknown; error?: string };

function coerceNumber(field: FormField, cell: Cell): Coerced {
  const value = typeof cell === "number" ? cell : typeof cell === "string" ? parseNumber(cell) : undefined;
  if (value === undefined || !Number.isFinite(value)) return { error: "Cần một số, ví dụ 12,5" };
  if (field.type === "integer" && !Number.isInteger(value)) return { error: "Cần một số nguyên" };
  return { value };
}

function coerceChoice(field: FormField, cell: Cell): Coerced {
  const text = normal(cellText(cell));
  const choices = field.choices ?? [];
  const found = choices.find((choice) => normal(choice.label) === text || normal(choice.value) === text);
  if (found) return { value: found.value };
  return { error: `Chọn một trong: ${choices.map((choice) => choice.label).join(", ")}` };
}

/** Đổi một ô theo kiểu của trường; ô trống là chưa điền, để bộ kiểm của biểu mẫu báo nếu trường bắt buộc. */
export function coerce(field: FormField, cell: Cell | undefined): Coerced {
  if (cell === undefined || blank(cell)) return {};
  switch (field.type) {
    case "number":
    case "integer":
      return coerceNumber(field, cell);
    case "date": {
      const value = cell instanceof Date ? isoDate(cell) : parseDate(cellText(cell));
      return value ? { value } : { error: "Cần ngày dạng ngày/tháng/năm" };
    }
    case "choice":
      return coerceChoice(field, cell);
    default:
      // Mã gõ là số (101) thì Excel lưu thành ô số; trường chữ nhận lại đúng chữ đó.
      return { value: cellText(cell) };
  }
}

const isBlankRow = (row: Cell[]) => row.every((cell) => blank(cell));

/** Vị trí cột của từng trường theo tiêu đề (nhãn của trường, hay tên trường); lỗi khi thiếu, thừa hay trùng cột. */
export function headerColumns(form: FormConfig, header: Cell[]): { columns: Map<string, number>; problems: string[] } {
  const columns = new Map<string, number>();
  const problems: string[] = [];
  header.forEach((cell, index) => {
    const title = cellText(cell);
    if (title === "") return;
    const field = form.fields.find((f) => normal(f.label) === normal(title) || normal(f.name) === normal(title));
    if (!field) problems.push(`Cột "${title}" không có trong tệp mẫu. Xóa cột đó hoặc dùng tệp mẫu.`);
    else if (columns.has(field.name)) problems.push(`Cột "${field.label}" có hai lần. Giữ một cột.`);
    else columns.set(field.name, index);
  });
  for (const field of form.fields) {
    if (field.required && !columns.has(field.name)) problems.push(`Thiếu cột "${field.label}".`);
  }
  return { columns, problems };
}

/** Lỗi đầu tiên của từng trường theo bộ kiểm của biểu mẫu, cùng thông điệp tiếng Việt với biểu mẫu nhập tay. */
function schemaErrors(form: FormConfig, values: Values): Record<string, string> {
  const { schema } = formSchema(form);
  const errors: Record<string, string> = {};
  for (const error of formValidator.validateFormData(values, schema).errors) {
    const name = (error.property ?? "").replace(/^\./, "");
    if (name && errors[name] === undefined) errors[name] = error.message ?? "Giá trị không hợp lệ";
  }
  return errors;
}

function checkRow(form: FormConfig, columns: Map<string, number>, row: Cell[], line: number): ImportRow {
  const values: Values = {};
  const shown: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const field of form.fields) {
    const index = columns.get(field.name);
    const cell = index === undefined ? undefined : row[index];
    shown[field.name] = cellText(cell);
    const { value, error } = coerce(field, cell);
    if (error) errors[field.name] = error;
    else if (value !== undefined) values[field.name] = value;
  }
  // Ô đã sai kiểu thì giữ lỗi đổi kiểu, rõ hơn lỗi "bắt buộc nhập" mà bộ kiểm báo cho ô bị bỏ.
  for (const [name, message] of Object.entries(schemaErrors(form, values))) errors[name] ??= message;
  return { line, values: payloadOf(form, values), shown, errors };
}

/**
 * Đọc lưới ô thành các dòng đã kiểm. Dòng đầu có chữ là tiêu đề; dòng trống bị bỏ qua; số dòng là số của bảng tính
 * (tiêu đề ở dòng 1 thì dòng dữ liệu đầu là 2), để người dùng tìm đúng dòng trong Excel.
 */
export function checkSheet(form: FormConfig, grid: Grid, maxRows: number): ImportSheet {
  const start = grid.findIndex((row) => !isBlankRow(row));
  const header = grid[start];
  if (start < 0 || !header) return { problems: ["Tệp trống. Điền dữ liệu vào tệp mẫu rồi chọn lại."], rows: [] };
  const { columns, problems } = headerColumns(form, header);
  if (problems.length > 0) return { problems, rows: [] };
  const data = grid.map((row, index) => ({ row, line: index + 1 })).slice(start + 1);
  const filled = data.filter(({ row }) => !isBlankRow(row));
  if (filled.length === 0) return { problems: ["Tệp không có dòng dữ liệu nào dưới dòng tiêu đề."], rows: [] };
  if (filled.length > maxRows) {
    return {
      problems: [`Tệp có ${filled.length} dòng, mỗi lần nạp tối đa ${maxRows} dòng. Tách tệp rồi nạp từng phần.`],
      rows: [],
    };
  }
  return { problems: [], rows: filled.map(({ row, line }) => checkRow(form, columns, row, line)) };
}

const keyText = (value: unknown) => (value === undefined || value === null ? "" : String(value));

/** Đánh dấu giá trị trùng nhau trong tệp: mỗi dòng trùng chỉ tới các dòng còn lại mang cùng giá trị. */
export function markDuplicates(rows: ImportRow[], unique: string): ImportRow[] {
  const lines = new Map<string, number[]>();
  for (const row of rows) {
    const key = keyText(row.values[unique]);
    if (key !== "") lines.set(key, [...(lines.get(key) ?? []), row.line]);
  }
  return rows.map((row) => {
    const others = (lines.get(keyText(row.values[unique])) ?? []).filter((line) => line !== row.line);
    if (others.length === 0 || row.errors[unique]) return row;
    return { ...row, errors: { ...row.errors, [unique]: `Trùng với dòng ${others.join(", ")}` } };
  });
}

/** Đánh dấu dòng mà giá trị unique đã có ở dòng con của cùng dòng cha. */
export function markExisting(rows: ImportRow[], unique: string, existing: unknown[]): ImportRow[] {
  const taken = new Set(existing.map(keyText));
  return rows.map((row) => {
    if (row.errors[unique] || !taken.has(keyText(row.values[unique]))) return row;
    return { ...row, errors: { ...row.errors, [unique]: "Đã có trong danh sách hiện tại" } };
  });
}

export const hasErrors = (row: ImportRow) => Object.keys(row.errors).length > 0;

/** Câu đọc các giá trị unique đã có dưới dòng cha; tên bảng, cột đã qua configProblems, giá trị đi qua biến. */
export function existingQuery(table: string, via: string, unique: string, parentKey: unknown, rows: ImportRow[]) {
  const values = [...new Set(rows.map((row) => row.values[unique]).filter((value) => keyText(value) !== ""))];
  return {
    query: `query($where: ${table}_bool_exp!) { rows: ${table}(where: $where) { ${unique} } }`,
    variables: { where: { _and: [{ [via]: { _eq: parentKey } }, { [unique]: { _in: values } }] } },
  };
}

/**
 * Lệnh thêm mọi dòng trong một mutation: Hasura chạy cả danh sách trong một giao dịch, một dòng vi phạm ràng buộc
 * thì không dòng nào được thêm. Chia thành nhiều lệnh thì lỗi giữa chừng để lại nửa tệp đã vào.
 */
export const insertManyMutation = (table: string) =>
  `mutation($objects: [${table}_insert_input!]!) { result: insert_${table}(objects: $objects) { affected_rows } }`;

/** Dòng gửi đi: khóa của dòng cha đặt sau cùng, tệp không ghi đè được cột này dù có cột cùng tên. */
export const importObjects = (rows: ImportRow[], via: string, parentKey: unknown) =>
  rows.map((row) => ({ ...row.values, [via]: parentKey }));
