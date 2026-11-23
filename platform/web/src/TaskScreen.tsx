// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Màn hình xử lý một việc: thông tin hồ sơ (gồm các biến mà bước khai ở details), biểu mẫu và các nút quyết định
// theo khai báo của bước (platform_workflow_steps, ghép với task theo process và step). Thông tin hồ sơ đứng trước
// biểu mẫu: bên trái trên màn hình rộng, bên trên trên màn hình hẹp. Bấm nút thì dữ liệu biểu mẫu cùng biến của nút
// được gửi khi hoàn thành task; workflow-api từ chối (ví dụ quy tắc bốn mắt) thì hiện lý do của nó.

import { Alert, Anchor, Button, Grid, Group, Loader, Paper, Stack, Table, Text, Title } from "@mantine/core";
import type Form from "@rjsf/core";
import { Form as MantineForm } from "@rjsf/mantine";
import type { RJSFSchema, UiSchema } from "@rjsf/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { formValidator } from "./formValidator";
import { useSession } from "./session";
import { dateTime, detailRows, recordTitle, stepOf, useSteps } from "./steps";
import { DelegatedBadge, DueBadge } from "./TaskList";
import { completeTask, fetchTasks, type StepConfig, type Task } from "./workflow";

// Biến lõi tự đặt (docs/api.md); không phải thông tin hồ sơ nên không hiện. initiatorName hiện thành "Người gửi".
// Biến mang tiền tố authority_ là vai trò lõi chọn từ bảng phân cấp thẩm quyền (ADR 0028).
const HIDDEN_VARIABLES = new Set(["initiator", "initiatorName", "tenant", "idempotencyKey"]);
const HIDDEN_PREFIX = "authority_";

// Ô nhập của Mantine đã tự hiện lỗi dưới ô; danh sách lỗi riêng của rjsf dưới mỗi trường sẽ lặp lại cùng lỗi đó.
const NoFieldErrorList = () => null;
const TEMPLATES = { FieldErrorTemplate: NoFieldErrorList };

// Nhãn của một biến: tiêu đề của trường cùng tên trong biểu mẫu của bước. Biến không có nhãn (biến kỹ thuật, quyết
// định của bước trước) không hiện, để người xử lý không phải đọc tên biến thô.
function labelOf(name: string, step: StepConfig | undefined): string | undefined {
  const field = (step?.form?.properties as Record<string, { title?: unknown }> | undefined)?.[name];
  return typeof field?.title === "string" ? field.title : undefined;
}

