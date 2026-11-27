// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Cấu hình của thành phần bản đồ (contracts/map.schema.json): kiểu dữ liệu, lỗi cấu hình mà schema không bắt được,
// câu truy vấn của từng lớp, lớp nào được truy vấn với vai trò trong token, và cách đổi một dòng thành một điểm có
// màu. Phần hiển thị ở MapPanel.tsx và MapCanvas.tsx. Không có React ở đây để kiểm thử được bằng hàm thuần.

import { display } from "./catalog";

/** Tên màu trong bảng màu của Mantine; điểm và chú giải dùng biến CSS của theme theo tên này. */
export type Swatch = string;

export type MapField = { name: string; label: string; type?: "text" | "number" };

export type Step = { above?: number; color: Swatch; label: string };

export type LayerColor = { fixed: Swatch } | { by: string; label: string; steps: Step[] };

export type Layer = {
  id: string;
  label: string;
  source: string;
  role?: string;
  latitude: string;
  longitude: string;
  title: string;
  where?: { field: string; equals: string };
  fields?: MapField[];
  color: LayerColor;
  limit?: number;
};

/** [kinh độ, vĩ độ] theo WGS 84, cùng thứ tự với GeoJSON và MapLibre. */
export type Position = [number, number];

export type Area = { name: string; outline: Position[] };

/** Các vùng cố định của cấu hình (ranh giới...), vẽ dưới điểm; mapAreas.ts dựng hình và tìm vùng chứa điểm. */
export type Areas = { label: string; color: Swatch; items: Area[] };

export type MapConfig = { title: string; layers: Layer[]; areas?: Areas; note?: string };

export type Row = Record<string, unknown>;

/** Một điểm sẵn sàng để vẽ: vị trí, tên, màu, nhãn của màu và các trường hiện khi chọn. */
export type Point = {
  key: string;
  layer: Layer;
  latitude: number;
  longitude: number;
  title: string;
  color: Swatch;
  colorLabel: string;
  row: Row;
};

// Màu của dòng chưa có giá trị để tô: khác mọi bậc mà gói khai nên không bị đọc nhầm thành "không vượt".
export const MISSING_COLOR: Swatch = "gray";
export const MISSING_LABEL = "Chưa có số liệu";

export const limitOf = (layer: Layer) => layer.limit ?? 200;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const ROLE = /^[a-z][a-z0-9_]*$/;

const pathsOf = (layer: Layer) => [
  layer.latitude,
  layer.longitude,
  layer.title,
  ...(layer.fields ?? []).map((field) => field.name),
  ...("by" in layer.color ? [layer.color.by] : []),
];

const ascending = (steps: Step[]) =>
  steps.every((step, index) => {
    if (index === 0) return step.above === undefined;
    const previous = steps[index - 1]?.above ?? Number.NEGATIVE_INFINITY;
    return step.above !== undefined && step.above > previous;
  });

/**
 * Lỗi của cấu hình mà schema không diễn đạt được, và luật tên mà câu truy vấn dựa vào. Cấu hình là dữ liệu của gói
 * chứ không phải mã, nên tên được kiểm lại ở đây trước khi ghép vào câu truy vấn: một tên chứa dấu ngoặc sẽ đổi nghĩa
 * câu truy vấn. Trả danh sách rỗng khi dùng được.
 */
export function mapProblems(config: MapConfig): string[] {
  const problems: string[] = [];
  const ids = config.layers.map((layer) => layer.id);
  for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) {
    problems.push(`hai lớp cùng tên ngắn "${id}"`);
  }
  // Tên vùng là nhãn trên bản đồ và mục trong chú giải; hai vùng cùng tên thì người xem không biết vùng nào là vùng nào.
  const areaNames = (config.areas?.items ?? []).map((area) => area.name);
  for (const name of new Set(areaNames.filter((name, index) => areaNames.indexOf(name) !== index))) {
    problems.push(`hai vùng cùng tên "${name}"`);
  }
  for (const layer of config.layers) {
    const names: [string, RegExp][] = [
      [layer.source, IDENTIFIER],
      ...(layer.where ? [[layer.where.field, IDENTIFIER] as [string, RegExp]] : []),
      ...pathsOf(layer).map((path): [string, RegExp] => [path, PATH]),
    ];
    for (const [name, rule] of names) {
      if (!rule.test(name)) {
        problems.push(`${layer.label}: "${name}" không phải tên hợp lệ (chỉ chữ không dấu, số, gạch dưới)`);
      }
    }
    // Vai trò đi vào header của yêu cầu; một giá trị lạ có thể là header khác.
    if (layer.role !== undefined && !ROLE.test(layer.role)) {
      problems.push(`${layer.label}: vai trò "${layer.role}" không hợp lệ`);
    }
    // Bậc được xét từ trên xuống; ngưỡng không tăng dần thì một bậc không bao giờ được chọn mà không ai biết.
    if ("by" in layer.color && !ascending(layer.color.steps)) {
      problems.push(`${layer.label}: bậc màu đầu không có above, các bậc sau có above tăng dần`);
    }
  }
  return problems;
}

