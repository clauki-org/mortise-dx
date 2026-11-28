// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Trường tùy chỉnh do quản trị org định nghĩa (ADR 0059) trên giao diện: câu đọc định nghĩa theo bảng, cách hiện giá
// trị ở danh mục, chi tiết và tệp xuất, ô nhập thêm vào biểu mẫu sửa, thêm dòng, và giá trị `custom` gửi đi. Định nghĩa
// đi một kênh riêng, không trộn vào `fields` của cấu hình gói: tên trường của gói được ghép vào câu GraphQL, còn mã
// của trường tùy chỉnh chỉ là khóa trong cột jsonb `custom`. Không có React ở đây để kiểm thử được bằng hàm thuần;
// hook đọc định nghĩa ở useCustomFields.ts, hộp thoại quản lý ở CustomFieldsDialog.tsx.

import type { Field } from "./catalog";
import type { FormConfig, FormField, Values } from "./formConfig";

export const KINDS = ["text", "number", "date", "choice"] as const;
export type CustomKind = (typeof KINDS)[number];

/** Chữ của từng kiểu trong hộp thoại quản lý. */
export const KIND_LABELS: Record<CustomKind, string> = {
  text: "Chữ",
  number: "Số",
  date: "Ngày",
  choice: "Lựa chọn",
};

export type CustomField = {
  root_tenant_id: string;
  source: string;
  code: string;
  label: string;
  kind: CustomKind;
  /** Chỉ với kiểu lựa chọn: giá trị lưu cũng là chữ hiện ra */
  choices: string[] | null;
  required: boolean;
};

/** Cột Hasura sinh cho bảng định nghĩa; mutation trả kiểu này nên urql đọc lại mọi danh sách định nghĩa sau khi ghi. */
export const CUSTOM_FIELDS_TYPENAME = "platform_custom_fields";

/**
 * Định nghĩa của một bảng theo `source` (tên GraphQL của bảng, như trong cấu hình danh mục). Xếp theo lúc tạo rồi mã,
 * để cột mới thêm đứng cuối và thứ tự không đổi giữa các lần tải.
 */
export const CUSTOM_FIELDS_QUERY =
  "query($source: String!) { platform_custom_fields(where: {source: {_eq: $source}}, " +
  "order_by: [{created_at: asc}, {code: asc}]) { root_tenant_id source code label kind choices required } }";

// Cùng luật với CHECK của platform.custom_fields: kiểm trước trên trình duyệt để lời báo nói đúng ô sai.
export const CODE = /^[a-z][a-z0-9_]{0,39}$/;
export const LABEL_MAX = 200;
export const CHOICES_MAX = 100;
export const TEXT_MAX = 2000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Định nghĩa dùng được từ dữ liệu Hasura trả. Dòng sai dạng (kiểu chưa biết của một bản sau, lựa chọn không phải mảng
 * chữ) bị bỏ qua thay vì làm hỏng cả danh mục.
 */
export function definitions(rows: unknown): CustomField[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): CustomField[] => {
    if (!isRecord(row)) return [];
    const { root_tenant_id, source, code, label, kind, choices, required } = row;
    if (typeof code !== "string" || !CODE.test(code) || typeof label !== "string") return [];
    if (typeof root_tenant_id !== "string" || typeof source !== "string") return [];
    const known = KINDS.find((candidate) => candidate === kind);
    if (!known) return [];
    const list = Array.isArray(choices) && choices.every((c) => typeof c === "string") ? (choices as string[]) : null;
    if (known === "choice" && !list) return [];
    return [
      {
        root_tenant_id,
        source,
        code,
        label,
        kind: known,
        choices: known === "choice" ? list : null,
        required: !!required,
      },
    ];
  });
}

/** Trường của danh mục dùng để hiện giá trị (display, CellValue, ô xuất); tên là mã, không bao giờ vào câu truy vấn. */
export function displayField(field: CustomField): Field {
  return {
    name: field.code,
    label: field.label,
    type: field.kind === "number" ? "number" : field.kind === "date" ? "date" : undefined,
    choices: field.choices?.map((choice) => ({ value: choice, label: choice })),
  };
}

/** Đối tượng `custom` của dòng; bảng chưa bật hay dòng sai dạng thì là đối tượng rỗng. */
export const storedOf = (row: Values | undefined): Values => (isRecord(row?.custom) ? row.custom : {});

/** Giá trị của một trường tùy chỉnh trên dòng; khóa không có định nghĩa thì giao diện không bao giờ đọc tới. */
export const customValue = (row: Values, code: string): unknown => storedOf(row)[code];

