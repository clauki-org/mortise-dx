// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần không có React của thành phần tài liệu đính kèm (contracts/documents.schema.json, ADR 0041): kiểu cấu hình,
// lỗi cấu hình kiểm lại lúc chạy, câu GraphQL đọc và thêm dòng nối, lời báo khi tải lên hay gắn tệp hỏng.
// CatalogDocuments.tsx vẽ phần này trên màn hình chi tiết của danh mục; catalog.ts gọi documentsProblems khi kiểm cấu
// hình danh mục. Không có tên bảng hay từ của lĩnh vực nào ở đây.

import type { InsertFailure } from "./formInsert";

export type DocumentField = { name: string; label: string; type?: "text" | "date" | "datetime" };

export type DocumentsConfig = {
  title: string;
  /** Bảng nối: <lược đồ>_<bảng> */
  source: string;
  /** Cột của bảng nối chứa khóa của dòng đang xem */
  via: string;
  /** Cột của bảng nối chứa mã tệp của /v1/files */
  file: string;
  fields?: DocumentField[];
  sort?: { field: string; direction?: "asc" | "desc" };
  limit?: number;
  upload?: { label?: string; role?: string; note?: string };
};

/** Thông tin tệp mà /v1/files/{id} trả (FileInfo trong contracts/files-api.openapi.json), phần giao diện dùng. */
export type FileInfo = { id: string; name: string; contentType: string; size: number };

export const limitOf = (config: DocumentsConfig) => config.limit ?? 20;
export const uploadRole = (config: DocumentsConfig) => config.upload?.role ?? "user";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Lỗi của cấu hình mà schema không bắt được hay mà câu truy vấn dựa vào. Cấu hình là dữ liệu của gói, nên mọi tên
 * được kiểm lại trước khi ghép vào câu GraphQL: một tên chứa dấu ngoặc sẽ đổi nghĩa của câu.
 */
export function documentsProblems(config: DocumentsConfig): string[] {
  const problems: string[] = [];
  const fields = (config.fields ?? []).map((field) => field.name);
  const names = [config.source, config.via, config.file, ...fields];
  if (config.sort) names.push(config.sort.field);
  if (config.upload?.note) names.push(config.upload.note);
  for (const name of names) {
    if (!IDENTIFIER.test(name)) problems.push(`"${name}" không phải tên hợp lệ (chỉ chữ không dấu, số, gạch dưới)`);
  }
  if (config.via === config.file) problems.push("via và file phải là hai cột khác nhau của bảng nối");
  for (const name of new Set(fields.filter((name, index) => fields.indexOf(name) !== index))) {
    problems.push(`trường "${name}" được khai hai lần trong fields`);
  }
  return problems.map((problem) => `phần tài liệu: ${problem}`);
}

/** Câu đọc dòng nối của dòng đang xem: cột file và các cột khai trong fields. */
export function listQuery(config: DocumentsConfig): string {
  const source = config.source;
  const selection = [...new Set([config.file, ...(config.fields ?? []).map((field) => field.name)])].join(" ");
  return (
    `query($where: ${source}_bool_exp!, $order_by: [${source}_order_by!], $limit: Int!) ` +
    `{ rows: ${source}(where: $where, order_by: $order_by, limit: $limit) { ${selection} } }`
  );
}

/** Xin thừa một dòng so với limit để biết còn tệp chưa hiện mà không cần phép đếm (quyền đọc có thể không cho đếm). */
export function listVariables(config: DocumentsConfig, recordKey: unknown) {
  const sort = config.sort ?? { field: config.file };
  return {
    where: { [config.via]: { _eq: recordKey } },
    order_by: [{ [sort.field]: sort.direction ?? "asc" }],
    limit: limitOf(config) + 1,
  };
}

/** Thêm một dòng nối; tenant và người đính kèm do quyền thêm dòng của gói đặt từ token, trình duyệt không gửi. */
export const insertMutation = (config: DocumentsConfig) =>
  `mutation($object: ${config.source}_insert_input!) { row: insert_${config.source}_one(object: $object) { ${config.file} } }`;

export function linkObject(config: DocumentsConfig, recordKey: unknown, fileId: string, note: string) {
  const object: Record<string, unknown> = { [config.via]: recordKey, [config.file]: fileId };
  if (config.upload?.note && note.trim() !== "") object[config.upload.note] = note.trim();
  return object;
}

const reasonOf = (reason: string) => reason.trim().replace(/\.$/, "");

/**
 * Lời báo khi /v1/files từ chối tải lên, theo mã HTTP. Lý do do files-api viết (mẫu mã độc, giới hạn cỡ) được giữ
 * nguyên trong câu: giao diện không biết trước giới hạn cỡ, và người dùng cần biết đúng mẫu đã bị nhận diện.
 */
export function uploadError(status: number, reason: string): string {
  const why = reasonOf(reason);
  switch (status) {
    case 0:
      return "Không kết nối được máy chủ, tệp chưa được gửi. Kiểm tra mạng rồi thử lại.";
    case 400:
    case 422:
      return `Tệp bị từ chối: ${why}. Kiểm tra lại tệp hoặc chọn tệp khác.`;
    case 413:
      return `Tệp bị từ chối vì quá cỡ cho phép (${why}). Chọn tệp nhỏ hơn hoặc nén lại rồi thử lại.`;
    case 401:
      return "Phiên đăng nhập đã hết hạn. Tải lại trang để đăng nhập lại, rồi đính kèm lại.";
    case 429:
      return "Đã gửi quá nhiều yêu cầu trong một phút. Chờ một phút rồi thử lại.";
    case 503:
      return `Chưa lưu được tệp vì dịch vụ quét mã độc hay kho tệp chưa sẵn sàng (${why}). Thử lại sau ít phút; nếu vẫn lỗi, báo người vận hành.`;
    default:
      return `Tệp chưa được lưu: ${why}. Thử lại; nếu vẫn lỗi, báo người quản trị.`;
  }
}

/**
 * Lời báo khi tệp đã lưu ở /v1/files mà không thêm được dòng nối. Tệp đó không gắn vào đâu và API tệp không có lệnh
 * xóa, nên lời báo nói rõ để người dùng không tưởng tệp đã được đính kèm.
 */
export function linkError(failure: InsertFailure): string {
  const lost = "Tệp đã được lưu nhưng chưa gắn vào dòng này.";
  if (failure.networkError) return `${lost} Không kết nối được máy chủ; kiểm tra mạng rồi đính kèm lại.`;
  const first = failure.graphQLErrors[0];
  switch (first?.extensions?.code) {
    case "permission-error":
    case "access-denied":
    case "validation-failed":
      return `${lost} Tài khoản không được đính kèm tệp vào dòng này; báo người quản trị nếu cần quyền.`;
    case "constraint-violation":
      if (first.message.startsWith("Uniqueness violation")) return "Tệp này đã được đính kèm vào dòng này.";
      return `${lost} Dòng không còn hoặc đã đổi (${first.message}); tải lại trang rồi thử lại.`;
    case "invalid-jwt":
      return `${lost} Phiên đăng nhập đã hết hạn; tải lại trang để đăng nhập lại rồi đính kèm lại.`;
    default:
      return `${lost} ${first?.message ?? "Máy chủ từ chối"}; thử lại, nếu vẫn lỗi báo người quản trị.`;
  }
}

const sizeFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

/** Cỡ tệp cho người đọc: byte, KB, MB theo bội 1024 như giới hạn cỡ của files-api. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${sizeFormat.format(bytes / 1024)} KB`;
  return `${sizeFormat.format(bytes / (1024 * 1024))} MB`;
}
