// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Cấu hình của thành phần danh mục (contracts/catalog.schema.json): kiểu dữ liệu, lỗi cấu hình mà schema không bắt
// được, cách đọc đường dẫn thành các chặng cha → con, và cách hiện từng giá trị. Câu truy vấn sinh từ cấu hình nằm
// ở catalogQuery.ts; phần hiển thị ở Catalog.tsx, CatalogRecord.tsx và CatalogTable.tsx. Không có React ở đây để
// kiểm thử được bằng hàm thuần.

export type Field = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime";
  choices?: { value: string; label: string }[];
};

/** Một loại đối tượng: đọc bảng nào, có trường nào, danh sách hiện gì, và các loại đối tượng con lồng trong nó. */
export type CatalogNode = {
  source: string;
  key?: string;
  fields: Field[];
  list: {
    columns: string[];
    search?: string[];
    filters?: string[];
    sort?: Sort;
    page_size?: number;
  };
  detail?: { title?: string; children?: Child[] };
};

/** Loại đối tượng con: khai như cha, thêm tên ngắn dùng trong đường dẫn và cột chứa khóa của cha. */
export type Child = CatalogNode & { id: string; label: string; via: string };

/** Cấu hình gói đưa cho thành phần: loại đối tượng ngoài cùng, kèm tiêu đề của danh sách. */
export type CatalogConfig = CatalogNode & { title: string };

export type Sort = { field: string; direction?: "asc" | "desc" };

export type Row = Record<string, unknown>;

export const keyOf = (config: CatalogNode) => config.key ?? "id";
export const pageSize = (config: CatalogNode) => config.list.page_size ?? 20;
export const fieldOf = (config: CatalogNode, name: string) => config.fields.find((field) => field.name === name);
// Schema buộc list.columns có ít nhất một cột; khóa chỉ là giá trị dự phòng để kiểu không phải mang undefined.
export const firstColumn = (config: CatalogNode) => config.list.columns[0] ?? keyOf(config);
export const titleField = (config: CatalogNode) => config.detail?.title ?? firstColumn(config);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Lỗi của cấu hình mà schema không diễn đạt được (tên trỏ tới trường chưa khai) và luật tên mà câu truy vấn dựa
 * vào. Cấu hình là dữ liệu của gói chứ không phải mã, nên tên được kiểm lại ở đây trước khi ghép vào câu truy vấn: một tên
 * chứa dấu ngoặc sẽ đổi nghĩa câu truy vấn. Trả danh sách rỗng khi dùng được.
 */
