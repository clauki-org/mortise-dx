// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Đích gửi "thêm dòng" của thành phần biểu mẫu (submit.insert, ADR 0030): câu mutation và cách đổi lỗi của Hasura
// thành lời báo tiếng Việt kèm cách khắc phục. tenant_id không bao giờ có trong dữ liệu gửi: quyền thêm dòng của gói
// đặt cột đó từ token (`set` trong hasura/). Không có React ở đây để kiểm thử được bằng hàm thuần.

/** Mutation thêm một dòng; `table` đã qua formProblems nên chỉ gồm chữ, số, gạch dưới. */
export const insertMutation = (table: string) =>
  `mutation($object: ${table}_insert_input!) { result: insert_${table}(objects: [$object]) { affected_rows } }`;

/** Phần của CombinedError (urql) cần để đọc lỗi; tách ra để kiểm thử không phải dựng lỗi của urql. */
export type InsertFailure = {
  networkError?: unknown;
  graphQLErrors: { message: string; extensions?: Record<string, unknown> }[];
};

/**
 * Lời báo cho người gửi. Phân theo mã lỗi của Hasura (extensions.code) rồi theo đầu thông điệp của PostgreSQL mà
 * Hasura chép lại; lỗi không nhận ra thì hiện nguyên văn, vì giấu đi thì người quản trị không biết sửa gì.
 */
export function insertError(failure: InsertFailure, role: string): string {
  if (failure.networkError) return "Không kết nối được máy chủ. Kiểm tra mạng rồi bấm gửi lại.";
  const first = failure.graphQLErrors[0];
  const message = first?.message ?? "";
  switch (first?.extensions?.code) {
    case "constraint-violation":
      if (message.startsWith("Uniqueness violation")) {
        return (
          "Đã có dòng mang cùng mã. Đổi mã rồi gửi lại. Nếu vừa gửi mà mất kết nối, dòng có thể đã được thêm ở lần " +
          "trước: xem lại danh sách trước khi gửi lần nữa."
        );
      }
      if (message.startsWith("Foreign key violation")) {
        return "Mục vừa chọn không còn trong danh sách (đã bị xóa hay đổi). Tải lại trang rồi chọn lại.";
      }
      if (message.startsWith("Check constraint violation")) {
        return "Một giá trị không hợp lệ theo luật của bảng (ví dụ số âm). Sửa giá trị rồi gửi lại.";
      }
      return `Dữ liệu vi phạm ràng buộc của bảng: ${message}. Sửa giá trị rồi gửi lại.`;
    case "permission-error":
    case "access-denied":
      return `Tài khoản không được thêm dòng này với vai trò ${role}. Báo người quản trị cấp quyền.`;
    case "validation-failed":
      return (
        `Biểu mẫu ghi vào bảng hay cột mà vai trò ${role} không được ghi (${message}). ` +
        "Báo người quản trị sửa cấu hình của gói."
      );
    case "invalid-jwt":
      return "Phiên đăng nhập đã hết hạn. Tải lại trang để đăng nhập lại, rồi gửi lại.";
    case "data-exception":
      return `Một giá trị sai định dạng: ${message}. Sửa rồi gửi lại.`;
    default:
      return `${message || "Máy chủ từ chối"}. Bấm gửi lại; nếu vẫn lỗi, báo người quản trị.`;
  }
}
