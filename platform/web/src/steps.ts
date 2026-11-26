// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Khai báo bước của mọi quy trình trong tenant (platform_workflow_steps, contracts/workflow.schema.json) và những gì
// suy ra từ nó cho một task: tên hồ sơ, hạn còn bao lâu. Một truy vấn cho mọi bước vì số bước nhỏ; bảng việc và màn
// hình xử lý dùng chung, urql giữ kết quả nên chuyển giữa hai màn hình không tải lại.

import { useMemo } from "react";
import { useQuery } from "urql";
import { formatNumber } from "./format";
import type { StepConfig, Task } from "./workflow";

const STEPS = "query { platform_workflow_steps { process step config } }";

type StepsData = { platform_workflow_steps: { process: string; step: string; config: StepConfig }[] };

export function useSteps() {
  const [{ data, fetching, error }] = useQuery<StepsData>({ query: STEPS });
  const steps = useMemo(
    () => new Map(data?.platform_workflow_steps.map((row) => [`${row.process}/${row.step}`, row.config])),
    [data],
  );
  return { steps, fetching, error };
}

export const stepOf = (steps: Map<string, StepConfig>, task: Task) => steps.get(`${task.process}/${task.step}`);

/** Tên hồ sơ theo khai báo `title` của bước; bước không khai thì dùng tên bước trong BPMN. */
export function recordTitle(task: Task, step: StepConfig | undefined): string {
  const value = step?.title === undefined ? undefined : task.variables[step.title];
  return typeof value === "string" && value.trim() !== "" ? value : task.name;
}

/**
 * "Còn 3 ngày", "Quá hạn 5 giờ": đọc nhanh hơn ngày giờ tuyệt đối khi xếp việc theo hạn. Làm tròn xuống, để không
 * bao giờ báo còn nhiều thời gian hơn thực tế (còn 20 phút không thành "còn 1 giờ"); ngày giờ chính xác ở tooltip.
 */
export function dueText(due: string, now: number): { text: string; overdue: boolean } {
  const ms = Date.parse(due) - now;
  const hours = Math.floor(Math.abs(ms) / 3_600_000);
  const amount = hours < 1 ? "dưới 1 giờ" : hours < 24 ? `${hours} giờ` : `${Math.floor(hours / 24)} ngày`;
  return ms < 0 ? { text: `Quá hạn ${amount}`, overdue: true } : { text: `Còn ${amount}`, overdue: false };
}

/** Chữ hiện cho giá trị của một biến: số viết kiểu Việt Nam, đúng sai thành Có, Không. */
export function variableText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "Có" : "Không";
  return JSON.stringify(value);
}

/**
 * Dòng thông tin hồ sơ theo `details` của bước: [biến, nhãn, giá trị]. Khai báo đọc qua GraphQL không được kiểm lại
 * lúc chạy, nên mục sai dạng bị bỏ thay vì làm hỏng màn hình; biến chưa có giá trị không hiện. Biến khai lại lần nữa
 * chỉ hiện ở lần khai đầu: cùng một giá trị hiện hai lần không thêm gì, và tên biến là khóa của dòng trên màn hình.
 */
export function detailRows(task: Task, step: StepConfig | undefined): [string, string, string][] {
  const details = Array.isArray(step?.details) ? step.details : [];
  const seen = new Set<string>();
  return details.flatMap((detail): [string, string, string][] => {
    if (typeof detail?.variable !== "string" || typeof detail.label !== "string") return [];
    if (seen.has(detail.variable)) return [];
    seen.add(detail.variable);
    const value = task.variables[detail.variable];
    return value === undefined || value === null || value === ""
      ? []
      : [[detail.variable, detail.label, variableText(value)]];
  });
}

// Bảng điều hành đọc dateTime từ đây; đưa lại từ format.ts để mọi trang cùng một kiểu ngày giờ.
export { dateTime } from "./format";
