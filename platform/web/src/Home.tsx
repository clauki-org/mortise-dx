// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Trang chủ, điểm vào sau khi đăng nhập (ADR 0051): trên cùng là mọi việc đang chờ người đăng nhập, mỗi việc một liên
// kết mang đúng chữ như ở "Việc của tôi" (TaskList.tsx); dưới là một ô cho mỗi nhóm menu của gói với lối tắt tới các
// trang của nhóm. Chữ của ô lấy từ menu mà thanh bên đã tải (menu.ts), nên ở đây không có tên gói hay chữ của lĩnh vực.

import { Alert, Anchor, Box, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { Link } from "react-router";
import { homeGroups, type MenuGroup } from "./menu";
import { MenuIconShape } from "./menuIcons";
import { usePackageMenu } from "./PackagePage";
import { PageHeader } from "./PageHeader";
import { Empty, ErrorNotice, Loading } from "./States";
import { useSession } from "./session";
import { recordTitle, stepOf, useSteps } from "./steps";
import { byDue, DelegatedBadge, DueBadge } from "./TaskList";
import { fetchTasks, type StepConfig, type Task } from "./workflow";

type TasksProps = { tasks: Task[]; steps: Map<string, StepConfig>; now: number };

/**
 * Danh sách việc, không cắt bớt: người duyệt bấm thẳng vào việc ở đây như trước kia ở bảng việc, nên số lần bấm của
 * kịch bản demo không tăng. Chữ của liên kết chỉ là tên hồ sơ; bước, hạn, người gửi đứng ngoài liên kết để e2e và
 * trình đọc màn hình tìm việc theo đúng tên hồ sơ.
 */
export function WaitingTasks({ tasks, steps, now }: TasksProps) {
  if (tasks.length === 0) {
    return <Empty title="Không có việc nào đang chờ bạn." hint="Việc mới được giao sẽ hiện ở đây." />;
  }
  return (
    <Box component="ul" m={0} p={0} style={{ listStyle: "none" }}>
      {[...tasks].sort(byDue).map((task, index) => (
        <Group
          key={task.id}
          component="li"
          justify="space-between"
          gap="xs"
          py="sm"
          style={index > 0 ? { borderTop: "1px solid var(--mantine-color-gray-3)" } : undefined}
        >
          <Box miw={0}>
            <Anchor component={Link} to={`/tasks/${encodeURIComponent(task.id)}`} fw={600}>
              {recordTitle(task, stepOf(steps, task))}
            </Anchor>
            <Group gap={6}>
              <Text size="xs" c="dimmed">
                {task.name}
              </Text>
              <DelegatedBadge task={task} />
            </Group>
          </Box>
          <Group gap="sm">
            <DueBadge due={task.due} now={now} />
            {typeof task.variables.initiatorName === "string" && (
              <Text size="sm" c="dimmed">
                Người gửi: {task.variables.initiatorName}
              </Text>
            )}
          </Group>
        </Group>
      ))}
    </Box>
  );
}

/** Ô của một nhóm menu: tên nhóm là tiêu đề, mỗi mục là một lối tắt cùng nhãn và biểu tượng như trên thanh bên. */
export function PackageTile({ group }: { group: MenuGroup }) {
  const headingId = useId();
  return (
    <Paper component="section" withBorder radius="md" p="lg" aria-labelledby={headingId}>
      <Title order={2} size="h4" id={headingId}>
        {group.label}
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        {group.links.length} trang
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        {group.links.map((link) => (
          <Button
            key={link.to}
            component={Link}
            to={link.to}
            variant="default"
            justify="flex-start"
            h="auto"
            py="xs"
            leftSection={<MenuIconShape icon={link.icon} />}
            styles={{ label: { whiteSpace: "normal", textAlign: "left" } }}
          >
            {link.label}
          </Button>
        ))}
      </SimpleGrid>
    </Paper>
  );
}

function TasksSection() {
  const { getToken } = useSession();
  // Cùng khóa với TaskList: chuyển qua lại giữa trang chủ và "Việc của tôi" không tải lại danh sách.
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => fetchTasks(getToken()) });
  const { steps, error: stepsError } = useSteps();
  const headingId = useId();
  return (
    <Paper component="section" withBorder radius="md" p="lg" aria-labelledby={headingId}>
      <Group gap="sm" align="baseline" mb="xs">
        <Title order={2} size="h4" id={headingId}>
          Việc đang chờ bạn
        </Title>
        {tasks.data && (
          <Text size="sm" c="dimmed">
            {tasks.data.length} việc
          </Text>
        )}
        <Anchor component={Link} to="/tasks" size="sm" fw={600} ml="auto">
          Mở Việc của tôi
        </Anchor>
      </Group>
      {stepsError && (
        <Alert color="yellow" title="Không đọc được khai báo của bước" mb="xs">
          Liên kết tạm hiện tên bước thay cho tên hồ sơ. Tải lại trang; nếu vẫn lỗi, báo người quản trị.
        </Alert>
      )}
      {tasks.isPending ? (
        <Loading what="danh sách việc" />
      ) : tasks.isError ? (
        <ErrorNotice title="Không tải được danh sách việc" error={tasks.error} onRetry={() => tasks.refetch()} />
      ) : (
        <WaitingTasks tasks={tasks.data} steps={steps} now={Date.now()} />
      )}
    </Paper>
  );
}

export function Home() {
  const packages = usePackageMenu();
  const groups = homeGroups(packages.items);
  return (
    <Stack>
      <PageHeader title="Trang chủ" description="Việc đang chờ bạn và lối vào các gói của đơn vị." />
      <TasksSection />
      {/* Lỗi đọc menu đã báo ở cuối thanh bên; ở đây chỉ không có ô. */}
      {!packages.loaded && packages.fetching ? (
        <Loading what="menu của các gói" />
      ) : (
        groups.length > 0 && (
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {groups.map((group) => (
              <PackageTile key={group.id} group={group} />
            ))}
          </SimpleGrid>
        )
      )}
    </Stack>
  );
}