function Details({ task, step }: { task: Task; step: StepConfig | undefined }) {
  const declared = new Set((Array.isArray(step?.details) ? step.details : []).map((detail) => detail?.variable));
  // Khóa của dòng theo nguồn và tên biến, không theo nhãn: gói khai được hai nhãn trùng nhau (hay trùng "Hạn"), và
  // khóa trùng làm React vẽ nhầm dòng.
  const rows: [string, string, string][] = [
    ["core/initiatorName", "Người gửi", String(task.variables.initiatorName ?? "")],
    ["core/created", "Nhận lúc", dateTime.format(new Date(task.created))],
    ["core/due", "Hạn", task.due === null ? "Không đặt hạn" : dateTime.format(new Date(task.due))],
    ...detailRows(task, step).map(([name, label, value]): [string, string, string] => [
      `details/${name}`,
      label,
      value,
    ]),
    ...Object.entries(task.variables).flatMap(([name, value]): [string, string, string][] => {
      const label = labelOf(name, step);
      // Tên hồ sơ đã là tiêu đề màn hình; biến khai ở details đã hiện ở trên.
      if (
        label === undefined ||
        HIDDEN_VARIABLES.has(name) ||
        name.startsWith(HIDDEN_PREFIX) ||
        name === step?.title ||
        declared.has(name)
      )
        return [];
      return [[`variable/${name}`, label, typeof value === "string" ? value : JSON.stringify(value)]];
    }),
  ];
  return (
    <Table variant="vertical" layout="fixed">
      <Table.Tbody>
        {rows.map(([key, label, value]) => (
          <Table.Tr key={key}>
            <Table.Th w={120}>{label}</Table.Th>
            <Table.Td style={{ overflowWrap: "anywhere" }}>{value}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function Decision({ task, step }: { task: Task; step: StepConfig }) {
  const { getToken } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useRef<Form>(null);
  // Nút vừa bấm; rjsf gọi onSubmit với dữ liệu đã kiểm (gồm cả giá trị mặc định của schema) chứ không nhận tham số.
  const chosen = useRef<StepConfig["actions"][number] | null>(null);
  const complete = useMutation({
    mutationFn: ({ variables }: { action: string; variables: Record<string, unknown> }) =>
      completeTask(getToken(), task.id, variables),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      navigate("/tasks", { state: { done: recordTitle(task, step) } });
    },
  });

  // Biến của nút đặt sau dữ liệu biểu mẫu: một trường biểu mẫu không đổi được quyết định của nút.
  const send = (action: StepConfig["actions"][number], formData: Record<string, unknown>) =>
    complete.mutate({ action: action.id, variables: { ...formData, ...action.variables } });

  const decide = (action: StepConfig["actions"][number]) => {
    if (!form.current) return send(action, {});
    // rjsf kiểm dữ liệu; sai thì hiện lỗi cạnh ô nhập và không gọi onSubmit.
    chosen.current = action;
    form.current.submit();
  };

  return (
    <Stack>
      {step.form && (
        <MantineForm
          ref={form}
          schema={step.form as RJSFSchema}
          uiSchema={{ ...(step.ui as UiSchema), "ui:submitButtonOptions": { norender: true } }}
          validator={formValidator}
          onSubmit={(event) => chosen.current && send(chosen.current, event.formData ?? {})}
          showErrorList={false}
          templates={TEMPLATES}
          noHtml5Validate
        />
      )}
      {complete.isError && (
        <Alert color="red" title="Không gửi được">
          {complete.error.message}
        </Alert>
      )}
      <Group>
        {step.actions.map((action, index) => (
          <Button
            key={action.id}
            variant={index === 0 ? "filled" : "default"}
            loading={complete.isPending && complete.variables?.action === action.id}
            disabled={complete.isPending}
            onClick={() => decide(action)}
          >
            {action.label}
          </Button>
        ))}
      </Group>
    </Stack>
  );
}

function StepPanel({
  task,
  step,
  fetching,
  error,
}: {
  task: Task;
  step?: StepConfig;
  fetching: boolean;
  error?: Error;
}) {
  if (fetching) return <Loader aria-label="Đang tải khai báo của bước" />;
  if (error) {
    return (
      <Alert color="red" title="Không đọc được khai báo của bước">
        {error.message}. Tải lại trang; nếu vẫn lỗi, báo người quản trị.
      </Alert>
    );
  }
  // Khai báo đọc qua GraphQL không được kiểm lại lúc chạy; thiếu nút thì coi như chưa khai, thay vì để màn hình lỗi.
  if (!step || !Array.isArray(step.actions)) {
    return (
      <Alert color="yellow" title="Bước này chưa có khai báo">
        Quy trình {task.process}, bước {task.step} chưa có biểu mẫu và nút xử lý. Báo người quản trị cài lại gói của quy
        trình này.
      </Alert>
    );
  }
  return <Decision task={task} step={step} />;
}

export function TaskScreen() {
  const { taskId } = useParams();
  const { getToken } = useSession();
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => fetchTasks(getToken()) });
  const { steps, fetching, error } = useSteps();

  if (tasks.isPending) return <Loader aria-label="Đang tải việc" />;
  if (tasks.isError) {
    return (
      <Alert color="red" title="Không tải được việc">
        {tasks.error.message}
      </Alert>
    );
  }
  const task = tasks.data.find((candidate) => candidate.id === taskId);
  if (!task) {
    return (
      <Paper withBorder radius="md" p="xl" maw={560}>
        <Stack align="flex-start">
          <Title order={1} size="h3">
            Việc này không còn chờ bạn
          </Title>
          <Text c="dimmed">Việc đã được xử lý, đã giao cho người khác, hoặc đường dẫn sai.</Text>
          <Button component={Link} to="/tasks" variant="light">
            Về việc của tôi
          </Button>
        </Stack>
      </Paper>
    );
  }
  const step = stepOf(steps, task);
  return (
    <Stack>
      <Anchor component={Link} to="/tasks" size="sm">
        Việc của tôi
      </Anchor>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={1} size="h2">
            {recordTitle(task, step)}
          </Title>
          <Group gap={6}>
            <Text c="dimmed" size="sm">
              {task.name}
            </Text>
            <DelegatedBadge task={task} />
          </Group>
        </div>
        <DueBadge due={task.due} now={Date.now()} />
      </Group>
      <Grid gap="md">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Paper withBorder radius="md" p="md">
            <Title order={2} size="h5" mb="xs">
              Thông tin hồ sơ
            </Title>
            <Details task={task} step={step} />
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Paper withBorder radius="md" p="md">
            <Title order={2} size="h5" mb="xs">
              Xử lý
            </Title>
            {/* key theo task: chuyển sang việc khác bằng nút lùi của trình duyệt thì biểu mẫu và lỗi của việc trước không sót lại. */}
            <StepPanel key={task.id} task={task} step={step} fetching={fetching} error={error} />
          </Paper>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