function nodeProblems(config: CatalogNode): string[] {
  const problems: string[] = [];
  const names = config.fields.map((field) => field.name);
  const identifiers = [config.source, keyOf(config), ...names, ...(config.detail?.children ?? []).map((c) => c.via)];
  for (const name of identifiers) {
    if (!IDENTIFIER.test(name)) problems.push(`"${name}" không phải tên hợp lệ (chỉ chữ không dấu, số, gạch dưới)`);
  }
  for (const name of new Set(names.filter((name, index) => names.indexOf(name) !== index))) {
    problems.push(`trường "${name}" được khai hai lần trong fields`);
  }
  const used: [string, string[]][] = [
    ["list.columns", config.list.columns],
    ["list.search", config.list.search ?? []],
    ["list.filters", config.list.filters ?? []],
    ["list.sort", config.list.sort ? [config.list.sort.field] : []],
    ["detail.title", config.detail?.title ? [config.detail.title] : []],
  ];
  for (const [where, list] of used) {
    for (const name of list) {
      if (!names.includes(name)) problems.push(`${where} dùng trường "${name}" chưa khai trong fields`);
    }
  }
  for (const name of config.list.filters ?? []) {
    if (fieldOf(config, name) && !fieldOf(config, name)?.choices) {
      problems.push(`list.filters dùng trường "${name}" không có choices`);
    }
  }
  for (const name of config.list.search ?? []) {
    const field = fieldOf(config, name);
    // Tìm chữ dùng phép so mẫu của CSDL, chỉ có trên cột chữ; trên cột số hay ngày Hasura từ chối cả câu truy vấn.
    if (field && ((field.type ?? "text") !== "text" || field.choices)) {
      problems.push(`list.search dùng trường "${name}" không phải kiểu text`);
    }
  }
  return problems;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Lỗi của một loại đối tượng và của mọi loại đối tượng con lồng trong nó; lỗi của con mang tên bảng con ở đầu. */
export function configProblems(config: CatalogNode): string[] {
  const children = config.detail?.children ?? [];
  const problems = nodeProblems(config);
  const ids = children.map((child) => child.id);
  for (const id of new Set(ids)) {
    if (!SLUG.test(id))
      problems.push(`"${id}" không dùng làm tên ngắn của đối tượng con được (chữ thường, số, gạch ngang)`);
    // Tên ngắn nằm trong đường dẫn; hai loại con trùng tên thì đường dẫn tới loại thứ hai mở ra loại thứ nhất.
    if (ids.indexOf(id) !== ids.lastIndexOf(id)) problems.push(`hai loại đối tượng con cùng tên ngắn "${id}"`);
  }
  return [...problems, ...children.flatMap((child) => configProblems(child).map((p) => `${child.label}: ${p}`))];
}

/** Câu báo lỗi cấu hình cho người dùng: họ không sửa được, nên câu nói rõ phải báo ai. */
export const problemText = (problems: string[]) => `${problems.join("; ")}. Báo người quản trị sửa cấu hình của gói.`;

/** Một chặng trên đường từ đối tượng ngoài cùng tới dòng đang xem. */
export type Step = {
  node: CatalogNode;
  /** Giá trị khóa của dòng ở chặng này, lấy từ đường dẫn */
  key: string;
  /** Cột của dòng này chứa khóa của dòng ở chặng trước; chặng đầu không có */
  via?: string;
  /** Đường dẫn tới dòng này, tính từ địa chỉ gốc của thành phần, đã mã hóa */
  path: string;
};

/**
 * Đọc phần đường dẫn sau địa chỉ gốc, dạng <khóa>/<con>/<khóa>/<con>/<khóa>..., thành các chặng từ đối tượng ngoài
 * cùng vào trong. Trả undefined khi đường dẫn không khớp cấu hình (tên loại con không có, hoặc thiếu khóa).
 */
export function resolvePath(config: CatalogNode, segments: string[]): Step[] | undefined {
  if (segments.length % 2 === 0) return undefined;
  const steps: Step[] = [];
  let node = config;
  let via: string | undefined;
  for (let index = 0; index < segments.length; index += 2) {
    const key = segments[index];
    if (key === undefined) return undefined;
    const path = segments
      .slice(0, index + 1)
      .map(encodeURIComponent)
      .join("/");
    steps.push({ node, key, via, path });
    const next = segments[index + 1];
    if (next === undefined) break;
    const child = node.detail?.children?.find((candidate) => candidate.id === next);
    if (!child) return undefined;
    node = child;
    via = child.via;
  }
  return steps;
}

const number = new Intl.NumberFormat("vi-VN");
// Năm đủ bốn chữ số: kiểu ngắn của vi-VN viết năm hai chữ số, nên 1820 và 2020 hiện giống nhau.
const day = { day: "2-digit", month: "2-digit", year: "numeric" } as const;
// Cột ngày không có giờ: đọc theo UTC, nếu không thì ở múi giờ phía tây ngày hiện ra lùi một ngày.
const date = new Intl.DateTimeFormat("vi-VN", { ...day, timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("vi-VN", { ...day, hour: "2-digit", minute: "2-digit" });

/** Chữ hiện ra cho một giá trị, theo kiểu và choices của trường; giá trị trống hiện thành chuỗi rỗng. */
export function display(field: Field, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const choice = field.choices?.find((candidate) => candidate.value === String(value));
  if (choice) return choice.label;
  if (field.type === "number") return typeof value === "number" ? number.format(value) : String(value);
  if (field.type === "date" || field.type === "datetime") {
    const time = new Date(String(value));
    if (Number.isNaN(time.getTime())) return String(value);
    return (field.type === "date" ? date : dateTime).format(time);
  }
  return String(value);
}
