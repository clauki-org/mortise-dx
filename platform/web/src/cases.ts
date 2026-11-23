// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thành phần theo dõi hồ sơ (contracts/cases.schema.json, ADR 0032): kiểu cấu hình và lỗi cấu hình kiểm lại lúc chạy,
// lời gọi API /v1/workflow/cases (kiểu chép đúng schema CaseSummary, CaseDetail của contracts/workflow-api.openapi.json),
// tên hồ sơ và dòng thông tin theo khai báo bước, nhãn nhóm xử lý, mục menu theo dõi của một quy trình. Phần hiển thị
// ở CasesPanel.tsx và CaseScreen.tsx. Không có React ở đây để kiểm thử được bằng hàm thuần.

import { callApi } from "./api";
import { itemPath, type MenuItem } from "./menu";
import { variableText } from "./steps";
import type { StepConfig } from "./workflow";

export type CasesConfig = { title: string; description?: string; processes: string[] };

export type CurrentStep = { step: string; name: string; due: string | null };

export type CaseSummary = {
  id: string;
  process: string;
  started: string;
  ended: string | null;
  /** Mã sự kiện kết thúc; null khi còn mở hay bị dừng giữa chừng */
  outcome: string | null;
  outcomeName: string | null;
  current: CurrentStep[];
  /** Chỉ biến không thuộc bước nào; workflow-api đã bỏ ý kiến, quyết định của người xử lý */
  variables: Record<string, unknown>;
};

export type CaseStep = {
  step: string;
  name: string;
  kind: "task" | "wait";
  started: string;
  ended: string | null;
  due: string | null;
  status: "open" | "done" | "cancelled";
  /** Vai trò, hoặc `<tenant>/<vai trò>` với bước của tenant cha */
  groups: string[];
  claimed: boolean;
};

export type CaseDetail = CaseSummary & { steps: CaseStep[] };

export type CaseState = "open" | "ended" | "all";

export const PAGE_SIZE = 20;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Lỗi cấu hình: cấu hình đọc qua GraphQL không được kiểm lại lúc chạy, và process ghép vào địa chỉ API. */
export function casesProblems(config: CasesConfig): string[] {
  const processes = Array.isArray(config?.processes) ? config.processes : [];
  if (processes.length === 0) return ["chưa khai quy trình nào ở processes"];
  return processes
    .filter((process) => typeof process !== "string" || !SLUG.test(process))
    .map((process) => `"${String(process)}" không phải khóa quy trình`);
}

export function fetchCases(token: string | undefined, processes: string[], state: CaseState, page: number) {
  const query = new URLSearchParams(processes.map((process) => ["process", process]));
  query.set("state", state);
  query.set("offset", String((page - 1) * PAGE_SIZE));
  query.set("limit", String(PAGE_SIZE));
  return callApi<{ total: number; items: CaseSummary[] }>(`/v1/workflow/cases?${query}`, token);
}

export const fetchCase = (token: string | undefined, id: string) =>
  callApi<CaseDetail>(`/v1/workflow/cases/${encodeURIComponent(id)}`, token);

/** Khai báo các bước của một quy trình, theo thứ tự đọc từ platform_workflow_steps. */
export function processSteps(steps: Map<string, StepConfig>, process: string): StepConfig[] {
  return [...steps].filter(([key]) => key.startsWith(`${process}/`)).map(([, config]) => config);
}

/** Tên hồ sơ theo `title` của bước đầu tiên khai nó mà hồ sơ có giá trị; không có thì undefined. */
export function caseTitle(item: CaseSummary, steps: StepConfig[]): string | undefined {
  for (const step of steps) {
    const value = typeof step?.title === "string" ? item.variables[step.title] : undefined;
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * Dòng thông tin [biến, nhãn, giá trị] theo `details` của mọi bước của quy trình, mỗi biến một lần theo lần khai đầu.
 * Biến workflow-api không trả (trường của bước) thì không có dòng, kể cả khi `details` có khai.
 */
export function caseDetails(item: CaseSummary, steps: StepConfig[]): [string, string, string][] {
  const seen = new Set<string>();
  return steps.flatMap((step) =>
    (Array.isArray(step?.details) ? step.details : []).flatMap((detail): [string, string, string][] => {
      if (typeof detail?.variable !== "string" || typeof detail.label !== "string" || seen.has(detail.variable)) {
        return [];
      }
      seen.add(detail.variable);
      const value = item.variables[detail.variable];
      return value === undefined || value === null || value === ""
        ? []
        : [[detail.variable, detail.label, variableText(value)]];
    }),
  );
}

/** Bước đang chờ, hay kết quả khi hồ sơ đã kết thúc; hồ sơ dừng giữa chừng không có sự kiện kết thúc nào. */
export function caseStatus(item: CaseSummary): string {
  if (item.ended !== null) return item.outcomeName ?? "Đã dừng";
  return item.current.map((step) => step.name).join(", ") || "Đang chuyển bước";
}

/** "Đơn vị tinh-mau, vai trò manager" cho nhóm của tenant cha; "Vai trò manager" cho nhóm trong đơn vị. */
export function groupLabel(group: string): string {
  // Tách ở dấu / cuối: vai trò không chứa /, còn mã tenant thì có thể.
  const at = group.lastIndexOf("/");
  return at < 0 ? `Vai trò ${group}` : `Đơn vị ${group.slice(0, at)}, vai trò ${group.slice(at + 1)}`;
}

/** Trang theo dõi hồ sơ của quy trình `process` trong menu của gói `app` mà người dùng thấy; không có thì undefined. */
export function casesPathFor(items: MenuItem[], app: string, process: string, id: string): string | undefined {
  const entry = items.find(
    (candidate) =>
      candidate.app === app &&
      candidate.component === "cases" &&
      Array.isArray((candidate.config as CasesConfig | null)?.processes) &&
      (candidate.config as CasesConfig).processes.includes(process),
  );
  return entry ? `${itemPath(entry)}/${encodeURIComponent(id)}` : undefined;
}
