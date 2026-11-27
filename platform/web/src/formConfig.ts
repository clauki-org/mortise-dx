// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Cấu hình của thành phần biểu mẫu (contracts/form.schema.json, ADR 0030): kiểu dữ liệu, lỗi cấu hình kiểm lại lúc
// chạy, cách đổi cấu hình thành JSON Schema và uiSchema cho rjsf, dữ liệu gửi đi, mã Idempotency-Key và câu truy vấn
// của danh sách chọn. Lệnh thêm dòng và lỗi của nó ở formInsert.ts, lệnh sửa dòng ở formUpdate.ts; phần hiển thị ở
// FormFields.tsx, FormPanel.tsx, CatalogForm.tsx và SourceChoice.tsx. Không có React ở đây để kiểm thử được bằng hàm
// thuần.

import type { RJSFSchema, UiSchema } from "@rjsf/utils";

export type Source = {
  table: string;
  value: string;
  label: string;
  where?: { column: string; field: string };
  limit?: number;
};

export type FormField = {
  name: string;
  label: string;
  type: "string" | "number" | "integer" | "boolean" | "date" | "choice";
  required?: boolean;
  min?: number;
  max?: number;
  max_length?: number;
  multiline?: boolean;
  choices?: { value: string; label: string }[];
  source?: Source;
  /** Dòng gợi ý dưới nhãn của trường (ADR 0050) */
  help?: string;
};

export type FormConfig = {
  title: string;
  description?: string;
  role?: string;
  fields: FormField[];
  /** Đúng một đích: process, insert, hay update kèm version (sửa một dòng mở từ danh mục, ADR 0054) */
  submit: { label: string; process?: string; insert?: string; update?: string; version?: string };
  done: { message: string; menu?: string };
};

export type Values = Record<string, unknown>;

export const sourceLimit = (source: Source) => source.limit ?? 200;

/**
 * Vai trò Hasura của mọi yêu cầu từ biểu mẫu. Không khai thì là user, đúng vai trò `make check-fast` đã kiểm; để
 * trống header thì Hasura dùng vai trò mặc định của token, có thể là vai trò khác mà check-fast chưa kiểm.
 */
export const formRole = (config: FormConfig) => config.role ?? "user";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ROLE = /^[a-z][a-z0-9_]*$/;
const TYPES = new Set(["string", "number", "integer", "boolean", "date", "choice"]);
// Biến lõi tự đặt (docs/api.md), và tiền tố authority_ lõi dành riêng cho biến chọn nhóm xử lý của bước theo bảng
// phân cấp thẩm quyền. Người lập ghi được các tên này thì giả được người khởi tạo, đơn vị hay nhóm duyệt.
const RESERVED = new Set(["initiator", "initiatorName", "tenant", "idempotencyKey"]);

function fieldProblems(field: FormField, earlier: string[]): string[] {
  const problems: string[] = [];
  const at = `trường "${field.label}"`;
  if (!IDENTIFIER.test(field.name) || RESERVED.has(field.name) || field.name.startsWith("authority_")) {
    problems.push(`${at}: "${field.name}" không dùng làm tên biến hay tên cột được`);
  }
  if (!TYPES.has(field.type)) problems.push(`${at}: kiểu "${field.type}" không có`);
  if (field.type === "choice" && (field.choices === undefined) === (field.source === undefined)) {
    problems.push(`${at}: trường chọn cần đúng một trong choices và source`);
  }
  // Giá trị rỗng bị payloadOf coi là chưa điền: chọn mục đó thì trường bắt buộc vẫn bị bỏ khi gửi, và trường con lọc
  // theo nó bị khóa mãi.
  if (field.choices?.some((choice) => typeof choice?.value !== "string" || choice.value === "")) {
    problems.push(`${at}: mỗi mục của choices cần value khác rỗng`);
  }
  // Gợi ý hiện dạng chữ dưới nhãn; giá trị không phải chữ thì React vẽ thành gì không đoán trước được.
  if (field.help !== undefined && (typeof field.help !== "string" || !/\S/.test(field.help))) {
    problems.push(`${at}: help phải là một dòng chữ`);
  }
  const source = field.source;
  if (!source) return problems;
  const names = [source.table, source.value, source.label, ...(source.where ? [source.where.column] : [])];
  for (const name of names) {
    if (!IDENTIFIER.test(name)) problems.push(`${at}: "${name}" không phải tên bảng hay cột hợp lệ`);
  }
  if (source.where && !earlier.includes(source.where.field)) {
    problems.push(`${at}: lọc theo "${source.where.field}", không phải trường đứng trước nó`);
  }
  const limit = sourceLimit(source);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) problems.push(`${at}: limit phải từ 1 tới 500`);
  return problems;
}

