// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần hàm thuần của hộp thoại "Trường tùy chỉnh" (CustomFieldsDialog.tsx, ADR 0059): bảng nào của danh mục chọn được,
// kiểm ô của một định nghĩa trước khi gửi (cùng luật với CHECK của platform.custom_fields), câu mutation thêm, sửa,
// xóa bằng vai trò tenant_admin, và lời báo khi Hasura hay CSDL từ chối. Không có React ở đây để kiểm thử bằng hàm thuần.

import type { CombinedError } from "urql";
import type { CatalogConfig, CatalogNode } from "./catalog";
import { CHOICES_MAX, CODE, type CustomField, type CustomKind, LABEL_MAX } from "./customFields";

/** Một bảng của danh mục: `source` là tên GraphQL, `label` là tiêu đề danh mục hay nhãn của đối tượng con. */
export type CatalogTableRef = { source: string; label: string };

/**
 * Mọi bảng của danh mục, cha trước con, không trùng. Bảng chưa bật trường tùy chỉnh vẫn có trong danh sách: trình duyệt
 * không đọc được bảng nào đã bật, CSDL từ chối khi thêm và lời báo nói rõ lý do.
 */
export function catalogTables(config: CatalogConfig): CatalogTableRef[] {
  const found: CatalogTableRef[] = [];
  const walk = (node: CatalogNode, label: string) => {
    if (!found.some((table) => table.source === node.source)) found.push({ source: node.source, label });
    for (const child of node.detail?.children ?? []) walk(child, child.label);
  };
  walk(config, config.title);
  return found;
}

/** Giá trị của các ô trong hộp thoại; lựa chọn gõ mỗi dòng một mục. */
export type Draft = { code: string; label: string; kind: CustomKind; choices: string; required: boolean };

export const EMPTY_DRAFT: Draft = { code: "", label: "", kind: "text", choices: "", required: false };

export const draftOf = (field: CustomField): Draft => ({
  code: field.code,
  label: field.label,
  kind: field.kind,
  choices: (field.choices ?? []).join("\n"),
  required: field.required,
});

/** Các lựa chọn từ ô nhiều dòng: bỏ khoảng trắng hai đầu và dòng trống. */
export const choicesOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

export type DraftProblems = Partial<Record<"code" | "label" | "choices", string>>;

/** Lỗi theo ô; `existing` là các trường đã có của bảng, `editing` là mã đang sửa (mã không đổi khi sửa). */
export function draftProblems(draft: Draft, existing: CustomField[], editing?: string): DraftProblems {
  const problems: DraftProblems = {};
  if (editing === undefined) {
    if (!CODE.test(draft.code)) {
      problems.code = "Mã gồm chữ thường không dấu, số, gạch dưới, bắt đầu bằng chữ, tối đa 40 ký tự";
    } else if (existing.some((field) => field.code === draft.code)) {
      problems.code = "Bảng này đã có trường mang mã này";
    }
  }
  const label = draft.label.trim();
  if (label === "") problems.label = "Bắt buộc nhập";
  else if (label.length > LABEL_MAX) problems.label = `Tối đa ${LABEL_MAX} ký tự`;
  if (draft.kind === "choice") {
    const choices = choicesOf(draft.choices);
    if (choices.length === 0) problems.choices = "Cần ít nhất một lựa chọn";
    else if (choices.length > CHOICES_MAX) problems.choices = `Tối đa ${CHOICES_MAX} lựa chọn`;
    else if (choices.some((choice) => choice.length > LABEL_MAX))
      problems.choices = `Mỗi lựa chọn tối đa ${LABEL_MAX} ký tự`;
    else if (new Set(choices).size !== choices.length) problems.choices = "Có lựa chọn bị lặp";
  }
  return problems;
}

/** Dòng gửi khi thêm; tenant gốc do Hasura đặt từ token, không gửi. */
export function insertObject(app: string, source: string, draft: Draft) {
  return {
    app,
    source,
    code: draft.code,
    label: draft.label.trim(),
    kind: draft.kind,
    choices: draft.kind === "choice" ? choicesOf(draft.choices) : null,
    required: draft.required,
  };
}

/** Cột sửa được: nhãn, lựa chọn (chỉ kiểu lựa chọn), bắt buộc. Mã và kiểu bất biến. */
export function updateSet(field: CustomField, draft: Draft) {
  return {
    label: draft.label.trim(),
    required: draft.required,
    ...(field.kind === "choice" ? { choices: choicesOf(draft.choices) } : {}),
  };
}

export const pkOf = (field: CustomField) => ({
  root_tenant_id: field.root_tenant_id,
  source: field.source,
  code: field.code,
});

/** Mọi lệnh ghi định nghĩa đi bằng vai trò này; Hasura chỉ cho tenant_admin của tenant gốc ghi. */
export const ADMIN_CONTEXT = { role: "tenant_admin" };

export const INSERT_FIELD =
  "mutation($object: platform_custom_fields_insert_input!) " +
  "{ result: insert_platform_custom_fields_one(object: $object) { root_tenant_id source code } }";

export const UPDATE_FIELD =
  "mutation($pk: platform_custom_fields_pk_columns_input!, $set: platform_custom_fields_set_input!) " +
  "{ result: update_platform_custom_fields_by_pk(pk_columns: $pk, _set: $set) { root_tenant_id source code } }";

export const DELETE_FIELD =
  "mutation($root_tenant_id: String!, $source: String!, $code: String!) " +
  "{ result: delete_platform_custom_fields_by_pk(root_tenant_id: $root_tenant_id, source: $source, code: $code) " +
  "{ root_tenant_id source code } }";

/** Lệnh sửa, xóa không khớp dòng nào: quyền của Hasura lọc mất dòng, tức tài khoản không phải quản trị tenant gốc. */
export const NOT_ROOT_ADMIN =
  "Không có trường nào được ghi: chỉ quản trị của tenant gốc của org thêm, sửa, xóa được trường tùy chỉnh.";

type Failure = Pick<CombinedError, "networkError" | "graphQLErrors">;

/**
 * Lời báo khi ghi định nghĩa bị từ chối. Lý do tiếng Việt của trigger (đổi mã, tenant có cha) hiện nguyên văn; khóa
 * ngoại tới platform.custom_field_tables nghĩa là gói chưa bật trường tùy chỉnh cho bảng.
 */
export function definitionError(failure: Failure): string {
  if (failure.networkError) return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  const first = failure.graphQLErrors[0];
  const message = first?.message ?? "";
  const code = first?.extensions?.code;
  if (message.startsWith("Uniqueness violation")) return "Bảng này đã có trường mang mã này. Chọn mã khác.";
  if (message.startsWith("Foreign key violation")) {
    return "Gói chưa bật trường tùy chỉnh cho bảng này (custom_fields_attach), nên không thêm trường được.";
  }
  if (message.startsWith("Check constraint violation")) {
    const reason = message.replace(/^Check constraint violation\.?\s*/, "").trim();
    if (reason !== "" && !/violates check constraint/.test(reason)) return reason;
    return "Một giá trị không đúng luật của trường tùy chỉnh (mã, nhãn hay lựa chọn). Sửa rồi lưu lại.";
  }
  if (code === "permission-error" || code === "access-denied" || code === "validation-failed") return NOT_ROOT_ADMIN;
  if (code === "invalid-jwt") return "Phiên đăng nhập đã hết hạn. Tải lại trang để đăng nhập lại.";
  return `${message || "Máy chủ từ chối"}. Thử lại; nếu vẫn lỗi, báo người vận hành.`;
}
