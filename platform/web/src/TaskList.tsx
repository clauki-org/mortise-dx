// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Bảng việc: các task đang chờ người đăng nhập, gồm task đã giao cho họ và task chờ nhận theo vai trò của họ
// (workflow-api đã lọc theo tenant và vai trò). Việc gần hạn nhất đứng đầu; lọc được theo hạn.

import { Alert, Badge, Button, Group, Loader, SegmentedControl, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSession } from "./session";
import { fetchTasks, type Task } from "./workflow";

type Filter = "all" | "overdue" | "upcoming" | "no-due";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "overdue", label: "Quá hạn" },
  { value: "upcoming", label: "Còn hạn" },
  { value: "no-due", label: "Không đặt hạn" },
];

const dateTime = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

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

function DueCell({ due, now }: { due: string | null; now: number }) {
  if (due === null)
    return (
      <Text size="sm" c="dimmed">
        Không đặt hạn
      </Text>
    );
  const overdue = Date.parse(due) < now;
  return (
    <Group gap="xs">
      <Text size="sm" c={overdue ? "red" : undefined}>
        {dateTime.format(new Date(due))}
      </Text>
      {overdue && <Badge color="red">Quá hạn</Badge>}
    </Group>
  );
}

export function TaskList() {
  const { getToken } = useSession();
  const [filter, setFilter] = useState<Filter>("all");
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => fetchTasks(getToken()) });
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
  const shown = tasks.data.filter((task) => matches(task, filter, now)).sort(byDue);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={1} size="h3">
          Việc của tôi
        </Title>
        <SegmentedControl
          aria-label="Lọc theo hạn"
          data={FILTERS}
          value={filter}
          onChange={(value) => setFilter(value as Filter)}
        />
      </Group>
      {shown.length === 0 ? (
        <Text c="dimmed">
          {tasks.data.length === 0 ? "Không có việc nào đang chờ bạn." : "Không có việc nào khớp bộ lọc."}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={640}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Việc</Table.Th>
                <Table.Th>Hạn</Table.Th>
                <Table.Th>Nhận lúc</Table.Th>
                <Table.Th>Quy trình</Table.Th>
                <Table.Th>Người xử lý</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((task) => (
                <Table.Tr key={task.id}>
                  <Table.Td>{task.name}</Table.Td>
                  <Table.Td>
                    <DueCell due={task.due} now={now} />
                  </Table.Td>
                  <Table.Td>{dateTime.format(new Date(task.created))}</Table.Td>
                  <Table.Td>{task.process}</Table.Td>
                  <Table.Td>{task.assignee === null ? "Chờ nhận theo vai trò" : "Đã giao cho bạn"}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
