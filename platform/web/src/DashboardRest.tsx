// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Khối bảng điều hành đọc nguồn REST bằng token của người xem (ADR 0035): số hồ sơ của một quy trình (workflow-api),
// việc đang chờ chính người xem, số đo thiết bị (context-api). Đọc ở đây, đổi phản hồi thành dòng bằng
// dashboardSources.ts, vẽ bằng DashboardView.tsx như khối graphql. Ở đây không có tên quy trình hay chữ của một lĩnh
// vực nào.

import { Alert, Loader, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { callApi } from "./api";
import { CardsView, ChartView, MethodDetails, type RestSent } from "./DashboardView";
import type { Panel, Row } from "./dashboardConfig";
import {
  type ContextSource,
  contextLimit,
  contextRows,
  countRows,
  type Entity,
  myTaskRows,
  type ProcessCounts,
  restPath,
  type WorkflowSource,
} from "./dashboardSources";
import { useSession } from "./session";
import { dateTime } from "./steps";
import type { Task } from "./workflow";

type Loaded = { rows: Row[]; notes: string[]; more?: boolean };

const MINE = "Số việc đang chờ bạn: chỉ việc trên bảng việc của tài khoản đang đăng nhập, không phải của cả đơn vị.";

async function loadWorkflow(token: string | undefined, panel: Panel, source: WorkflowSource): Promise<Loaded> {
  const path = restPath(panel);
  if (source.counts === "mine") {
    const tasks = await callApi<Task[]>(path, token);
    const now = Date.now();
    const at = dateTime.format(now);
    return {
      rows: myTaskRows(tasks, source.process, now, Boolean(panel.chart)),
      notes: [
        `Đếm trên trình duyệt: việc của quy trình ${source.process} trong danh sách trả về; quá hạn là việc có hạn trước ${at}.`,
      ],
    };
  }
  const counts = await callApi<ProcessCounts>(path, token);
  const notes = [
    `workflow-api đếm lúc ${dateTime.format(new Date(counts.counted_at))}; quá hạn là số bước, không phải số hồ sơ.`,
  ];
  return { rows: countRows(counts, Boolean(panel.chart)), notes };
}

async function loadContext(token: string | undefined, panel: Panel, source: ContextSource): Promise<Loaded> {
  const entities = await callApi<Entity[]>(restPath(panel), token);
  const limit = contextLimit(source);
  const rows = contextRows(entities.slice(0, limit), source.attribute);
  const notes = [
    "Thiết bị không có số đo này không thành dòng; observedAt là lúc thiết bị đo, ghi nguyên văn như context-api trả (ISO 8601).",
  ];
  return { rows, notes, more: entities.length > limit };
}

export function RestBody({ panel, link }: { panel: Panel; link: ReactNode }) {
  const { getToken } = useSession();
  const path = restPath(panel);
  // Khóa gồm quy trình: khối "mine" của các quy trình khác nhau gửi cùng đường dẫn mà ra dòng khác nhau. gcTime 0: mở
  // lại trang thì đọc lại từ máy chủ, không hiện số cũ trong lúc chờ, như khối graphql.
  const result = useQuery({
    queryKey: ["dashboard", panel.id, path, panel.workflow?.process ?? ""],
    gcTime: 0,
    queryFn: () =>
      panel.context
        ? loadContext(getToken(), panel, panel.context)
        : loadWorkflow(getToken(), panel, panel.workflow as WorkflowSource),
  });
  const empty = panel.context ? "Chưa có số đo" : "Không có việc nào đang chờ bạn";
  const sent: RestSent = { path, notes: result.data?.notes ?? [] };
  const data = result.data;
  return (
    <>
      {panel.workflow?.counts === "mine" && <Text size="sm">{MINE}</Text>}
      {result.isError && (
        <Alert color="red" title={`Không đọc được số liệu của khối "${panel.title}"`}>
          {result.error.message}. Tải lại trang; nếu vẫn lỗi, báo người quản trị.
        </Alert>
      )}
      {result.isPending && <Loader size="sm" aria-label={`Đang tải ${panel.title}`} />}
      {data && panel.cards && <CardsView cards={panel.cards} rows={data.rows} empty={empty} large={panel.primary} />}
      {data && panel.chart && (
        <ChartView
          chart={panel.chart}
          rows={data.rows}
          title={panel.title}
          empty={empty}
          ordinal={Boolean(panel.context)}
        />
      )}
      {data?.more && panel.context && (
        <Text size="sm">
          Nguồn có hơn {contextLimit(panel.context)} thiết bị; chỉ hiện {contextLimit(panel.context)} thiết bị đầu.
        </Text>
      )}
      {link}
      <MethodDetails panel={panel} rest={sent} />
    </>
  );
}
