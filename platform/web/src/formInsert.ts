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

/** Trường của biểu mẫu mà lời báo cần: tên để đối chiếu với cột trong lỗi, nhãn để chỉ ô cho người gửi. */
export type FieldName = { name: string; label: string };

/**
 * Lời báo khi bảng đòi một cột mà dòng gửi đi bỏ trống. Có ô cho cột đó thì người gửi tự điền được; không có thì gửi
 * lại bao nhiêu lần cũng lỗi, nên lời báo phải dẫn tới người quản trị thay vì bảo sửa giá trị.
 */
function notNullError(message: string, fields: FieldName[]): string {
  const column = /column "([^"]+)"/.exec(message)?.[1];
  const field = fields.find((candidate) => candidate.name === column);
  if (field) {
    return (
      `Bảng cần giá trị cho ô "${field.label}". Điền ô đó rồi gửi lại. Báo người quản trị đánh dấu ô này là bắt buộc ` +
      "trong cấu hình của gói."
    );
  }
  const which = column ? `cột ${column}` : "một cột";
  return (
    `Bảng cần giá trị cho ${which} mà biểu mẫu không có ô nào để điền, nên gửi lại cũng không qua. Báo người quản trị ` +
    `thêm trường ${column ?? "cho cột đó"} vào biểu mẫu của gói, cho quyền thêm dòng đặt cột bằng set (cột tenant phải ` +
    "đặt theo cách này), hoặc cho cột giá trị mặc định trong migration."
  );
}

/**
 * Lời báo cho người gửi. Phân theo mã lỗi của Hasura (extensions.code) rồi theo đầu thông điệp của PostgreSQL mà
 * Hasura chép lại; lỗi không nhận ra thì hiện nguyên văn, vì giấu đi thì người quản trị không biết sửa gì. Mã và
 * thông điệp đo trên hasura/graphql-engine v2.51.4-ce ngày 2026-11-23 bằng các lệnh thêm dòng vi phạm từng ràng buộc.
 */
export function insertError(failure: InsertFailure, role: string, fields: FieldName[] = []): string {
  if (failure.networkError) return "Không kết nối được máy chủ. Kiểm tra mạng rồi bấm gửi lại.";
  const first = failure.graphQLErrors[0];
  const message = first?.message ?? "";
  switch (first?.extensions?.code) {
    case "constraint-violation":
      if (message.startsWith("Not-NULL violation")) return notNullError(message, fields);
      if (message.startsWith("Uniqueness violation")) {
        return (
          "Đã có dòng mang cùng mã. Đổi mã rồi gửi lại. Nếu vừa gửi mà mất kết nối, dòng có thể đã được thêm ở lần " +
          "trước: xem lại danh sách trước khi gửi lần nữa."
        );
      }
      if (message.startsWith("Foreign key violation")) {
        return "Mục vừa chọn không còn trong danh sách (đã bị xóa hay đổi). Tải lại trang rồi chọn lại.";
      }
      return `Dữ liệu vi phạm ràng buộc của bảng: ${message}. Sửa giá trị rồi gửi lại.`;
    case "permission-error":
    case "access-denied":
      // Hasura gán mã permission-error cho cả ràng buộc CHECK của bảng lẫn `check` của quyền; chỉ đầu thông điệp phân
      // biệt hai lỗi. Không tách ra thì người nhập số âm bị bảo đi xin quyền.
      if (message.startsWith("Check constraint violation")) {
        return "Một giá trị không hợp lệ theo luật của bảng (ví dụ số âm). Sửa giá trị rồi gửi lại.";
      }
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