/**
 * Lỗi của cấu hình, kiểm lại lúc chạy dù `make check-fast` đã kiểm: cấu hình là dữ liệu của gói đọc từ CSDL, và tên
 * bảng, cột, trường được ghép vào câu GraphQL hay vào header. Một tên chứa dấu ngoặc sẽ đổi nghĩa câu truy vấn. Trả
 * danh sách rỗng khi dùng được.
 */
export function formProblems(config: FormConfig): string[] {
  if (!Array.isArray(config.fields) || config.fields.length === 0) return ["biểu mẫu không có trường nào"];
  const names = config.fields.map((field) => field.name);
  const problems = config.fields.flatMap((field, index) => fieldProblems(field, names.slice(0, index)));
  for (const name of new Set(names.filter((name, index) => names.indexOf(name) !== index))) {
    problems.push(`trường "${name}" được khai hai lần`);
  }
  const { process, insert, update, version } = config.submit ?? {};
  if ([process, insert, update].filter((target) => target !== undefined).length !== 1) {
    problems.push("submit cần đúng một trong process, insert và update");
  }
  if (process !== undefined && !SLUG.test(process)) problems.push(`khóa quy trình "${process}" không hợp lệ`);
  for (const table of [insert, update]) {
    if (table !== undefined && !IDENTIFIER.test(table)) problems.push(`bảng "${table}" không hợp lệ`);
  }
  // Không có cột so thì lệnh sửa ghi đè lần sửa của người khác mà không ai biết; cột lạ thì đổi nghĩa câu truy vấn.
  if (update !== undefined && (version === undefined || !IDENTIFIER.test(version))) {
    problems.push("submit.update cần version là tên cột thời điểm sửa cuối");
  }
  if (version !== undefined && update === undefined) problems.push("submit.version chỉ dùng cùng submit.update");
  // Vai trò đi vào header của yêu cầu; một giá trị lạ có thể là header khác.
  if (config.role !== undefined && !ROLE.test(config.role)) problems.push(`vai trò "${config.role}" không hợp lệ`);
  return problems;
}

// Bỏ khóa không khai thay vì để giá trị undefined: schema là dữ liệu cho bộ kiểm, một khóa mang undefined có thể bị
// đọc như một luật.
const compact = (schema: RJSFSchema): RJSFSchema =>
  Object.fromEntries(Object.entries(schema).filter(([, value]) => value !== undefined));

function propertyOf(field: FormField): RJSFSchema {
  const title = field.label;
  switch (field.type) {
    case "number":
    case "integer":
      return { type: field.type, title, minimum: field.min, maximum: field.max };
    case "boolean":
      // Ô đánh dấu luôn có giá trị; bắt buộc nghĩa là phải đánh dấu.
      return { type: "boolean", title, default: false, ...(field.required ? { const: true } : {}) };
    case "date":
      return { type: "string", format: "date", title };
    case "choice":
      if (field.choices) {
        return { type: "string", title, oneOf: field.choices.map((c) => ({ const: c.value, title: c.label })) };
      }
      return { type: "string", title };
    default:
      return { type: "string", title, maxLength: field.max_length };
  }
}

/**
 * Gợi ý của gói đi qua ui:description chứ không qua ui:help: ô của rjsf-mantine đưa nó vào description của Mantine,
 * Mantine tự gắn aria-describedby của ô vào dòng đó. ui:help vẽ một dòng riêng mà aria-describedby của Mantine đè mất.
 */
const helpOf = (field: FormField): UiSchema => (field.help ? { "ui:description": field.help } : {});

function uiOf(field: FormField, config: FormConfig): UiSchema {
  if (field.multiline) return { "ui:widget": "textarea", ...helpOf(field) };
  if (!field.source) return helpOf(field);
  const parent = config.fields.find((candidate) => candidate.name === field.source?.where?.field);
  return {
    "ui:widget": "sourceChoice",
    "ui:options": { source: field.source, parentLabel: parent?.label },
    ...helpOf(field),
  };
}

