// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Đích gửi "sửa một dòng" của thành phần biểu mẫu (submit.update, ADR 0054), mở từ màn hình chi tiết của danh mục
// (CatalogForm.tsx): câu đọc lại dòng lúc mở, giá trị điền sẵn, các cột đã đổi, câu mutation có điều kiện so cột
// version, và lời báo lỗi. Không có React ở đây để kiểm thử được bằng hàm thuần.

import type { FormConfig, Values } from "./formConfig";
import { type FieldName, type InsertFailure, insertError } from "./formInsert";

/** Lời báo khi lệnh sửa không khớp dòng nào: người khác đã sửa trước, hoặc quyền theo dòng không còn cho sửa. */
export const CONFLICT =
  "Dòng này đã có người sửa hoặc bạn không còn quyền sửa. Biểu mẫu đã tải lại giá trị mới nhất; xem lại rồi lưu lại.";

const empty = (value: unknown) => value === undefined || value === null || value === "";

/** Cột mà biểu mẫu cần đọc lại lúc mở: khóa, các trường, và cột version để so khi gửi. */
export function readColumns(config: FormConfig, key: string): string[] {
  return [...new Set([key, ...config.fields.map((field) => field.name), config.submit.version ?? ""])].filter(Boolean);
}

/**
 * Đọc lại đúng một dòng bằng vai trò của biểu mẫu, không lấy từ dòng màn hình chi tiết đã tải: dòng đó có thể cũ,
 * và giá trị version cũ làm lần lưu đầu tiên bị báo là có người sửa trước. Tên đã qua formProblems và configProblems.
 */
export const rowQuery = (table: string, columns: string[]) =>
  `query($where: ${table}_bool_exp!) { rows: ${table}(where: $where, limit: 1) { ${columns.join(" ")} } }`;

/** Kiểu set_input của bảng do Hasura sinh, nên câu này không cần biết kiểu của từng cột. */
export const updateMutation = (table: string) =>
  `mutation($where: ${table}_bool_exp!, $set: ${table}_set_input!) ` +
  `{ result: update_${table}(where: $where, _set: $set) { affected_rows } }`;

/**
 * Điều kiện của lệnh sửa: đúng dòng theo khóa và đúng giá trị version lúc đọc. Giá trị version giữ nguyên chuỗi Hasura
 * trả; đổi qua Date của JavaScript thì mất phần micro giây và lệnh không bao giờ khớp.
 */
export function updateWhere(key: string, keyValue: unknown, version: string, versionValue: unknown) {
  return { _and: [{ [key]: { _eq: keyValue } }, { [version]: { _eq: versionValue } }] };
}

/**
 * Giá trị điền sẵn từ dòng đọc được. Ô trống không đưa vào dữ liệu của rjsf: giá trị null ở trường chữ hay số bị bộ
 * kiểm báo sai kiểu. Số của cột numeric có thể về dạng chữ, còn lựa chọn luôn là chữ như danh sách choices.
 */
export function prefillOf(config: FormConfig, row: Values): Values {
  const values: Values = {};
  for (const field of config.fields) {
    const raw = row[field.name];
    if (empty(raw)) continue;
    if (field.type === "number" || field.type === "integer") values[field.name] = Number(raw);
    else if (field.type === "boolean") values[field.name] = Boolean(raw);
    else values[field.name] = String(raw);
  }
  return values;
}

/**
 * Cột đã đổi so với lúc mở, theo thứ tự khai. Ô bị xóa trắng gửi null để cột về trống; bỏ qua thì giá trị cũ vẫn
 * còn mà người sửa tưởng đã xóa. Cột không đổi không gửi: gửi lại cả dòng thì ghi đè cột người khác vừa sửa ở chỗ
 * khác dù điều kiện version đã chặn phần lớn trường hợp, và nhật ký ghi thay đổi giả.
 */
export function changedColumns(config: FormConfig, initial: Values, data: Values): Values {
  const changed: Values = {};
  for (const field of config.fields) {
    const before = empty(initial[field.name]) ? null : initial[field.name];
    const after = empty(data[field.name]) ? null : data[field.name];
    if (before !== after) changed[field.name] = after;
  }
  return changed;
}

/**
 * Lời báo cho lỗi của lệnh sửa. Phần chung với lệnh thêm dòng (mạng, phiên, định dạng, CHECK của bảng) dùng lại
 * insertError; các lỗi mà lời của lệnh thêm sẽ dẫn sai (trùng mã, quyền) có lời riêng.
 */
export function updateError(failure: InsertFailure, role: string, fields: FieldName[] = []): string {
  const first = failure.graphQLErrors[0];
  const message = first?.message ?? "";
  if (!failure.networkError) {
    const code = first?.extensions?.code;
    if (code === "constraint-violation" && message.startsWith("Uniqueness violation")) {
      return "Đã có dòng khác mang cùng mã. Đổi mã rồi lưu lại.";
    }
    if ((code === "permission-error" || code === "access-denied") && !message.startsWith("Check constraint")) {
      return `Tài khoản không được sửa dòng này như vậy với vai trò ${role}. Báo người quản trị cấp quyền.`;
    }
    if (code === "validation-failed") {
      return (
        `Biểu mẫu sửa bảng hay cột mà vai trò ${role} không được sửa (${message}). ` +
        "Báo người quản trị sửa cấu hình của gói."
      );
    }
  }
  return insertError(failure, role, fields);
}
