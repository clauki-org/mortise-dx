// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// API quy trình (/v1/workflow) theo hợp đồng contracts/workflow-api.openapi.json. Kiểu Task chép đúng schema Task của
// hợp đồng; đổi hợp đồng thì sửa kiểu ở đây.

import { callApi } from "./api";

export type Task = {
  id: string;
  name: string;
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

export const fetchTasks = (token: string | undefined) => callApi<Task[]>("/v1/workflow/tasks", token);
