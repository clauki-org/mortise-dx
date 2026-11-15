// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Bộ kiểm dữ liệu biểu mẫu cho react-jsonschema-form dựa trên @cfworker/json-schema. Bộ kiểm đi kèm rjsf (AJV) dịch
// schema thành mã bằng `new Function`, mà CSP của giao diện (script-src 'self', không 'unsafe-eval') chặn; bộ này
// diễn giải schema trực tiếp nên chạy được dưới CSP đó. Thông điệp lỗi viết bằng tiếng Việt cho các luật hay gặp.

import { type OutputUnit, type Schema, Validator } from "@cfworker/json-schema";
import {
  createErrorHandler,
  type RJSFSchema,
  type RJSFValidationError,
  toErrorSchema,
  unwrapErrorHandler,
  type ValidatorType,
  validationDataMerge,
} from "@rjsf/utils";

// Từ khóa chỉ gom lỗi của phần con; lỗi thật nằm ở phần con nên bỏ dòng gom để một lỗi không hiện hai lần.
// cfworker báo lỗi của nhánh điều kiện (then/else) dưới từ khóa "if".
const WRAPPERS = new Set([
  "properties",
  "patternProperties",
  "items",
  "prefixItems",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "$ref",
]);

const validators = new WeakMap<object, Validator>();

function validatorFor(schema: RJSFSchema, rootSchema: RJSFSchema): Validator {
  let validator = validators.get(schema);
  if (!validator) {
    // Phần schema con có thể trỏ $ref tới định nghĩa của schema gốc; gắn các định nghĩa đó vào để $ref tìm thấy.
    const withDefs = { ...schema, $defs: rootSchema.$defs, definitions: rootSchema.definitions } as Schema;
    validator = new Validator(withDefs, "2020-12", false);
    validators.set(schema, validator);
  }
  return validator;
}

function decode(pointer: string): string[] {
  return pointer
    .replace(/^#\/?/, "")
    .split("/")
    .filter((part) => part !== "")
    .map((part) => decodeURIComponent(part).replaceAll("~1", "/").replaceAll("~0", "~"));
}

function at(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], value);
}

// Đường dẫn kiểu rjsf: .ten hoặc ['ten-co-gach'] cho từng đoạn.
function property(path: string[]): string {
  return path.map((key) => (/^[A-Za-z_$][\w$]*$|^\d+$/.test(key) ? `.${key}` : `['${key}']`)).join("") || ".";
}

function message(keyword: string, limit: unknown, fallback: string): string {
  // Giới hạn đọc từ schema theo keywordLocation; qua $ref thì đường đó không trỏ đúng chỗ, dùng thông điệp gốc.
  if (/^(min|max)/.test(keyword) && typeof limit !== "number") return fallback;
  switch (keyword) {
    case "required":
      return "Bắt buộc nhập";
    case "minLength":
      return `Cần ít nhất ${limit} ký tự`;
    case "maxLength":
      return `Tối đa ${limit} ký tự`;
    case "minimum":
      return `Không được nhỏ hơn ${limit}`;
    case "maximum":
      return `Không được lớn hơn ${limit}`;
    case "pattern":
    case "format":
      return "Sai định dạng";
    case "enum":
      return "Chọn một giá trị trong danh sách";
    case "type":
      return "Sai kiểu dữ liệu";
    case "const":
      return "Giá trị không đúng";
    case "minItems":
      return `Cần ít nhất ${limit} mục`;
    case "maxItems":
      return `Tối đa ${limit} mục`;
    case "uniqueItems":
      return "Các mục không được trùng nhau";
    default:
      return fallback;
  }
}

function toRjsfError(unit: OutputUnit, schema: RJSFSchema): RJSFValidationError {
  const instancePath = decode(unit.instanceLocation);
  const limit = at(schema, decode(unit.keywordLocation));
  const text = message(unit.keyword, limit, unit.error);
  // Lỗi "required" đứng ở đối tượng cha, mỗi trường thiếu một lỗi; rjsf cần lỗi gắn vào chính trường bị thiếu để hiện
  // cạnh ô nhập. cfworker chỉ ghi tên trường trong thông điệp, nên đọc tên từ đó.
  const missing = unit.keyword === "required" ? /required property "(.+)"/.exec(unit.error)?.[1] : undefined;
  const path = missing === undefined ? instancePath : [...instancePath, missing];
  return {
    name: unit.keyword,
    message: text,
    property: property(path),
    schemaPath: unit.keywordLocation,
    stack: `${property(path)} ${text}`,
  };
}

function rawErrors(schema: RJSFSchema, formData: unknown, rootSchema: RJSFSchema = schema): RJSFValidationError[] {
  return validatorFor(schema, rootSchema)
    .validate(formData)
    .errors.filter((unit) => !WRAPPERS.has(unit.keyword))
    .map((unit) => toRjsfError(unit, schema));
}

export const formValidator: ValidatorType = {
  validateFormData(formData, schema, customValidate, transformErrors, uiSchema) {
    let errors = rawErrors(schema, formData);
    if (transformErrors) errors = transformErrors(errors, uiSchema);
    const data = { errors, errorSchema: toErrorSchema(errors) };
    if (!customValidate) return data;
    return validationDataMerge(
      data,
      unwrapErrorHandler(customValidate(formData, createErrorHandler(formData), uiSchema)),
    );
  },
  isValid(schema, formData, rootSchema) {
    return validatorFor(schema, rootSchema).validate(formData).valid;
  },
  rawValidation(schema, formData) {
    return { errors: validatorFor(schema, schema).validate(formData).errors as never[] };
  },
};