/**
 * JSON Schema và uiSchema mà rjsf vẽ. Chỉ dựng từ các khóa đã biết của cấu hình, không chép phần nào của cấu hình
 * vào uiSchema nguyên văn: rjsf có tùy chọn hiện chữ dạng HTML, gói không bật được chúng qua đây.
 */
export function formSchema(config: FormConfig): { schema: RJSFSchema; uiSchema: UiSchema } {
  const required = config.fields.filter((f) => f.required && f.type !== "boolean").map((f) => f.name);
  return {
    schema: {
      type: "object",
      required,
      properties: Object.fromEntries(config.fields.map((field) => [field.name, compact(propertyOf(field))])),
    },
    uiSchema: Object.fromEntries(config.fields.map((field) => [field.name, uiOf(field, config)])),
  };
}

const empty = (value: unknown) => value === undefined || value === null || value === "";

/**
 * Đổi trường cha thì xóa trường con lọc theo nó (và con của con, vì trường con luôn đứng sau): giá trị cũ của con
 * thuộc danh sách của cha cũ, giữ lại thì gửi đi một cặp không khớp nhau.
 */
export function clearDependents(config: FormConfig, previous: Values, next: Values): Values {
  const result = { ...next };
  for (const field of config.fields) {
    const parent = field.source?.where?.field;
    if (parent !== undefined && previous[parent] !== result[parent]) delete result[field.name];
  }
  return result;
}

/** Dữ liệu gửi đi theo thứ tự khai của trường, bỏ trường trống; 0 và false là giá trị. */
export function payloadOf(config: FormConfig, data: Values): Values {
  return Object.fromEntries(config.fields.filter((f) => !empty(data[f.name])).map((f) => [f.name, data[f.name]]));
}

/** Mã Idempotency-Key và dữ liệu lần cuối gửi kèm mã đó; chưa gửi lần nào thì sent trống. */
export type KeyState = { key: string; sent?: string };

/**
 * Mã cho lần gửi này. Cùng dữ liệu (bấm đúp, gửi lại sau lỗi mạng) dùng lại mã nên workflow-api trả quy trình đã tạo
 * thay vì tạo thêm. Dữ liệu đã đổi thì là một hồ sơ khác: dùng lại mã sẽ làm workflow-api trả hồ sơ cũ và nội dung
 * mới bị mất mà người gửi tưởng đã gửi.
 */
export function keyFor(state: KeyState, payload: string, newKey: () => string): KeyState {
  if (state.sent === undefined || state.sent === payload) return { key: state.key, sent: payload };
  return { key: newKey(), sent: payload };
}

/**
 * Câu truy vấn của một danh sách chọn, xếp theo nhãn rồi giá trị để thứ tự ổn định giữa các lần tải. Giá trị lọc đi
 * qua biến của câu truy vấn, không ghép vào chuỗi. Xin thừa một dòng so với trần để biết danh sách còn mục chưa hiện.
 */
export function sourceQuery(source: Source, parent: unknown): { query: string; variables: Values } {
  const where = source.where ? { [source.where.column]: { _eq: parent } } : {};
  const columns = [...new Set([source.label, source.value])];
  return {
    query:
      `query($where: ${source.table}_bool_exp!, $order_by: [${source.table}_order_by!], $limit: Int!) ` +
      `{ rows: ${source.table}(where: $where, order_by: $order_by, limit: $limit) { ${columns.join(" ")} } }`,
    variables: {
      where,
      order_by: columns.map((column) => ({ [column]: "asc" })),
      limit: sourceLimit(source) + 1,
    },
  };
}

/** Mục của danh sách chọn: giá trị gửi đi dạng chữ, bỏ dòng không có giá trị và giá trị trùng. */
export function sourceOptions(source: Source, rows: Values[]): { value: string; label: string }[] {
  const seen = new Set<string>();
  return rows.slice(0, sourceLimit(source)).flatMap((row) => {
    const raw = row[source.value];
    if (empty(raw) || seen.has(String(raw))) return [];
    seen.add(String(raw));
    const label = row[source.label];
    return [{ value: String(raw), label: empty(label) ? String(raw) : String(label) }];
  });
}
