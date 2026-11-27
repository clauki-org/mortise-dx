// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Bảng việc: các task đang chờ người đăng nhập, gồm task đã giao cho họ và task chờ nhận theo vai trò của họ
// (workflow-api đã lọc theo tenant và vai trò). Mỗi dòng hiện tên hồ sơ theo khai báo của bước; việc gần hạn nhất
// đứng đầu, lọc được theo hạn.

import { Alert, Anchor, Badge, Group, Paper, SegmentedControl, Stack, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { formatDateTime } from "./format";
import { PageHeader } from "./PageHeader";
import { Empty, ErrorNotice, Loading } from "./States";
import { StatusBadge } from "./StatusBadge";
import { useSession } from "./session";
import { dueText, recordTitle, stepOf, useSteps } from "./steps";
import { TableScroll } from "./TableScroll";
import { delegatedFrom, fetchTasks, type Task } from "./workflow";

type Filter = "all" | "overdue" | "upcoming" | "no-due";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "overdue", label: "Quá hạn" },
  { value: "upcoming", label: "Còn hạn" },
  { value: "no-due", label: "Không đặt hạn" },
];

function matches(task: Task, filter: Filter, now: number): boolean {
  const due = task.due === null ? null : Date.parse(task.due);
  switch (filter) {
    case "all":
      return true;
    case "overdue":
      return due !== null && due < now;
    case "upcoming":
      return due !== null && due >= now;
    case "no-due":
      return due === null;
  }
}

// Có hạn trước, hạn sớm trước; không hạn xếp cuối. Cùng hạn thì việc đến trước đứng trước.
function byDue(a: Task, b: Task): number {
  const dueA = a.due === null ? Number.POSITIVE_INFINITY : Date.parse(a.due);
  const dueB = b.due === null ? Number.POSITIVE_INFINITY : Date.parse(b.due);
  return dueA - dueB || Date.parse(a.created) - Date.parse(b.created);
}

export function DueBadge({ due, now }: { due: string | null; now: number }) {
  if (due === null) return <StatusBadge tone="neutral">Không đặt hạn</StatusBadge>;
  const { text, overdue } = dueText(due, now);
  return (
    <StatusBadge tone={overdue ? "bad" : "info"} title={formatDateTime(due)}>
      {text}
    </StatusBadge>
  );
}

/**
 * Nhãn mã tenant của hồ sơ khi bước thuộc hồ sơ tenant khác, được gán cho tenant của người đăng nhập. Chỉ có
 * mã, không có tên: quyền Hasura của người đăng nhập không đọc được dòng tenant của tenant con.
 */
export function DelegatedBadge({ task }: { task: Task }) {
  const { user } = useSession();
  const tenant = delegatedFrom(task, user.profile.tenant);
  if (tenant === undefined) return null;
  return (
    <Badge size="xs" variant="light" color="grape" tt="none" title="Bước của đơn vị cấp dưới, giao cho đơn vị bạn">
      Đơn vị {tenant}
    </Badge>
  );
}

export function TaskList() {
  const { getToken } = useSession();
  const [filter, setFilter] = useState<Filter>("all");
  // Màn hình xử lý chuyển về đây kèm tên việc vừa xong, để người dùng biết lần gửi đã thành công.
  const done = (useLocation().state as { done?: string } | null)?.done;
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => fetchTasks(getToken()) });
  const { steps, error: stepsError } = useSteps();
  const now = Date.now();

  if (tasks.isPending) return <Loading what="danh sách việc" />;
  if (tasks.isError) {
    return <ErrorNotice title="Không tải được danh sách việc" error={tasks.error} onRetry={() => tasks.refetch()} />;
  }
  const count = (value: Filter) => tasks.data.filter((task) => matches(task, value, now)).length;
  const shown = tasks.data.filter((task) => matches(task, filter, now)).sort(byDue);

  return (
    <Stack>
      {done && (
        <Alert color="teal" title="Đã gửi">
          {done}: đã xử lý xong.
        </Alert>
      )}
      <PageHeader
        title="Việc của tôi"
        description="Việc đang chờ bạn hoặc vai trò của bạn xử lý, việc gần hạn nhất đứng đầu."
        action={
          <SegmentedControl
            aria-label="Lọc theo hạn"
            data={FILTERS.map(({ value, label }) => ({ value, label: `${label} (${count(value)})` }))}
            value={filter}
            onChange={(value) => setFilter(value as Filter)}
          />
        }
      />
      {stepsError && (
        <Alert color="yellow" title="Không đọc được khai báo của bước">
          Cột hồ sơ tạm hiện tên bước thay cho tên hồ sơ. Tải lại trang; nếu vẫn lỗi, báo người quản trị.
        </Alert>
      )}
      <Paper withBorder radius="md">
        {shown.length === 0 ? (
          tasks.data.length === 0 ? (
            <Empty title="Không có việc nào đang chờ bạn." hint="Việc mới được giao sẽ hiện ở đây." />
          ) : (
            <Empty title="Không có việc nào khớp bộ lọc." hint="Chọn Tất cả để xem mọi việc đang chờ." />
          )
        ) : (
          <TableScroll label="Việc của tôi" minWidth={560}>
            <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Hồ sơ</Table.Th>
                  <Table.Th>Hạn</Table.Th>
                  <Table.Th>Người gửi</Table.Th>
                  <Table.Th>Nhận lúc</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {shown.map((task) => (
                  <Table.Tr key={task.id}>
                    <Table.Td>
                      <Anchor component={Link} to={`/tasks/${encodeURIComponent(task.id)}`} fw={600}>
                        {recordTitle(task, stepOf(steps, task))}
                      </Anchor>
                      <Group gap={6}>
                        <Text size="xs" c="dimmed">
                          {task.name}
                        </Text>
                        <DelegatedBadge task={task} />
                        {task.assignee !== null && (
                          <Badge size="xs" variant="outline" tt="none">
                            Đã giao cho bạn
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <DueBadge due={task.due} now={now} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{String(task.variables.initiatorName ?? "")}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {formatDateTime(task.created)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </TableScroll>
        )}
      </Paper>
    </Stack>
  );
}
