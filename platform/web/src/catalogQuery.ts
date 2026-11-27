// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Câu truy vấn GraphQL gửi Hasura và biến của nó, sinh từ cấu hình của thành phần danh mục (catalog.ts), cùng trạng
// thái danh sách (tìm, lọc, thứ tự, trang) và cách giữ trạng thái đó trên thanh địa chỉ. Câu truy vấn chỉ chứa tên
// lấy từ cấu hình, đã kiểm bằng configProblems; mọi thứ người dùng gõ hay lấy từ đường dẫn đi qua biến, nên Hasura
// nhận chúng là dữ liệu chứ không phải một phần của câu truy vấn.

import { type CatalogNode, firstColumn, keyOf, pageSize, type Sort, type Step, titleField } from "./catalog";

/**
 * Trạng thái của một danh sách: người dùng đang tìm gì, lọc gì, xếp theo gì, ở trang nào (trang đầu là 0), và có
 * đang xem dạng thẻ không (ADR 0050); không có view là dạng bảng mặc định.
 */
export type ListState = {
  search: string;
  filters: Record<string, string>;
  sort?: Sort;
  page: number;
  view?: "cards";
};

type Where = Record<string, unknown>;

export const emptyState: ListState = { search: "", filters: {}, page: 0 };

/** Câu truy vấn danh sách: các cột cần hiện, luôn kèm khóa để nối tới màn hình chi tiết. */
export function rowsQuery(config: CatalogNode, names: string[]): string {
  const source = config.source;
  const selection = [...new Set([keyOf(config), ...names])].join(" ");
  return (
    `query($where: ${source}_bool_exp!, $order_by: [${source}_order_by!], $limit: Int!, $offset: Int!) ` +
    `{ rows: ${source}(where: $where, order_by: $order_by, limit: $limit, offset: $offset) { ${selection} } }`
  );
}

/**
 * Một câu truy vấn đọc mọi chặng trên đường dẫn, mỗi chặng một bí danh (s0, s1, ...): dòng đang xem với mọi trường,
 * các dòng cha chỉ với tiêu đề để làm đường về. Mỗi chặng chỉ khớp khi thuộc đúng dòng ở chặng trước, nên sửa tay
 * đường dẫn để gắn một dòng vào cha hay ông của dòng khác thì có chặng không trả dòng nào, và màn hình báo không tìm
 * thấy thay vì hiện dòng dưới tên một đối tượng không chứa nó.
 */
export function chainQuery(steps: Step[]): string {
  const last = steps.length - 1;
  const parameters = steps.map((step, index) => `$w${index}: ${step.node.source}_bool_exp!`).join(", ");
  const parts = steps.map((step, index) => {
    const names = index === last ? step.node.fields.map((field) => field.name) : [titleField(step.node)];
    return `s${index}: ${step.node.source}(where: $w${index}, limit: 1) { ${selection([keyOf(step.node), ...names])} }`;
  });
  return `query(${parameters}) { ${parts.join(" ")} }`;
}

/**
 * Phần chọn cột của một chặng: cột của bảng giữ nguyên, trường <quan hệ>.<cột> gom theo quan hệ thành
 * `quan_hệ { cột ... }` như cú pháp GraphQL đòi.
 */
export function selection(names: string[]): string {
  const plain = new Set<string>();
  const nested = new Map<string, Set<string>>();
  for (const name of names) {
    const [head = "", tail] = name.split(".");
    if (tail === undefined) plain.add(head);
    else nested.set(head, (nested.get(head) ?? new Set()).add(tail));
  }
  const groups = [...nested].map(([relation, columns]) => `${relation} { ${[...columns].join(" ")} }`);
  return [...plain, ...groups].join(" ");
}

export function chainVariables(steps: Step[]): Record<string, Where> {
  return Object.fromEntries(
    steps.map((step, index) => {
      const parent = steps[index - 1];
      const conditions: Where[] = [{ [keyOf(step.node)]: { _eq: step.key } }];
      if (step.via && parent) conditions.push({ [step.via]: { _eq: parent.key } });
      return [`w${index}`, { _and: conditions }];
    }),
  );
}

