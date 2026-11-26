// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Gọi API REST của lõi qua cổng (/v1/...) bằng access token hiện tại. Lỗi của cổng và của workflow-api đều có dạng
// {"error": "..."} (ErrorBody trong contracts/workflow-api.openapi.json), nên lý do được đưa thẳng lên giao diện.

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function errorReason(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return `Máy chủ trả lỗi ${status}`;
}

/** Gửi yêu cầu kèm token; lỗi mạng thành ApiError mã 0 để nơi gọi báo một kiểu lỗi duy nhất. */
async function send(path: string, token: string | undefined, init: RequestInit, contentType?: string) {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (contentType) headers.set("Content-Type", contentType);
  try {
    return await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, "Không kết nối được máy chủ; kiểm tra mạng rồi thử lại");
  }
}

/** Đọc thân JSON của phản hồi; mã lỗi thì ném ApiError mang lý do của máy chủ. */
async function jsonOf<T>(response: Response): Promise<T> {
  // Cổng hay nginx có thể trả lỗi không phải JSON (413 của proxy, trang lỗi); khi đó lý do là mã HTTP.
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new ApiError(response.status, errorReason(body, response.status));
  // Cổng lệch cấu hình có thể để nginx trả index.html với mã 200; coi đó là lỗi thay vì đưa dữ liệu rỗng cho màn hình.
  if (body === undefined) throw new ApiError(response.status, "Máy chủ trả dữ liệu không đọc được; báo người quản trị");
  return body as T;
}

export async function callApi<T>(path: string, token: string | undefined, init: RequestInit = {}): Promise<T> {
  const response = await send(path, token, init, init.body !== undefined ? "application/json" : undefined);
  if (response.status === 204) return undefined as T;
  return jsonOf<T>(response);
}

/**
 * Tải một tệp lên API tệp của lõi (POST /v1/files, contracts/files-api.openapi.json): thân là nội dung tệp nguyên
 * văn, không multipart, nên không đi qua callApi vốn đặt Content-Type JSON. Trả thông tin tệp đã lưu.
 */
export async function uploadFile<T>(token: string | undefined, file: File): Promise<T> {
  const path = `/v1/files?name=${encodeURIComponent(file.name)}`;
  return jsonOf<T>(await send(path, token, { method: "POST", body: file }, file.type || "application/octet-stream"));
}

/**
 * Tải nội dung một tệp về máy người dùng. Liên kết thẳng tới /v1/files/{id}/content không mang được token, nên đọc
 * bằng fetch thành Blob rồi bấm một thẻ <a download> trỏ tới Blob đó; trang không mở hay hiển thị nội dung tệp.
 */
export async function downloadFile(token: string | undefined, id: string, name: string): Promise<void> {
  const response = await send(`/v1/files/${encodeURIComponent(id)}/content`, token, {});
  if (!response.ok) await jsonOf(response);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Thu hồi ngay trong lúc trình duyệt vừa bắt đầu lưu có thể làm hỏng lượt tải; chờ một lúc rồi giải phóng bộ nhớ.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