/**
 * Cột của câu đọc: thêm `custom` khi bảng có định nghĩa. Bảng có định nghĩa chắc chắn có cột này (khóa ngoại tới
 * platform.custom_field_tables), còn bảng chưa bật thì không có, nên không đọc cột này khi không có định nghĩa.
 */
export const withCustomColumn = (names: string[], fields: CustomField[]) =>
  fields.length > 0 ? [...names, "custom"] : names;

// Tên ô trong biểu mẫu: GraphQL dành tiền tố "__" cho chính nó nên không cột nào của gói mang tên này, và mã trùng tên
// một cột (ví dụ "name") không đè ô của cột đó.
const PREFIX = "__custom_";
export const inputName = (code: string) => `${PREFIX}${code}`;

const empty = (value: unknown) => value === undefined || value === null || value === "";

/** Giá trị đã lưu có đúng kiểu để điền vào ô không; giá trị cũ sai kiểu để trống, không gửi lại nếu không ai sửa. */
function fits(field: CustomField, value: unknown): boolean {
  if (field.kind === "number") return typeof value === "number";
  return typeof value === "string" && value !== "";
}

/**
 * Ô nhập của các trường tùy chỉnh; `stored` là `custom` đã lưu khi sửa dòng, bỏ trống khi thêm. Lựa chọn đã lưu mà quản
 * trị vừa bỏ khỏi danh sách vẫn hiện, để dòng cũ lưu được mà không phải đổi giá trị đó: CSDL không kiểm lại khóa giữ
 * nguyên giá trị. Khi sửa, trường bắt buộc mà dòng chưa có giá trị không bị đòi ở trình duyệt: CSDL chỉ xét bắt buộc khi
 * `custom` đổi, nên sửa cột khác của dòng có trước lúc thêm trường vẫn lưu được.
 */
export function inputFields(fields: CustomField[], stored?: Values): FormField[] {
  return fields.map((field): FormField => {
    const required = field.required && (stored === undefined || !empty(stored[field.code]));
    const base = { name: inputName(field.code), label: field.label, required };
    switch (field.kind) {
      case "number":
        return { ...base, type: "number" };
      case "date":
        return { ...base, type: "date" };
      case "choice": {
        const kept = stored?.[field.code];
        const choices = (field.choices ?? []).map((choice) => ({ value: choice, label: choice }));
        if (typeof kept === "string" && kept !== "" && !field.choices?.includes(kept)) {
          choices.push({ value: kept, label: `${kept} (đã bỏ khỏi danh sách)` });
        }
        return { ...base, type: "choice", choices };
      }
      default:
        return { ...base, type: "string", max_length: TEXT_MAX };
    }
  });
}

/** Biểu mẫu của gói thêm ô của trường tùy chỉnh ở cuối; cấu hình gốc không đổi. */
export function withInputs(form: FormConfig, fields: CustomField[], stored?: Values): FormConfig {
  return fields.length === 0 ? form : { ...form, fields: [...form.fields, ...inputFields(fields, stored)] };
}

/** Giá trị điền sẵn của các ô tùy chỉnh từ `custom` đã lưu. */
export function prefillCustom(fields: CustomField[], stored: Values): Values {
  return Object.fromEntries(
    fields
      .filter((field) => fits(field, stored[field.code]))
      .map((field) => [inputName(field.code), stored[field.code]]),
  );
}

/** `custom` của dòng mới: chỉ ô đã điền. Không có định nghĩa thì không gửi cột này. */
export function insertCustom(fields: CustomField[], data: Values): Values | undefined {
  if (fields.length === 0) return undefined;
  return Object.fromEntries(
    fields
      .filter((field) => !empty(data[inputName(field.code)]))
      .map((field) => [field.code, data[inputName(field.code)]]),
  );
}

/**
 * `custom` gửi trong `_set` của lệnh sửa, hay undefined khi không ô tùy chỉnh nào đổi. `_set` thay cả đối tượng, nên
 * giá trị mới gộp lên `custom` vừa đọc lại lúc mở biểu mẫu: khóa của trường đã xóa và trường không có ô vẫn còn. Ô bị
 * xóa trắng thành null, là ô bỏ trống theo ADR 0059.
 */
export function updateCustom(fields: CustomField[], initial: Values, data: Values, stored: Values): Values | undefined {
  const changed: Values = {};
  for (const field of fields) {
    const name = inputName(field.code);
    const before = empty(initial[name]) ? null : initial[name];
    const after = empty(data[name]) ? null : data[name];
    if (before !== after) changed[field.code] = after;
  }
  return Object.keys(changed).length === 0 ? undefined : { ...stored, ...changed };
}
