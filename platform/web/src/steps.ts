// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Khai báo bước của mọi quy trình trong tenant (platform_workflow_steps, contracts/workflow.schema.json) và những gì
// suy ra từ nó cho một task: tên hồ sơ, hạn còn bao lâu. Một truy vấn cho mọi bước vì số bước nhỏ; urql giữ kết quả
// nên quay lại bảng việc không tải lại.

import { useMemo } from "react";
import { useQuery } from "urql";
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

export const dateTime = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });
