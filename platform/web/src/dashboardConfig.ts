// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Cấu hình của thành phần bảng điều hành (contracts/dashboard.schema.json): kiểu dữ liệu, lỗi cấu hình mà schema
// không bắt được, khối nào được truy vấn với vai trò trong token, câu truy vấn của từng khối, cách viết một số và độ
// dài của thanh. Mức độ của thẻ, vòng đo và bề rộng trên lưới ở dashboardBento.ts. Hai nguồn REST (workflow, context) ở dashboardSources.ts; phần hiển thị ở DashboardView.tsx và
// DashboardPanel.tsx. Không có React ở đây để kiểm thử được bằng hàm thuần. Thành phần không cộng hay đếm gì: mọi số là
// cột mà nguồn trả (ADR 0033), trừ số việc đang chờ chính người xem (ADR 0035, dashboardSources.ts).

import { createRequest, formatDocument, stringifyDocument } from "urql";
import { type ContextSource, restProblems, type WorkflowSource } from "./dashboardSources";

/** Một mức độ của thẻ: đúng một phép so với hằng số và chữ hiện cạnh số khi khớp (ADR 0049). */
export type Level = { gt?: number; gte?: number; lt?: number; lte?: number; label: string };

export type Card = {
  column: string;
  label: string;
  unit?: string;
  format?: "number" | "integer";
  description: string;
  tone?: { warn_when?: Level; bad_when?: Level };
};

/** Vòng đo của khối thẻ số: ba cột của cùng dòng; percent do gói tính sẵn (ADR 0049). */
export type Gauge = { value: string; limit: string; percent: string; label: string };

export type Series = { column: string; label: string; color: string };

export type Chart = {
  type: "bar";
  /** Trần của thang; bỏ trống là số lớn nhất trong khối */
  max?: number;
  x: { column: string; label: string; choices?: { value: string; label: string }[] };
  y: Series[];
  details?: { column: string; label: string; format?: Card["format"] }[];
};

export type GraphqlSource = {
  field: string;
  where?: { field: string; equals: string };
  order_by?: { column: string; direction?: "asc" | "desc" }[];
  limit?: number;
};

export type Panel = {
  id: string;
  title: string;
  description: string;
  /** Cách tính và ghi chú kỹ thuật; chỉ hiện trong mục "Xem cách tính" (ADR 0045) */
  method?: string;
  primary?: boolean;
  size?: "quarter" | "half" | "full";
  role?: string;
  graphql?: GraphqlSource;
  workflow?: WorkflowSource;
  context?: ContextSource;
  cards?: Card[];
  gauge?: Gauge;
  chart?: Chart;
  link?: { menu: string; label: string };
};

export type DashboardConfig = { title: string; description?: string; variant?: string; panels: Panel[] };

export type Row = Record<string, unknown>;

export type PanelQuery = { query: string; variables: { where: Row; order_by: Row[]; limit: number } };

/** Tên màu của bảng màu Mantine mà schema cho phép; màu đi vào tên biến CSS nên được kiểm lại lúc chạy. */
export const PALETTE = [
  "dark",
  "gray",
  "red",
  "pink",
  "grape",
  "violet",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "green",
  "lime",
  "yellow",
  "orange",
];

export const NO_DATA = "Chưa có số liệu";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ROLE = /^[a-z][a-z0-9_]*$/;

/** Vai trò gửi kèm truy vấn của khối. Luôn gửi, kể cả user: bỏ header thì Hasura dùng vai trò mặc định của token. */
export const panelRole = (panel: Panel) => panel.role ?? "user";

export const limitOf = (panel: Panel) => panel.graphql?.limit ?? 50;

/** Loại nguồn của khối. */
export const sourceKind = (panel: Panel) => (panel.workflow ? "workflow" : panel.context ? "context" : "graphql");

/** Các cột mà khối đọc ra để hiện (thẻ, vòng đo, biểu đồ), theo thứ tự khai, không trùng. */
export function columnsOf(panel: Panel): string[] {
  const chart = panel.chart;
  const gauge = panel.gauge ? [panel.gauge.value, panel.gauge.limit, panel.gauge.percent] : [];
  const names = chart
    ? [chart.x.column, ...chart.y.map((series) => series.column), ...(chart.details ?? []).map((d) => d.column)]
    : [...(panel.cards ?? []).map((card) => card.column), ...gauge];
  return [...new Set(names)];
}

/** Phép so của một mức độ: lớn hơn, lớn hơn hay bằng, nhỏ hơn, nhỏ hơn hay bằng. */
export const OPERATORS = ["gt", "gte", "lt", "lte"] as const;

/** Mức độ dùng được: đúng một phép so với một số hữu hạn, có chữ. */
const levelUsable = (level: Level) =>
  OPERATORS.filter((key) => level[key] !== undefined).length === 1 &&
  OPERATORS.every((key) => level[key] === undefined || Number.isFinite(level[key])) &&
  typeof level.label === "string" &&
  level.label.trim() !== "";