// Ký tự % và _ có nghĩa riêng trong phép so mẫu; không thoát thì gõ "50%" sẽ khớp mọi dòng chứa "50".
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Thứ tự đang áp: của người dùng nếu trỏ tới một cột đang hiện, không thì theo cấu hình, không thì cột đầu. */
export function sortOf(config: CatalogNode, state: ListState): Required<Sort> {
  const chosen = state.sort && config.list.columns.includes(state.sort.field) ? state.sort : config.list.sort;
  return { field: chosen?.field ?? firstColumn(config), direction: chosen?.direction ?? "asc" };
}

/**
 * Biến của câu truy vấn danh sách. `fixed` là điều kiện không đổi của nơi gọi (đối tượng con chỉ lấy dòng thuộc
 * đối tượng cha). Xin thừa một dòng so với cỡ trang để biết còn trang sau hay không mà không cần phép đếm: quyền
 * đọc của một bảng không nhất thiết cho phép đếm, và đếm cả bảng tốn hơn đọc thêm một dòng.
 */
export function listVariables(config: CatalogNode, state: ListState, fixed?: Where) {
  const conditions: Where[] = fixed ? [fixed] : [];
  const text = state.search.trim();
  const searched = config.list.search ?? [];
  if (text !== "" && searched.length > 0) {
    conditions.push({ _or: searched.map((name) => ({ [name]: { _ilike: `%${escapeLike(text)}%` } })) });
  }
  for (const name of config.list.filters ?? []) {
    if (state.filters[name]) conditions.push({ [name]: { _eq: state.filters[name] } });
  }
  const sort = sortOf(config, state);
  const size = pageSize(config);
  return {
    where: { _and: conditions },
    // Dòng chưa có giá trị ở cột sắp xếp luôn đứng cuối: mặc định của CSDL đưa chúng lên đầu khi xếp giảm dần, và
    // người dùng thấy một loạt ô trống trước giá trị lớn nhất. Khóa đứng sau làm thứ tự phụ: hai dòng cùng giá trị
    // vẫn có thứ tự cố định, nên một dòng không hiện ở cả hai trang hay biến mất giữa hai trang.
    order_by: [{ [sort.field]: `${sort.direction}_nulls_last` }, { [keyOf(config)]: "asc" }],
    limit: size + 1,
    offset: state.page * size,
  };
}

/** Trạng thái danh sách trên thanh địa chỉ, để quay lại từ màn hình chi tiết hay gửi đường dẫn vẫn đúng chỗ đang xem. */
export function readState(params: URLSearchParams): ListState {
  const filters: Record<string, string> = {};
  for (const [name, value] of params) {
    if (name.startsWith("f.") && value !== "") filters[name.slice(2)] = value;
  }
  const sort = params.get("sort");
  const page = Number.parseInt(params.get("page") ?? "1", 10);
  return {
    search: params.get("q") ?? "",
    filters,
    sort: sort ? { field: sort.replace(/^-/, ""), direction: sort.startsWith("-") ? "desc" : "asc" } : undefined,
    page: Number.isInteger(page) && page > 1 ? page - 1 : 0,
    view: params.get("view") === "cards" ? "cards" : undefined,
  };
}

export function writeState(state: ListState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.search.trim() !== "") params.set("q", state.search.trim());
  for (const [name, value] of Object.entries(state.filters)) {
    if (value !== "") params.set(`f.${name}`, value);
  }
  if (state.sort) params.set("sort", `${state.sort.direction === "desc" ? "-" : ""}${state.sort.field}`);
  if (state.page > 0) params.set("page", String(state.page + 1));
  // Dạng bảng là mặc định nên không ghi: đường dẫn của danh sách mới mở vẫn không có chuỗi truy vấn.
  if (state.view === "cards") params.set("view", "cards");
  return params;
}
