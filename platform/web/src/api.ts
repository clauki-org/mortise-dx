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

export async function callApi<T>(path: string, token: string | undefined, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, "Không kết nối được máy chủ; kiểm tra mạng rồi thử lại");
  }
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new ApiError(response.status, errorReason(body, response.status));
  // Cổng lệch cấu hình có thể để nginx trả index.html với mã 200; coi đó là lỗi thay vì đưa dữ liệu rỗng cho màn hình.
  if (body === undefined) throw new ApiError(response.status, "Máy chủ trả dữ liệu không đọc được; báo người quản trị");
  return body as T;
}