/** Lỗi của khối thẻ số mới (ADR 0049): mức độ của thẻ, vòng đo, trần của biểu đồ. */
function bentoProblems(panel: Panel): string[] {
  const problems: string[] = [];
  for (const card of panel.cards ?? []) {
    const levels = [card.tone?.warn_when, card.tone?.bad_when].filter((level) => level !== undefined);
    if (levels.some((level) => !levelUsable(level))) {
      problems.push(`${panel.title}: mức độ của thẻ "${card.label}" cần đúng một phép so với một số và có chữ`);
    }
  }
  const gauge = panel.gauge;
  if (gauge) {
    const shown = (panel.cards ?? []).map((card) => card.column);
    if (!panel.graphql || !panel.cards || panel.size === "quarter") {
      problems.push(`${panel.title}: vòng đo cần nguồn graphql, thẻ số và khối rộng hơn một phần tư hàng`);
    } else if (!shown.includes(gauge.value) || !shown.includes(gauge.limit)) {
      problems.push(`${panel.title}: value, limit của vòng đo phải là cột của một thẻ trong khối`);
    }
  }
  const max = panel.chart?.max;
  if (max !== undefined && !(Number.isFinite(max) && max > 0)) {
    problems.push(`${panel.title}: trần của biểu đồ phải là số lớn hơn 0`);
  }
  return problems;
}

function panelNames(panel: Panel): string[] {
  const source = panel.graphql;
  if (!source) return [];
  return [
    source.field,
    ...columnsOf(panel),
    ...(source.where ? [source.where.field] : []),
    ...(source.order_by ?? []).map((order) => order.column),
  ];
}

/**
 * Lỗi của cấu hình mà schema không diễn đạt được, và luật tên mà câu truy vấn dựa vào. Cấu hình là dữ liệu của gói
 * chứ không phải mã, nên tên được kiểm lại ở đây trước khi ghép vào câu truy vấn, vai trò trước khi vào header, và
 * màu trước khi vào tên biến CSS. Trả danh sách rỗng khi dùng được.
 */
export function dashboardProblems(config: DashboardConfig): string[] {
  const problems: string[] = [];
  const ids = config.panels.map((panel) => panel.id);
  for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) {
    problems.push(`hai khối cùng tên ngắn "${id}"`);
  }
  config.panels.forEach((panel, index) => {
    problems.push(...restProblems(panel), ...bentoProblems(panel));
    for (const name of panelNames(panel)) {
      if (!IDENTIFIER.test(name)) {
        problems.push(`${panel.title}: "${name}" không phải tên hợp lệ (chỉ chữ không dấu, số, gạch dưới)`);
      }
    }
    if (!ROLE.test(panelRole(panel))) problems.push(`${panel.title}: vai trò "${panel.role}" không hợp lệ`);
    for (const series of panel.chart?.y ?? []) {
      if (!PALETTE.includes(series.color))
        problems.push(`${panel.title}: màu "${series.color}" không có trong bảng màu`);
    }
    const series = (panel.chart?.y ?? []).map((item) => item.column);
    if (new Set(series).size !== series.length) problems.push(`${panel.title}: một cột khai hai lần trong chart.y`);
    if (panel.primary && (index > 0 || !panel.cards || panel.size === "quarter")) {
      problems.push(`${panel.title}: khối chính phải là khối đầu tiên, là thẻ số và rộng ít nhất nửa hàng`);
    }
  });
  return problems;
}

/** Khối người xem được truy vấn: vai trò của khối (bỏ trống là user) nằm trong token. */
export const visiblePanels = (config: DashboardConfig, roles: string[]) =>
  config.panels.filter((panel) => roles.includes(panelRole(panel)));

const orderEntry = (column: string, direction: "asc" | "desc" = "asc"): Row => ({ [column]: direction });

/**
 * Câu truy vấn của một khối nguồn graphql. Điều kiện where đi qua biến, không ghép vào chuỗi. Thẻ số xin hai dòng
 * để biết nguồn trả nhiều hơn một dòng; biểu đồ xin thừa một dòng so với trần để biết còn dòng chưa hiện.
 */
export function panelQuery(panel: Panel & { graphql: GraphqlSource }): PanelQuery {
  const { field, where, order_by } = panel.graphql;
  // Không xếp thì CSDL trả dòng theo thứ tự tùy ý và biểu đồ quá trần hiện nhóm dòng khác sau mỗi lần tải; mặc định
  // xếp theo trục x rồi các cột còn lại để thứ tự chỉ đổi khi giá trị đổi.
  const order = order_by
    ? order_by.map((entry) => orderEntry(entry.column, entry.direction))
    : panel.chart
      ? columnsOf(panel).map((column) => orderEntry(column))
      : [];
  return {
    query:
      `query($where: ${field}_bool_exp!, $order_by: [${field}_order_by!], $limit: Int!) ` +
      `{ rows: ${field}(where: $where, order_by: $order_by, limit: $limit) { ${columnsOf(panel).join(" ")} } }`,
    variables: {
      where: where ? { [where.field]: { _eq: where.equals } } : {},
      order_by: order,
      limit: panel.chart ? limitOf(panel) + 1 : 2,
    },
  };
}