/** Lớp người xem được truy vấn: lớp không khai vai trò, hoặc lớp có vai trò nằm trong token. */
export const visibleLayers = (config: MapConfig, roles: string[]) =>
  config.layers.filter((layer) => layer.role === undefined || roles.includes(layer.role));

type Tree = Map<string, Tree>;

// Đường dẫn có dấu chấm đi qua quan hệ: summary.excess_m2 thành summary { excess_m2 }.
function selection(paths: string[]): string {
  const tree: Tree = new Map();
  for (const path of paths) {
    let node = tree;
    for (const part of path.split(".")) {
      const next = node.get(part) ?? new Map();
      node.set(part, next);
      node = next;
    }
  }
  const render = (node: Tree): string =>
    [...node].map(([name, child]) => (child.size ? `${name} { ${render(child)} }` : name)).join(" ");
  return render(tree);
}

// Một đường dẫn thành một mục order_by của Hasura: summary.excess_m2 thành { summary: { excess_m2: "asc" } }.
const ascendingBy = (path: string): Row =>
  path.split(".").reduceRight<unknown>((inner, part) => ({ [part]: inner }), "asc") as Row;

/**
 * Câu truy vấn của một lớp. Điều kiện where đi qua biến của câu truy vấn, không ghép vào chuỗi. Xin thừa một dòng so
 * với trần để biết lớp còn điểm chưa hiện.
 */
export function layerQuery(layer: Layer): { query: string; variables: Record<string, unknown> } {
  const where = layer.where ? { [layer.where.field]: { _eq: layer.where.equals } } : {};
  // Không xếp thì CSDL trả dòng theo thứ tự tùy ý, và lớp quá trần hiện một nhóm dòng khác sau mỗi lần tải. Xếp theo
  // tên rồi mọi cột còn lại đang đọc: lớp không khai khóa (view tổng hợp có thể không có cột id), nên hai dòng chỉ
  // còn đổi chỗ khi mọi giá trị hiện ra đều giống nhau.
  const order = [...new Set([layer.title, ...pathsOf(layer)])].map(ascendingBy);
  return {
    query:
      `query($where: ${layer.source}_bool_exp!, $order_by: [${layer.source}_order_by!], $limit: Int!) ` +
      `{ rows: ${layer.source}(where: $where, order_by: $order_by, limit: $limit) { ${selection(pathsOf(layer))} } }`,
    variables: { where, order_by: order, limit: limitOf(layer) + 1 },
  };
}

/** Giá trị theo đường dẫn có dấu chấm; quan hệ trống thì trả undefined. */
export function valueAt(row: Row, path: string): unknown {
  let value: unknown = row;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Row)[part];
  }
  return value;
}

// Giá trị số có thể đến dạng chuỗi thập phân, ví dụ khi Hasura bật HASURA_GRAPHQL_STRINGIFY_NUMERIC_TYPES; để nguyên
// chuỗi thì trường number hiện "1234.50" thay vì "1.234,5". Chỉ nhận dạng thập phân thường: Number() còn nhận "1e5",
// "0x10" hay chuỗi toàn khoảng trắng, và đổi các chuỗi đó thành số là hiện sai giá trị.
const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Chữ hiện ra cho một trường của điểm; trường number nhận cả số lẫn chuỗi thập phân và viết theo kiểu Việt Nam. */
export function fieldText(field: MapField, value: unknown): string {
  const numeric = field.type === "number" && typeof value === "string" && DECIMAL.test(value) ? Number(value) : value;
  return display(field, numeric);
}

/** Màu và nhãn màu của một dòng: bậc cuối cùng có above nhỏ hơn giá trị, hoặc bậc đầu. */
export function colorOf(color: LayerColor, row: Row, layerLabel: string): { color: Swatch; label: string } {
  if ("fixed" in color) return { color: color.fixed, label: layerLabel };
  const raw = valueAt(row, color.by);
  const value = typeof raw === "number" ? raw : Number(raw);
  if (raw === null || raw === undefined || raw === "" || Number.isNaN(value)) {
    return { color: MISSING_COLOR, label: MISSING_LABEL };
  }
  const step = color.steps.findLast((candidate) => candidate.above === undefined || value > candidate.above);
  return step ? { color: step.color, label: step.label } : { color: MISSING_COLOR, label: MISSING_LABEL };
}

const coordinate = (value: unknown) => (value === null || value === undefined || value === "" ? NaN : Number(value));

/** Điểm của các dòng có tọa độ hợp lệ, và số dòng bỏ qua vì thiếu hay sai tọa độ. */
export function pointsOf(layer: Layer, rows: Row[]): { points: Point[]; unplaced: number } {
  const points: Point[] = [];
  rows.forEach((row, index) => {
    const latitude = coordinate(valueAt(row, layer.latitude));
    const longitude = coordinate(valueAt(row, layer.longitude));
    if (!(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180)) return;
    const { color, label } = colorOf(layer.color, row, layer.label);
    const title = String(valueAt(row, layer.title) ?? "");
    points.push({ key: `${layer.id}/${index}`, layer, latitude, longitude, title, color, colorLabel: label, row });
  });
  return { points, unplaced: rows.length - points.length };
}
