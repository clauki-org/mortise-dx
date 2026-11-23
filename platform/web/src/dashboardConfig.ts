// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Cấu hình của thành phần bảng điều hành (contracts/dashboard.schema.json): kiểu dữ liệu, lỗi cấu hình mà schema
// không bắt được, khối nào được truy vấn với vai trò trong token, câu truy vấn của từng khối, cách viết một số và độ
// dài của thanh. Phần hiển thị ở DashboardView.tsx và DashboardPanel.tsx. Không có React ở đây để kiểm thử được bằng
// hàm thuần. Thành phần không cộng hay đếm gì: mọi số là cột mà nguồn trả (ADR 0033).

import { createRequest, formatDocument, stringifyDocument } from "urql";

export type Card = { column: string; label: string; unit?: string; format?: "number" | "integer"; description: string };

export type Series = { column: string; label: string; color: string };

export type Chart = {
  type: "bar";
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
  role?: string;
  graphql?: GraphqlSource;
  workflow?: object;
  context?: object;
  cards?: Card[];
  chart?: Chart;
  link?: { menu: string; label: string };
};

export type DashboardConfig = { title: string; description?: string; panels: Panel[] };

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

/** Loại nguồn của khối; chỉ graphql được hỗ trợ, hai loại còn lại có trong schema cho bước sau. */
export const sourceKind = (panel: Panel) => (panel.workflow ? "workflow" : panel.context ? "context" : "graphql");

/** Các cột mà khối đọc ra để hiện, theo thứ tự khai, không trùng. */
export function columnsOf(panel: Panel): string[] {
  const chart = panel.chart;
  const names = chart
    ? [chart.x.column, ...chart.y.map((series) => series.column), ...(chart.details ?? []).map((d) => d.column)]
    : (panel.cards ?? []).map((card) => card.column);
  return [...new Set(names)];
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
  for (const panel of config.panels) {
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
  }
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
 * Độ dài thanh theo phần trăm của giá trị lớn nhất trong khối; mọi cột số chung một thang để các thanh so được với
 * nhau. Giá trị âm hay không phải số thành thanh rỗng; bảng số liệu vẫn ghi đúng giá trị.
 */
export function barPercents(chart: Chart, rows: Row[]): number[][] {
  const values = rows.map((row) => chart.y.map((series) => Math.max(numeric(row[series.column]) ?? 0, 0)));
  const top = Math.max(0, ...values.flat());
  return values.map((group) => group.map((value) => (top > 0 ? (value / top) * 100 : 0)));
}
