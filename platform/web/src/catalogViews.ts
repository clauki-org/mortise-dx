// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần thuần của hai kiểu Kanban và Lịch của danh mục (ADR 0066, mục kanban, calendar của
// contracts/catalog.schema.json): kiểu nào vẽ được, lỗi cấu hình, cột của bảng Kanban và câu truy vấn mỗi cột một bí
// danh, cột nào chuyển thẻ vào, ra được, khoảng ngày của lịch theo tháng hay tuần và câu truy vấn theo khoảng đó. Phần
// vẽ ở CatalogKanban.tsx và CatalogCalendar.tsx. Không có React ở đây để kiểm thử được bằng hàm thuần.

import { type CatalogConfig, type CatalogNode, type Field, fieldOf, firstColumn, keyOf, pageSize } from "./catalog";
import { type ListState, listVariables, type View } from "./catalogQuery";
import type { Tone } from "./tones";

export type { View };

/** Chữ của từng kiểu trên nút "Kiểu hiển thị", theo thứ tự hiện. */
export const VIEW_LABELS: Record<View, string> = { table: "Bảng", cards: "Thẻ", kanban: "Kanban", calendar: "Lịch" };

export type KanbanConfig = { field: string; move?: { role?: string; version: string }; locked?: string[] };
export type CalendarConfig = { field: string; title?: string };

/** Bảng và thẻ luôn có; Kanban, Lịch chỉ khi cấu hình khai mục của nó, vì thiếu mục đó thì không biết chia theo gì. */
export function viewsOf(config: CatalogConfig): View[] {
  const views: View[] = ["table", "cards"];
  if (config.kanban) views.push("kanban");
  if (config.calendar) views.push("calendar");
  return views;
}

