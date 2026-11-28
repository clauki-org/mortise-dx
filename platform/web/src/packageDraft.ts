// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần không có React của màn hình soạn bản nháp cấu hình gói (ADR 0071): kiểu phản hồi theo PackageDraft trong
// contracts/assistant.openapi.json, lời gọi POST /v1/assistant/package-drafts, ai được mở màn hình và tên tệp khi tải
// về. PackageDraftPage.tsx hiển thị; Shell.tsx chỉ đặt màn hình lên menu cho quản trị đơn vị.

import { callApi } from "./api";
import { type ModelInfo, modelWhere } from "./assistant";
import { rolesOf } from "./menu";

export type DraftProblem = { path: string; message: string };
export type DraftFile = { path: string; component: string | null; content: string };
export type DraftArgument = { need: string; capability: string; why: string };
export type DraftChoice = { item: string; component: string; arguments: DraftArgument[] };

export type PackageDraft = {
  outcome: "drafted" | "invalid" | "refused";
  reason: string | null;
  files: DraftFile[];
  problems: DraftProblem[];
  to_write: DraftProblem[];
  choices: DraftChoice[];
  model: ModelInfo;
  attempts: number;
};

// Vai trò mà dịch vụ đòi (ADR 0071). Giao diện chỉ dùng nó để ẩn mục menu; dịch vụ vẫn tự từ chối người khác bằng 403,
// nên mở thẳng đường dẫn không vượt được quyền.
const ADMIN_ROLE = "tenant_admin";

export const canDraft = (accessToken: string | undefined) => rolesOf(accessToken).includes(ADMIN_ROLE);

/** Gửi nhu cầu; độ dài tối đa do dịch vụ kiểm và trả lời bằng 400 kèm lý do, giao diện không đặt số riêng. */
export function draftPackage(token: string | undefined, need: string) {
  return callApi<PackageDraft>("/v1/assistant/package-drafts", token, {
    method: "POST",
    body: JSON.stringify({ need }),
  });
}

/** Dòng cho quản trị viên biết bản nháp do mô hình nào soạn và nhu cầu đã đi đâu. */
export function draftModelLine(draft: PackageDraft): string {
  const repaired = draft.attempts === 2 ? "; bước kiểm thấy lỗi ở lượt đầu nên mô hình đã sửa một lần" : "";
  return `Soạn bởi ${draft.model.name}, ${modelWhere(draft.model)}${repaired}.`;
}

/**
 * Tên tệp khi tải về. Hai tệp cùng tên ở hai thư mục (catalog/requests.yaml, cases/requests.yaml) là chuyện thường,
 * nên giữ cả thư mục trong tên thay vì chỉ lấy phần cuối, không thì tệp tải sau ghi đè hay bị đổi tên lung tung.
 */
export const downloadName = (path: string) => path.replaceAll("/", "__");
