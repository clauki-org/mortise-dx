// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// API quy trình (/v1/workflow) theo hợp đồng contracts/workflow-api.openapi.json. Kiểu Task chép đúng schema Task của
// hợp đồng; đổi hợp đồng thì sửa kiểu ở đây.

import { callApi } from "./api";

export type Task = {
  id: string;
  name: string;
  /** Tenant của hồ sơ; khác tenant của người đăng nhập khi bước của tenant con được giao lên (ADR 0029) */
  tenant: string;
  /** Khóa của quy trình (BPMN) */
  process: string;
  /** id của userTask; cùng process xác định khai báo của bước (platform_workflow_steps) */
  step: string;
  /** Hạn xử lý, ISO 8601; null nếu bước không đặt hạn */
  due: string | null;
  category: string | null;
  processInstanceId: string;
  /** Thời điểm tạo, ISO 8601 */
  created: string;
  /** sub của người được giao; null nếu còn chờ nhận theo vai trò */
  assignee: string | null;
  variables: Record<string, unknown>;
};

/**
 * Tenant của hồ sơ khi đó không phải tenant của người đăng nhập, tức bước tenant con giao lên theo bảng phân cấp (ADR
 * 0029); undefined với task của chính tenant mình. `profileTenant` là claim `tenant` của ID token (mảng tên nhóm).
 */
export function delegatedFrom(task: Task, profileTenant: unknown): string | undefined {
  const own = Array.isArray(profileTenant) ? profileTenant : [profileTenant];
  return own.includes(task.tenant) ? undefined : task.tenant;
}

export const fetchTasks = (token: string | undefined) => callApi<Task[]>("/v1/workflow/tasks", token);

/** Hoàn thành task; variables là dữ liệu biểu mẫu gộp với biến của nút được bấm. */
export const completeTask = (token: string | undefined, taskId: string, variables: Record<string, unknown>) =>
  callApi<void>(`/v1/workflow/tasks/${encodeURIComponent(taskId)}/complete`, token, {
    method: "POST",
    body: JSON.stringify({ variables }),
  });

/**
 * Khởi tạo quy trình `process` của tenant mình. Cùng người gửi lại cùng `idempotencyKey` thì workflow-api trả quy
 * trình đã tạo thay vì tạo thêm, nên bấm đúp hay gửi lại sau lỗi mạng không sinh hai hồ sơ.
 */
export const startProcess = (
  token: string | undefined,
  process: string,
  variables: Record<string, unknown>,
  idempotencyKey: string,
) =>
  callApi<{ id: string; process: string }>(`/v1/workflow/processes/${encodeURIComponent(process)}/instances`, token, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ variables }),
  });

/** Khai báo của một bước (contracts/workflow.schema.json, $defs.step), đọc từ platform_workflow_steps. */
export type StepConfig = {
  /** Biến chứa tên hồ sơ */
  title?: string;
  /** Biến hiện chỉ đọc trong thông tin hồ sơ, theo thứ tự khai */
  details?: { variable: string; label: string }[];
  form?: Record<string, unknown>;
  ui?: Record<string, unknown>;
  actions: { id: string; label: string; variables: Record<string, unknown> }[];
  record?: { menu: string; variable: string };
};

/**
 * Mã Idempotency-Key mới cho một lần định lập hồ sơ: 32 chữ số hex, trong luật 8–100 ký tự của workflow-api. Không
 * dùng crypto.randomUUID vì hàm đó chỉ có trên trang HTTPS hay localhost.
 */
export function idempotencyKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
