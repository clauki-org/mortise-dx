// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Cấu hình của thành phần danh mục (contracts/catalog.schema.json): kiểu dữ liệu, lỗi cấu hình mà schema không bắt
// được, cách đọc đường dẫn thành các chặng cha → con, và cách hiện từng giá trị. Câu truy vấn sinh từ cấu hình nằm
// ở catalogQuery.ts; phần hiển thị ở Catalog.tsx, CatalogRecord.tsx và CatalogTable.tsx. Không có React ở đây để
// kiểm thử được bằng hàm thuần.

import { type DocumentsConfig, documentsProblems } from "./documents";
import { formatDate, formatDateTime, formatNumber } from "./format";
import { type FormConfig, formProblems } from "./formConfig";
import { TONES, type Tone } from "./tones";

export type Field = {
  /** Tên cột, hoặc <quan hệ>.<cột> để đọc qua quan hệ một-một; loại sau chỉ hiện ở màn hình chi tiết */
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime";
  choices?: Choice[];
};

/** Một giá trị cố định của trường: giá trị lưu, chữ hiện ra, và nghĩa màu của nhãn nếu gói khai (ADR 0050). */
export type Choice = { value: string; label: string; tone?: Tone };

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
  detail?: { title?: string; children?: Child[]; actions?: Action[]; documents?: DocumentsConfig; edit?: Edit };
};

/** Nút sửa dòng đang xem: biểu mẫu có submit.update trỏ tới bảng của chính loại đối tượng này (ADR 0054). */
export type Edit = { label: string; form: FormConfig };

/** Nút thêm dòng con: biểu mẫu có submit.insert trỏ tới bảng của loại con; cột via nhận khóa của dòng cha. */
export type Add = { label: string; parent?: string; form: FormConfig };

/** Nút khởi tạo quy trình cho dòng đang xem: tên biến của quy trình -> khóa hoặc trường của dòng (ADR 0026). */
export type Action = { id: string; label: string; process: string; variables: Record<string, string> };

/** Loại đối tượng con: khai như cha, thêm tên ngắn dùng trong đường dẫn và cột chứa khóa của cha. */
export type Child = CatalogNode & { id: string; label: string; via: string; add?: Add };

/** Cấu hình gói đưa cho thành phần: loại đối tượng ngoài cùng, kèm tiêu đề của danh sách. */
export type CatalogConfig = CatalogNode & { title: string; variant?: string };

export type Sort = { field: string; direction?: "asc" | "desc" };

export type Row = Record<string, unknown>;

export const keyOf = (config: CatalogNode) => config.key ?? "id";
export const pageSize = (config: CatalogNode) => config.list.page_size ?? 20;
export const fieldOf = (config: CatalogNode, name: string) => config.fields.find((field) => field.name === name);
// Schema buộc list.columns có ít nhất một cột; khóa chỉ là giá trị dự phòng để kiểu không phải mang undefined.
export const firstColumn = (config: CatalogNode) => config.list.columns[0] ?? keyOf(config);
export const titleField = (config: CatalogNode) => config.detail?.title ?? firstColumn(config);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FIELD_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/** Giá trị của một trường trên dòng Hasura trả; trường qua quan hệ nằm trong đối tượng con cùng tên quan hệ. */
export function fieldValue(row: Row, name: string): unknown {
  const [head = "", tail] = name.split(".");
  const value = row[head];
  if (tail === undefined) return value;
  return typeof value === "object" && value !== null ? (value as Row)[tail] : undefined;
}

/**
 * Lỗi của cấu hình mà schema không diễn đạt được (tên trỏ tới trường chưa khai) và luật tên mà câu truy vấn dựa
 * vào. Cấu hình là dữ liệu của gói chứ không phải mã, nên tên được kiểm lại ở đây trước khi ghép vào câu truy vấn: một tên
 * chứa dấu ngoặc sẽ đổi nghĩa câu truy vấn. Trả danh sách rỗng khi dùng được.
 */
function nodeProblems(config: CatalogNode): string[] {
  const problems: string[] = [];
  const names = config.fields.map((field) => field.name);
  const identifiers = [config.source, keyOf(config), ...(config.detail?.children ?? []).map((c) => c.via)];
  for (const name of identifiers) {
    if (!IDENTIFIER.test(name)) problems.push(`"${name}" không phải tên hợp lệ (chỉ chữ không dấu, số, gạch dưới)`);
  }
  for (const name of names) {
    if (!FIELD_PATH.test(name)) problems.push(`"${name}" không phải tên trường hợp lệ (cột, hoặc quan hệ.cột)`);
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
      // Danh sách đọc một bảng và Hasura lọc, xếp theo cột của chính bảng; tên có dấu chấm ghép vào câu truy vấn
      // danh sách sẽ làm hỏng cả câu.
      else if (!IDENTIFIER.test(name)) problems.push(`${where} chỉ nhận cột của chính bảng, không nhận "${name}"`);
    }
  }
  for (const name of config.list.filters ?? []) {
    if (fieldOf(config, name) && !fieldOf(config, name)?.choices) {
      problems.push(`list.filters dùng trường "${name}" không có choices`);
    }
  }
  for (const field of config.fields) {
    // Cấu hình đọc từ CSDL, không qua schema lúc chạy: nghĩa lạ thì nhãn không có màu nào mà người đọc vẫn tưởng có.
    for (const choice of field.choices ?? []) {
      if (choice.tone !== undefined && !(TONES as readonly string[]).includes(choice.tone)) {
        problems.push(`trường "${field.name}" khai tone "${choice.tone}" ngoài ${TONES.join(", ")}`);
      }
    }
  }
  for (const name of config.list.search ?? []) {
    const field = fieldOf(config, name);
    // Tìm chữ dùng phép so mẫu của CSDL, chỉ có trên cột chữ; trên cột số hay ngày Hasura từ chối cả câu truy vấn.
    if (field && ((field.type ?? "text") !== "text" || field.choices)) {
      problems.push(`list.search dùng trường "${name}" không phải kiểu text`);
    }
  }
  const documents = config.detail?.documents;
  return [
    ...problems,
    ...actionProblems(config, names),
    ...(documents ? documentsProblems(documents) : []),
    ...editProblems(config),
  ];
}