/** Kiểu sẽ vẽ: kiểu người xem chọn nếu vẽ được, không thì kiểu mặc định nếu vẽ được, không thì bảng. */
export function viewOf(views: readonly View[], chosen: string | undefined, fallback: string | undefined): View {
  const usable = (value: string | undefined): value is View => views.includes(value as View);
  if (usable(chosen)) return chosen;
  return usable(fallback) ? fallback : "table";
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ROLE = /^[a-z][a-z0-9_]*$/;

/** Trường mà kiểu dựa vào phải là cột của chính bảng đã khai: tên ghép thẳng vào câu truy vấn và điều kiện. */
function ownField(config: CatalogNode, at: string, name: string): string[] {
  if (!IDENTIFIER.test(name)) return [`${at} chỉ nhận cột của chính bảng, không nhận "${name}"`];
  if (!fieldOf(config, name)) return [`${at} dùng trường "${name}" chưa khai trong fields`];
  return [];
}

/**
 * Lỗi của mục kanban, calendar mà schema không diễn đạt được. Cấu hình đọc từ CSDL, không qua schema lúc chạy, nên tên
 * cột vai trò cũng được kiểm lại trước khi vào câu truy vấn hay header.
 */
export function viewProblems(config: CatalogConfig): string[] {
  const problems: string[] = [];
  const { kanban, calendar } = config;
  if (kanban) {
    const found = ownField(config, "kanban.field", kanban.field);
    problems.push(...found);
    const field = fieldOf(config, kanban.field);
    if (found.length === 0 && !field?.choices)
      problems.push(`kanban.field dùng trường "${kanban.field}" không có choices`);
    const values = (field?.choices ?? []).map((choice) => choice.value);
    for (const value of kanban.locked ?? []) {
      if (field?.choices && !values.includes(value))
        problems.push(`kanban.locked có "${value}" không nằm trong choices`);
    }
    const move = kanban.move;
    if (move && !IDENTIFIER.test(move.version))
      problems.push(`kanban.move.version "${move.version}" không phải tên cột`);
    if (move?.role !== undefined && !ROLE.test(move.role))
      problems.push(`kanban.move.role "${move.role}" không hợp lệ`);
  }
  if (calendar) {
    const found = ownField(config, "calendar.field", calendar.field);
    problems.push(...found);
    const type = fieldOf(config, calendar.field)?.type;
    if (found.length === 0 && type !== "date" && type !== "datetime") {
      problems.push(`calendar.field dùng trường "${calendar.field}" không phải kiểu date hay datetime`);
    }
    if (calendar.title !== undefined) problems.push(...ownField(config, "calendar.title", calendar.title));
  }
  return problems;
}

/** Một cột của bảng Kanban: bí danh trong câu truy vấn, giá trị của lựa chọn (cột cuối không có), chữ, nghĩa màu. */
export type BoardColumn = { alias: string; value?: string; label: string; tone?: Tone; locked: boolean };

/**
 * Cột theo thứ tự choices, thêm cột cuối cho dòng có giá trị trống hay ngoài choices: bỏ chúng đi thì dòng có thật mà
 * không hiện ở đâu. Cột cuối không nhận thẻ chuyển vào vì không có giá trị nào để ghi.
 */
export function boardColumns(field: Field, kanban: KanbanConfig): BoardColumn[] {
  const locked = new Set(kanban.locked ?? []);
  const columns: BoardColumn[] = (field.choices ?? []).map((choice, index) => ({
    alias: `c${index}`,
    value: choice.value,
    label: choice.label,
    tone: choice.tone,
    locked: locked.has(choice.value),
  }));
  return [...columns, { alias: "cx", label: "Chưa xếp cột", locked: false }];
}

/** Thẻ ở cột bị khóa (giá trị do quy trình đặt) không chuyển đi được. */
export const canLeave = (column: BoardColumn) => !column.locked;
/** Cột nhận thẻ chuyển vào: có giá trị để ghi và không bị khóa. */
export const canEnter = (column: BoardColumn) => column.value !== undefined && !column.locked;

/** Cột mà một thẻ ở cột `from` chuyển sang được, theo thứ tự hiện. */
export function moveTargets(columns: BoardColumn[], from: BoardColumn): BoardColumn[] {
  if (!canLeave(from)) return [];
  return columns.filter((column) => column !== from && canEnter(column));
}

/** Cột chọn đọc cho mỗi thẻ: khóa, cột của list.columns, trường chia cột và cột version khi chuyển được thẻ. */
export function boardSelection(config: CatalogNode, kanban: KanbanConfig): string[] {
  const names = [keyOf(config), ...config.list.columns, kanban.field];
  if (kanban.move) names.push(kanban.move.version);
  return [...new Set(names)];
}

/**
 * Một câu truy vấn, mỗi cột một bí danh với điều kiện riêng và giới hạn riêng: đọc chung một trang rồi chia theo cột
 * thì cột có dòng vẫn trông rỗng khi các dòng đó nằm ở trang sau.
 */
export function boardQuery(config: CatalogNode, kanban: KanbanConfig, columns: BoardColumn[]): string {
  const source = config.source;
  const parameters = columns.map((column) => `$${column.alias}: ${source}_bool_exp!`).join(", ");
  const selection = boardSelection(config, kanban).join(" ");
  const parts = columns.map(
    (column) =>
      `${column.alias}: ${source}(where: $${column.alias}, order_by: $order_by, limit: $limit) { ${selection} }`,
  );
  return `query(${parameters}, $order_by: [${source}_order_by!], $limit: Int!) { ${parts.join(" ")} }`;
}

/** Biến của câu Kanban: tìm, lọc, thứ tự như danh sách, thêm điều kiện của từng cột; xin thừa một thẻ để biết còn. */
export function boardVariables(
  config: CatalogNode,
  kanban: KanbanConfig,
  columns: BoardColumn[],
  state: ListState,
  fixed?: Record<string, unknown>,
) {
  const base = listVariables(config, { ...state, page: 0 }, fixed);
  const values = columns.flatMap((column) => (column.value === undefined ? [] : [column.value]));
  const variables: Record<string, unknown> = { order_by: base.order_by, limit: pageSize(config) + 1 };
  for (const column of columns) {
    const own =
      column.value === undefined
        ? { _or: [{ [kanban.field]: { _is_null: true } }, { [kanban.field]: { _nin: values } }] }
        : { [kanban.field]: { _eq: column.value } };
    variables[column.alias] = { _and: [base.where, own] };
  }
  return variables;
}

export type CalendarMode = "month" | "week";

/** Số dòng tối đa lịch đọc cho một khoảng ngày; quá thì lịch báo và người xem tìm, lọc để thu hẹp. */
export const CALENDAR_LIMIT = 200;

const pad = (value: number) => String(value).padStart(2, "0");
/** Ngày theo giờ của trình duyệt, dạng YYYY-MM-DD, làm khóa của ô lịch. */
export const dayKey = (day: Date) => `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
const addDays = (day: Date, count: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + count);
/** Thứ hai của tuần chứa ngày đó: tuần ở Việt Nam bắt đầu từ thứ hai. */
const monday = (day: Date) => addDays(day, -((day.getDay() + 6) % 7));

/**
 * Ngày mà một giá trị rơi vào. Cột date đọc nguyên phần ngày, như format.ts đọc theo UTC; cột datetime đổi về giờ của
 * trình duyệt, như ngày giờ hiện trên danh sách. Giá trị không có dạng ngày ISO thì không xếp được: Date của JavaScript
 * đọc cả chuỗi như "1" thành một năm, và dòng sẽ hiện sai ngày thay vì được báo.
 */
export function dayOf(field: Field, value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return undefined;
  if (field.type === "date") return value.slice(0, 10);
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? undefined : dayKey(time);
}

/** Các ngày đang xem: theo tháng là đủ tuần từ thứ hai đầu tới chủ nhật cuối, theo tuần là bảy ngày. */
export function calendarDays(mode: CalendarMode, cursor: Date): Date[] {
  const first = mode === "month" ? monday(new Date(cursor.getFullYear(), cursor.getMonth(), 1)) : monday(cursor);
  const last = mode === "month" ? new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0) : addDays(first, 6);
  const count = Math.round((addDays(monday(last), 7).getTime() - first.getTime()) / 86_400_000);
  return Array.from({ length: mode === "month" ? count : 7 }, (_, index) => addDays(first, index));
}

/** Tháng hay tuần trước, sau của ngày đang đứng. */
export function shiftCursor(mode: CalendarMode, cursor: Date, step: number): Date {
  if (mode === "week") return addDays(cursor, step * 7);
  return new Date(cursor.getFullYear(), cursor.getMonth() + step, 1);
}

/** Tên của khoảng đang xem, ví dụ "Tháng 11/2026" hay "23/11/2026 – 29/11/2026". */
export function rangeLabel(mode: CalendarMode, cursor: Date, days: Date[]): string {
  if (mode === "month") return `Tháng ${cursor.getMonth() + 1}/${cursor.getFullYear()}`;
  const text = (day: Date) => `${pad(day.getDate())}/${pad(day.getMonth() + 1)}/${day.getFullYear()}`;
  const [first] = days;
  const last = days[days.length - 1];
  return first && last ? `${text(first)} – ${text(last)}` : "";
}

/** Trường hiện trên lịch: calendar.title, không thì cột đầu của danh sách. */
export const calendarTitle = (config: CatalogNode, calendar: CalendarConfig) => calendar.title ?? firstColumn(config);

export function calendarQuery(config: CatalogNode, calendar: CalendarConfig): string {
  const source = config.source;
  const selection = [...new Set([keyOf(config), calendar.field, calendarTitle(config, calendar)])].join(" ");
  return (
    `query($where: ${source}_bool_exp!, $order_by: [${source}_order_by!], $limit: Int!) ` +
    `{ rows: ${source}(where: $where, order_by: $order_by, limit: $limit) { ${selection} } }`
  );
}

/**
 * Biến của câu lịch: tìm, lọc như danh sách, thêm khoảng ngày [ngày đầu, ngày sau ngày cuối). Cột date so bằng chuỗi
 * ngày; cột datetime so bằng nửa đêm theo giờ của trình duyệt, để dòng lúc 23 giờ không rơi sang ô của ngày hôm sau.
 */
export function calendarVariables(
  config: CatalogNode,
  calendar: CalendarConfig,
  field: Field,
  state: ListState,
  days: Date[],
  fixed?: Record<string, unknown>,
) {
  const base = listVariables(config, { ...state, page: 0 }, fixed);
  const first = days[0] ?? new Date();
  const after = addDays(days[days.length - 1] ?? first, 1);
  const bound = (day: Date) => (field.type === "date" ? dayKey(day) : day.toISOString());
  return {
    where: { _and: [base.where, { [calendar.field]: { _gte: bound(first), _lt: bound(after) } }] },
    order_by: [{ [calendar.field]: "asc" }, { [keyOf(config)]: "asc" }],
    limit: CALENDAR_LIMIT + 1,
  };
}
