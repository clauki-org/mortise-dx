// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Hai nguồn REST của bảng điều hành (ADR 0035), cạnh nguồn graphql ở dashboardConfig.ts: `workflow` đọc số hồ sơ
// của một quy trình từ workflow-api, `context` đọc số đo của thiết bị từ context-api, đều bằng token của người xem.
// Ở đây có kiểu, luật tên giá trị mà thẻ và biểu đồ được nhắc tới, đường dẫn đã gửi (dùng chung cho lời gọi và mục
// "Nguồn") và cách đổi phản hồi thành dòng cho DashboardView.tsx. Không có React để kiểm thử bằng hàm thuần.
//
// Số của cả đơn vị (`counts: tenant`) do workflow-api đếm. Riêng `counts: mine` đếm trên trình duyệt: danh sách việc
// của người xem là đủ với chính họ, nên đếm nó không gặp vấn đề số theo quyền mà ADR 0033 tránh.

import type { Panel, Row } from "./dashboardConfig";
import type { Task } from "./workflow";

export type WorkflowSource = { process: string; counts: "tenant" | "mine" };

export type ContextSource = { type: string; attribute: string; limit?: number };

/** Phản hồi của GET /v1/workflow/processes/{key}/counts (ProcessCounts trong contracts/workflow-api.openapi.json). */
export type ProcessCounts = {
  process: string;
  open: number;
  finished: number;
  /** Số bước đang chờ đã quá hạn, không phải số hồ sơ */
  overdue: number;
  steps: { step: string; name: string; open: number; overdue: number }[];
  counted_at: string;
};

/** Entity NGSI-LD mà context-api trả: mỗi số đo là một thuộc tính { type, value, observedAt }. */
export type Entity = { id: string; type: string } & Record<string, unknown>;

/** Tên giá trị thẻ, trục, cột số và cột chi tiết được nhắc tới, theo nguồn; make check-fast dùng cùng bảng này. */
export function valueNames(source: Pick<Panel, "workflow" | "context">) {
  if (source.context) return { cards: ["id", "value", "observedAt"], x: ["id"], y: ["value"], details: ["observedAt"] };
  const totals = source.workflow?.counts === "mine" ? ["open", "overdue"] : ["open", "overdue", "finished"];
  return { cards: totals, x: ["step"], y: ["open", "overdue"], details: ["open", "overdue"] };
}

const PROCESS = /^[A-Za-z_][A-Za-z0-9_.-]{0,254}$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const CONTEXT_LIMIT = 50;

/** Lỗi cấu hình của khối nguồn workflow hay context mà schema không bắt được hay cần kiểm lại lúc chạy. */
export function restProblems(panel: Panel): string[] {
  const problems: string[] = [];
  const { title, workflow, context } = panel;
  if (!workflow && !context) return problems;
  if (workflow && !PROCESS.test(String(workflow.process)))
    problems.push(`${title}: "${workflow.process}" không phải khóa quy trình`);
  if (workflow && !["tenant", "mine"].includes(workflow.counts))
    problems.push(`${title}: counts phải là tenant hoặc mine`);
  for (const name of context ? [context.type, context.attribute] : []) {
    if (!NAME.test(String(name)))
      problems.push(`${title}: "${name}" không phải tên hợp lệ (chỉ chữ không dấu, số, gạch dưới)`);
  }
  const allowed = valueNames(panel);
  const used: [string, string[], string[]][] = [
    ["cards", (panel.cards ?? []).map((card) => card.column), allowed.cards],
    ["chart.x", panel.chart ? [panel.chart.x.column] : [], allowed.x],
    ["chart.y", (panel.chart?.y ?? []).map((series) => series.column), allowed.y],
    ["chart.details", (panel.chart?.details ?? []).map((detail) => detail.column), allowed.details],
  ];
  for (const [where, names, known] of used) {
    for (const name of names.filter((item) => !known.includes(item))) {
      problems.push(`${title}: ${where} không có giá trị "${name}"; dùng ${known.join(", ")}`);
    }
  }
  return problems;
}

export const contextLimit = (source: ContextSource) => source.limit ?? CONTEXT_LIMIT;

/** Đường dẫn gọi qua cổng; mục "Nguồn" in đúng chuỗi này. Context xin thừa một dòng để biết còn thiết bị chưa hiện. */
export function restPath(source: Pick<Panel, "workflow" | "context">): string {
  const { workflow, context } = source;
  if (context) {
    const query = new URLSearchParams({
      type: context.type,
      attrs: context.attribute,
      limit: String(contextLimit(context) + 1),
    });
    return `/v1/context/entities?${query}`;
  }
  if (workflow?.counts === "mine") return "/v1/workflow/tasks";
  return `/v1/workflow/processes/${encodeURIComponent(workflow?.process ?? "")}/counts`;
}

/** Dòng của khối số hồ sơ cả đơn vị: thẻ số đọc một dòng tổng, biểu đồ đọc mỗi bước một dòng. */
export function countRows(counts: ProcessCounts, chart: boolean): Row[] {
  if (chart) return counts.steps.map((step) => ({ step: step.name, open: step.open, overdue: step.overdue }));
  return [{ open: counts.open, overdue: counts.overdue, finished: counts.finished }];
}

/**
 * Dòng của khối việc đang chờ người xem: việc của quy trình trong cấu hình, quá hạn là việc có hạn trước `now`. Biểu
 * đồ mỗi bước một dòng, theo tên bước; bước không còn việc nào thì không có dòng.
 */
export function myTaskRows(tasks: Task[], process: string, now: number, chart: boolean): Row[] {
  const mine = tasks.filter((task) => task.process === process);
  const late = (task: Task) => task.due !== null && Date.parse(task.due) < now;
  if (!chart) return [{ open: mine.length, overdue: mine.filter(late).length }];
  const steps = new Map<string, Task[]>();
  for (const task of mine) steps.set(task.name, [...(steps.get(task.name) ?? []), task]);
  return [...steps.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "vi"))
    .map(([name, items]) => ({ step: name, open: items.length, overdue: items.filter(late).length }));
}

/**
 * Mỗi entity có số đo `attribute` một dòng { id, value, observedAt }, theo id. Không dựa vào việc context-api bỏ
 * entity thiếu số đo đó: entity không có số đo đó không thành dòng, để không hiện như số đo bằng 0.
 */
export function contextRows(entities: Entity[], attribute: string): Row[] {
  const rows: Row[] = [];
  for (const entity of entities) {
    const property = entity[attribute];
    if (typeof property !== "object" || property === null || !("value" in property)) continue;
    const { value, observedAt } = property as { value: unknown; observedAt?: unknown };
    rows.push({ id: entity.id, value, observedAt: observedAt ?? null });
  }
  return rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