/**
 * Nguyên văn câu mà client gửi đi: cacheExchange của urql thêm __typename vào mỗi lựa chọn rồi in lại câu. Hiện câu
 * gốc thay vì câu này thì người xem chép về chạy lại sẽ không khớp từng ký tự với yêu cầu thật.
 */
export const sentText = (query: string) => stringifyDocument(formatDocument(createRequest(query, {}).query));

// Mã lỗi của Hasura khi câu hay biến không hợp với lược đồ, hay khi CSDL không đọc được giá trị theo kiểu của cột.
const CONFIG_ERRORS = ["validation-failed", "data-exception"];

/**
 * Lời báo khi nguồn từ chối câu truy vấn của khối. Hai mã lỗi trên thường do cấu hình của gói, kể cả where.equals
 * không hợp kiểu của cột: giá trị đó luôn gửi dạng chữ và make check-fast không biết kiểu cột (ADR 0033). Người xem
 * không tự sửa được, nên lời báo dẫn tới người quản trị kèm chỗ cần sửa, không bảo tải lại trang.
 */
// Trả null với lỗi không do cấu hình của gói (mạng, phiên hết hạn…): nơi gọi hiện ErrorNotice dùng chung (ADR 0046).
export function queryErrorText(panel: Panel, codes: string[], message: string): string | null {
  if (!codes.some((code) => CONFIG_ERRORS.includes(code))) return null;
  const where = panel.graphql?.where;
  const typed = where ? `, hoặc where.equals "${where.equals}" không hợp kiểu của cột ${where.field}` : "";
  return (
    `Hasura từ chối câu truy vấn: ${message}. Thường do cấu hình của gói: bảng hay cột không nằm trong quyền đọc ` +
    `của vai trò ${panelRole(panel)}${typed}. Báo người quản trị sửa cấu hình của gói.`
  );
}

// Hasura có thể trả số dạng chuỗi thập phân (HASURA_GRAPHQL_STRINGIFY_NUMERIC_TYPES). Chỉ nhận dạng thập phân thường:
// Number() còn nhận "1e5", "0x10" hay chuỗi toàn khoảng trắng, đổi các chuỗi đó thành số là hiện sai giá trị.
const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Giá trị số của một ô, hoặc undefined khi ô trống hay không phải số. */
export function numeric(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  return typeof value === "string" && DECIMAL.test(value) ? Number(value) : undefined;
}

const decimal = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 });
const whole = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

/** Chữ hiện ra cho một số theo kiểu Việt Nam; ô trống là "Chưa có số liệu", giá trị không phải số hiện nguyên văn. */
export function numberText(value: unknown, format: Card["format"] = "number"): string {
  if (value === null || value === undefined || value === "") return NO_DATA;
  const number = numeric(value);
  if (number === undefined) return String(value);
  return (format === "integer" ? whole : decimal).format(number);
}

/** Nhãn của một dòng trên trục x: nhãn trong choices nếu có, không thì giá trị. */
export function categoryText(chart: Chart, value: unknown): string {
  const choice = chart.x.choices?.find((candidate) => candidate.value === String(value));
  return choice ? choice.label : value === null || value === undefined ? "" : String(value);
}

/**
 * Độ dài thanh theo phần trăm của đầu mút thang; mọi cột số chung một thang để các thanh so được với nhau. Giá trị âm
 * hay không phải số thành thanh rỗng, giá trị trên trần (chart.max) thành thanh đầy; số cạnh thanh và bảng số liệu
 * vẫn ghi đúng giá trị.
 */
export function barPercents(chart: Chart, rows: Row[]): number[][] {
  const top = scaleTop(chart, rows);
  return rows.map((row) =>
    chart.y.map((series) => {
      const value = Math.max(numeric(row[series.column]) ?? 0, 0);
      return top > 0 ? Math.min((value / top) * 100, 100) : 0;
    }),
  );
}

/**
 * Đầu mút của thang chung: trần chart.max của gói nếu có, để số có trần tự nhiên (phần trăm) không trông như đầy khi
 * nó chỉ là số lớn nhất; không có thì giá trị lớn nhất trong khối, không nhỏ hơn 0.
 */
export const scaleTop = (chart: Chart, rows: Row[]) =>
  chart.max ?? Math.max(0, ...rows.flatMap((row) => chart.y.map((series) => numeric(row[series.column]) ?? 0)));

/**
 * Một thanh: độ dài, chữ số ghi cạnh thanh, và có vẽ không. Ô có số, kể cả 0, luôn có vạch để số 0 không bị nhìn
 * thành thiếu dòng; ô trống hay không phải số thì không vẽ, chỉ ghi chữ.
 */
export type BarMark = { percent: number; text: string; drawn: boolean };

export function barMarks(chart: Chart, rows: Row[]): BarMark[][] {
  const percents = barPercents(chart, rows);
  return rows.map((row, index) =>
    chart.y.map((series, at) => ({
      percent: percents[index]?.[at] ?? 0,
      text: numberText(row[series.column]),
      drawn: numeric(row[series.column]) !== undefined,
    })),
  );
}
