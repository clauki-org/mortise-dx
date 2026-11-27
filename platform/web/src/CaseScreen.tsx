// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Màn hình một hồ sơ của thành phần theo dõi hồ sơ (ADR 0032), ở /apps/<gói>/<mục>/<mã hồ sơ>: thông tin theo
// `details` của các bước, các bước đã qua và đang chờ theo thời gian, kết quả. workflow-api trả 404 như nhau cho hồ sơ
// không có, của đơn vị khác hay của người khác, nên màn hình cũng chỉ có một câu không tìm thấy.

import { Alert, Anchor, Badge, Group, Paper, Stack, Table, Text, Timeline, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ApiError } from "./api";
import {
  type CaseDetail,
  type CaseStep,
  caseDetails,
  caseStatus,
  caseTitle,
  fetchCase,
  groupLabel,
  processSteps,
} from "./cases";
import { ErrorNotice, Loading } from "./States";
import { useSession } from "./session";
import { dateTime, useSteps } from "./steps";
import { DueBadge } from "./TaskList";

const STATUS: Record<CaseStep["status"], string> = {
  open: "Đang chờ",
  done: "Đã xong",
  cancelled: "Dừng, không ai hoàn thành",
};

function StepItem({ step }: { step: CaseStep }) {
  const time = (value: string) => dateTime.format(new Date(value));
  return (
    <Stack gap={4}>
      <Text size="sm" c="dimmed">
        {STATUS[step.status]} · {time(step.started)}
        {step.ended && ` – ${time(step.ended)}`}
      </Text>
      {step.groups.length > 0 && <Text size="sm">Người xử lý: {step.groups.map(groupLabel).join("; ")}</Text>}
      {step.status === "open" && step.kind === "task" && (
        <Group gap="xs">
          <DueBadge due={step.due} now={Date.now()} />
          <Text size="sm">{step.claimed ? "Đã có người nhận" : "Chưa có người nhận"}</Text>
        </Group>
      )}
    </Stack>
  );
}

function Body({ found }: { found: CaseDetail }) {
  const { steps } = useSteps();
  const declared = processSteps(steps, found.process);
  const rows: [string, string, string][] = [
    ["core/started", "Lập lúc", dateTime.format(new Date(found.started))],
    ["core/status", found.ended === null ? "Đang ở bước" : "Kết quả", caseStatus(found)],
    ...caseDetails(found, declared).map(([name, label, value]): [string, string, string] => [
      `details/${name}`,
      label,
      value,
    ]),
  ];
  const open = found.steps.findIndex((step) => step.status === "open");
  return (
    <>
      <Title order={1} size="h2">
        {caseTitle(found, declared) ?? `Hồ sơ ${found.id.slice(0, 8)}`}
      </Title>
      <Paper withBorder radius="md" p="md">
        <Table variant="vertical" layout="fixed">
          <Table.Tbody>
            {rows.map(([key, label, value]) => (
              <Table.Tr key={key}>
                <Table.Th w={160}>{label}</Table.Th>
                <Table.Td style={{ overflowWrap: "anywhere" }}>{value}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      <Paper withBorder radius="md" p="md">
        <Title order={2} size="h5" mb="sm">
          Các bước
        </Title>
        <Timeline active={open < 0 ? found.steps.length - 1 : open} bulletSize={16} lineWidth={2}>
          {found.steps.map((step) => (
            <Timeline.Item key={`${step.step}/${step.started}`} title={step.name}>
              <StepItem step={step} />
            </Timeline.Item>
          ))}
          {found.ended !== null && (
            <Timeline.Item title={found.outcomeName ?? "Đã dừng"}>
              <Badge variant="light" color={found.outcome === null ? "gray" : "green"} tt="none">
                Kết thúc {dateTime.format(new Date(found.ended))}
              </Badge>
            </Timeline.Item>
          )}
        </Timeline>
      </Paper>
    </>
  );
}

export function CaseScreen({ id, basePath, title }: { id: string; basePath: string; title: string }) {
  const { getToken } = useSession();
  const found = useQuery({ queryKey: ["case", id], queryFn: () => fetchCase(getToken(), id) });
  return (
    <Stack maw={880}>
      <Anchor component={Link} to={basePath} size="sm">
        {title}
      </Anchor>
      {found.isPending && <Loading what="hồ sơ" />}
      {found.isError &&
        (found.error instanceof ApiError && found.error.status === 404 ? (
          <Alert color="yellow" title="Không tìm thấy hồ sơ">
            Hồ sơ không có, hoặc không phải hồ sơ bạn đã lập.
          </Alert>
        ) : (
          <ErrorNotice title="Không tải được hồ sơ" error={found.error} onRetry={() => found.refetch()} />
        ))}
      {found.data && <Body found={found.data} />}
    </Stack>
  );
}
