// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Đổi một lỗi bất kỳ (ApiError của api.ts, CombinedError của urql, Error thường) thành lời tiếng Việt nói chuyện gì
// đã xảy ra và người dùng nên làm gì, kèm thông điệp gốc để đặt sau nút "Chi tiết kỹ thuật" (ErrorNotice trong
// States.tsx). Lý do do dịch vụ của lõi viết sẵn cho người dùng ({"error": "..."}, ví dụ quy tắc bốn mắt) được giữ
// nguyên; chỉ lỗi không mang lời như vậy mới đổi theo mã. Ở đây không có chữ của một lĩnh vực nào (ADR 0046).

import { ApiError } from "./api";

/** Lỗi mà thông điệp đã là lời cho người dùng (dựng bởi insertError, uploadError...); errorText giữ nguyên. */
export class ReadableError extends Error {}

export type ErrorView = {
  /** Lời cho người dùng: chuyện gì xảy ra và nên làm gì */
  text: string;
  /** Thông điệp gốc, chỉ hiện sau "Chi tiết kỹ thuật"; không có khi lời ở trên đã là toàn bộ thông tin */
  detail?: string;
};

const OFFLINE = "Không kết nối được máy chủ. Kiểm tra kết nối mạng rồi thử lại.";
const SESSION = "Phiên đăng nhập đã hết hạn. Tải lại trang để đăng nhập lại.";
const FORBIDDEN = "Tài khoản không được làm việc này. Báo người quản trị nếu cần thêm quyền.";
const UNKNOWN = "Đã có lỗi không mong muốn. Tải lại trang; nếu vẫn lỗi, báo người quản trị.";

/** Lời theo mã HTTP khi máy chủ không gửi kèm lý do đọc được (lỗi của cổng, của proxy, trang lỗi HTML). */
export function statusText(status: number): string {
  if (status === 0) return OFFLINE;
  if (status === 401) return SESSION;
  if (status === 403) return FORBIDDEN;
  if (status === 404) return "Không tìm thấy dữ liệu: có thể đã bị xóa, thuộc đơn vị khác, hoặc đường dẫn sai.";
  if (status === 409) return "Dữ liệu vừa được thay đổi ở nơi khác. Tải lại trang rồi làm lại.";
  if (status === 413) return "Nội dung gửi lên lớn quá giới hạn của máy chủ. Gửi tệp hay nội dung nhỏ hơn.";
  if (status === 400 || status === 422)
    return "Máy chủ không nhận dữ liệu đã gửi. Kiểm tra lại các ô đã nhập rồi gửi lại.";
  if (status === 429) return "Đã gửi quá nhiều yêu cầu trong một lúc. Chờ một phút rồi thử lại.";
  if (status >= 500) return "Máy chủ đang gặp sự cố. Thử lại sau ít phút; nếu vẫn lỗi, báo người quản trị.";
  return UNKNOWN;
}

/**
 * Lời theo mã lỗi GraphQL của Hasura (extensions.code). validation-failed là trường hay bảng không có trong lược đồ
 * của vai trò: cấu hình của gói trỏ tới cột không tồn tại, hoặc vai trò không được đọc cột đó; người dùng không tự
 * sửa được, nên lời chỉ tới người quản trị.
 */
function graphqlText(code: unknown): string {
  switch (code) {
    case "invalid-jwt":
    case "jwt-invalid-claims":
      return SESSION;
    case "access-denied":
    case "permission-error":
      return FORBIDDEN;
    case "validation-failed":
      return "Mục này đọc dữ liệu mà tài khoản không được xem, hoặc cấu hình của gói không khớp dữ liệu. Báo người quản trị kiểm cấu hình và quyền.";
    case "constraint-violation":
      return "Dữ liệu vi phạm ràng buộc của bảng hay vừa được thay đổi ở nơi khác. Tải lại trang rồi làm lại.";
    case "data-exception":
      return "Một giá trị sai định dạng. Kiểm tra lại các ô đã nhập rồi gửi lại.";
    default:
      return "Máy chủ dữ liệu từ chối yêu cầu. Thử lại; nếu vẫn lỗi, báo người quản trị.";
  }
}

/** Phần của CombinedError (urql) cần để đọc lỗi; kiểm thử dựng được mà không cần client của urql. */
type GraphqlFailure = {
  message: string;
  networkError?: unknown;
  graphQLErrors: { extensions?: Record<string, unknown> }[];
  response?: unknown;
};

function isGraphqlFailure(error: unknown): error is GraphqlFailure {
  return error instanceof Error && Array.isArray((error as Partial<GraphqlFailure>).graphQLErrors);
}

function responseStatus(response: unknown): number | undefined {
  const status = (response as { status?: unknown } | undefined)?.status;
  return typeof status === "number" ? status : undefined;
}

function graphqlView(error: GraphqlFailure): ErrorView {
  const first = error.graphQLErrors[0];
  if (first) return { text: graphqlText(first.extensions?.code), detail: error.message };
  // Lỗi mạng của urql mang Response khi máy chủ có trả lời (401 của cổng, 5xx); không có Response là mất kết nối.
  const status = responseStatus(error.response);
  return { text: status !== undefined && status >= 400 ? statusText(status) : OFFLINE, detail: error.message };
}

export function errorText(error: unknown): ErrorView {
  if (error instanceof ReadableError) return { text: error.message };
  if (error instanceof ApiError) {
    if (!error.readable) return { text: statusText(error.status), detail: error.message };
    return { text: error.message, detail: error.status > 0 ? `HTTP ${error.status}` : undefined };
  }
  if (isGraphqlFailure(error)) return graphqlView(error);
  return { text: UNKNOWN, detail: error instanceof Error ? error.message : String(error) };
}
