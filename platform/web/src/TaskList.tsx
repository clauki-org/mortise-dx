// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Bảng việc: các task đang chờ người đăng nhập, gồm task đã giao cho họ và task chờ nhận theo vai trò của họ
// (workflow-api đã lọc theo tenant và vai trò). Mỗi dòng hiện tên hồ sơ theo khai báo của bước; việc gần hạn nhất
// đứng đầu, lọc được theo hạn.

import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { useSession } from "./session";
import { dateTime, dueText, recordTitle, stepOf, useSteps } from "./steps";
import { fetchTasks, type Task } from "./workflow";

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
  if (due === null) {
    return (
      <Badge variant="light" color="gray" tt="none">
        Không đặt hạn
      </Badge>
    );
  }
  const { text, overdue } = dueText(due, now);
  return (
    <Badge variant="light" color={overdue ? "red" : "blue"} tt="none" title={dateTime.format(new Date(due))}>
      {text}
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

  if (tasks.isPending) return <Loader aria-label="Đang tải danh sách việc" />;
  if (tasks.isError) {
    return (
      <Stack align="flex-start">
        <Alert color="red" title="Không tải được danh sách việc">
          {tasks.error.message}
        </Alert>
        <Button variant="light" onClick={() => tasks.refetch()}>
          Thử lại
        </Button>
      </Stack>
    );
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
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={1} size="h2">
            Việc của tôi
          </Title>
          <Text c="dimmed" size="sm">
            Việc đang chờ bạn hoặc vai trò của bạn xử lý, việc gần hạn nhất đứng đầu.
          </Text>
        </div>
        <SegmentedControl
          aria-label="Lọc theo hạn"
          data={FILTERS.map(({ value, label }) => ({ value, label: `${label} (${count(value)})` }))}
          value={filter}
          onChange={(value) => setFilter(value as Filter)}
        />
      </Group>
      {stepsError && (
        <Alert color="yellow" title="Không đọc được khai báo của bước">
          Cột hồ sơ tạm hiện tên bước thay cho tên hồ sơ. Tải lại trang; nếu vẫn lỗi, báo người quản trị.
        </Alert>
      )}
      <Paper withBorder radius="md">
        {shown.length === 0 ? (
          <Text c="dimmed" p="xl" ta="center">
            {tasks.data.length === 0 ? "Không có việc nào đang chờ bạn." : "Không có việc nào khớp bộ lọc."}
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={560}>
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
                      <Anchor component={Link} to={`/tasks/${encodeURIComponent(task.id)}`} fw={500}>
                        {recordTitle(task, stepOf(steps, task))}
                      </Anchor>
                      <Group gap={6}>
                        <Text size="xs" c="dimmed">
                          {task.name}
                        </Text>
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
                        {dateTime.format(new Date(task.created))}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>
    </Stack>
  );
}