/**
 * Biểu mẫu mở từ danh mục ghi vào đúng bảng của danh sách nó đứng cạnh: trỏ sang bảng khác thì danh sách không đổi
 * sau khi lưu, và khóa của dòng đang xem bị so với cột của một bảng khác.
 */
function editProblems(config: CatalogNode): string[] {
  const edit = config.detail?.edit;
  if (!edit) return [];
  const at = `nút "${edit.label}"`;
  const problems = formProblems(edit.form).map((problem) => `${at}: ${problem}`);
  if (edit.form.submit?.update !== config.source) {
    problems.push(`${at}: biểu mẫu phải sửa bảng ${config.source} của danh sách này (submit.update)`);
  }
  return problems;
}

/** Lỗi của nút thêm dòng con; cột via do danh mục đặt từ dòng cha nên không được là trường người dùng sửa. */
function addProblems(parent: CatalogNode, child: Child): string[] {
  const add = child.add;
  if (!add) return [];
  const at = `nút "${add.label}"`;
  const problems = formProblems(add.form).map((problem) => `${at}: ${problem}`);
  if (add.form.submit?.insert !== child.source) {
    problems.push(`${at}: biểu mẫu phải thêm dòng vào bảng ${child.source} (submit.insert)`);
  }
  if (add.form.fields?.some((field) => field.name === child.via)) {
    problems.push(`${at}: cột ${child.via} nhận khóa của dòng cha, không khai thành trường`);
  }
  const shown = add.parent;
  if (shown !== undefined && shown !== keyOf(parent) && !fieldOf(parent, shown)) {
    problems.push(`${at}: parent "${shown}" không phải khóa hay trường đã khai của dòng cha`);
  }
  return problems;
}

/** Nút trỏ tới trường chưa khai thì biến của quy trình nhận giá trị trống; báo ngay thay vì đợi người dùng bấm. */
function actionProblems(config: CatalogNode, names: string[]): string[] {
  const problems: string[] = [];
  const actions = config.detail?.actions ?? [];
  const ids = actions.map((action) => action.id);
  for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) {
    problems.push(`hai nút cùng tên ngắn "${id}"`);
  }
  for (const action of actions) {
    for (const [variable, source] of Object.entries(action.variables)) {
      if (source !== keyOf(config) && !names.includes(source)) {
        problems.push(
          `nút "${action.label}" lấy biến "${variable}" từ "${source}", không phải khóa hay trường đã khai`,
        );
      }
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
  const nested = children.flatMap((child) =>
    [...addProblems(config, child), ...configProblems(child)].map((p) => `${child.label}: ${p}`),
  );
  return [...problems, ...nested];
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

/** Chữ hiện ra cho một giá trị, theo kiểu và choices của trường; giá trị trống hiện thành chuỗi rỗng. */
export function display(field: Field, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const choice = field.choices?.find((candidate) => candidate.value === String(value));
  if (choice) return choice.label;
  if (field.type === "number") return typeof value === "number" ? formatNumber(value) : String(value);
  if (field.type === "date") return formatDate(String(value));
  if (field.type === "datetime") return formatDateTime(String(value));
  return String(value);
}

/** Nghĩa màu của một giá trị khi gói khai tone cho lựa chọn đó; còn lại hiện chữ thường, không thành nhãn. */
export function toneOf(field: Field, value: unknown): Tone | undefined {
  if (value === null || value === undefined) return undefined;
  return field.choices?.find((candidate) => candidate.value === String(value))?.tone;
}

/** Một giá trị mà nút sẽ gửi, kèm nhãn của trường để hộp xác nhận cho người bấm thấy trước. */
export type Sent = { label: string; text: string };

/**
 * Biến gửi khi bấm nút, lấy từ dòng đang xem với kiểu Hasura trả (số vẫn là số, để cổng rẽ nhánh của BPMN so được).
 * `shown` là các giá trị lấy từ trường đã khai; khóa của dòng là mã kỹ thuật nên không hiện. `missing` là nhãn của
 * trường còn trống: gửi giá trị trống thì quy trình đi nhánh mặc định hoặc hồ sơ thiếu thông tin, nên không cho gửi.
 */
export function actionVariables(config: CatalogNode, action: Action, row: Row) {
  const variables: Record<string, unknown> = {};
  const shown: Sent[] = [];
  const missing: string[] = [];
  for (const [variable, source] of Object.entries(action.variables)) {
    const value = fieldValue(row, source);
    const field = fieldOf(config, source);
    if (value === null || value === undefined || value === "") missing.push(field?.label ?? source);
    else variables[variable] = value;
    if (field) shown.push({ label: field.label, text: display(field, value) });
  }
  return { variables, shown, missing };
}
