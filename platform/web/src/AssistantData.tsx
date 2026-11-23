// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thành phần trợ lý hỏi dữ liệu (ADR 0027): câu mẫu của gói hiện thành nút, bấm là chạy câu truy vấn viết sẵn qua
// /v1/assistant/data-queries; kết quả là bảng do giao diện vẽ, kèm đúng câu truy vấn đã chạy. Mỗi ô hiện như chữ
// thường: dữ liệu do người dùng nhập (tên cơ sở, ghi chú) không bao giờ được hiểu là định dạng hay lệnh. Thành phần
// chỉ biết cấu hình của nó, gói và mục menu (ADR 0013); không có chữ của một lĩnh vực nào.

import { Alert, Button, Code, Group, Loader, ScrollArea, Stack, Table, Text, Title } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import {
  type Cell,
  configProblems,
  type DataAnswer,
  type DataAssistantConfig,
  type DataExample,
  type DataTable,
  runDataQuery,
} from "./assistant";
import { useSession } from "./session";

type Props = { config: DataAssistantConfig; app: string; item: string };

export function AssistantData({ config, app, item }: Props) {
  const { getToken } = useSession();
  const running = useMutation({ mutationFn: (example: DataExample) => runDataQuery(getToken(), app, item, example) });
  const problems = configProblems(config);
  if (problems.length > 0) {
    return (
      <Alert color="red" title="Cấu hình trợ lý sai">
        {problems.join("; ")}.
      </Alert>
    );
  }
  return (
    <Stack>
      <Title order={1} size="h2">
        Hỏi dữ liệu
      </Title>
      <Text>{config.intro}</Text>
      <Text size="sm" c="dimmed">
        Kết quả chỉ gồm dữ liệu mà tài khoản đang hỏi được quyền xem.
      </Text>
      <Group>
        {config.data.examples.map((example) => (
          <Button
            key={example.id}
            variant="default"
            disabled={running.isPending}
            onClick={() => running.mutate(example)}
          >
            {example.question}
          </Button>
        ))}
      </Group>
      {running.isPending && (
        <Group gap="xs">
          <Loader size="sm" aria-hidden />
          <Text>Đang chạy câu truy vấn.</Text>
        </Group>
      )}
      {running.isError && (
        <Alert color="red" title="Chưa chạy được">
          {running.error.message}
        </Alert>
      )}
      {running.data && <DataResult answer={running.data} />}
    </Stack>
  );
}

/** Bảng kết quả hay lời từ chối, luôn kèm câu truy vấn; tách ra để AssistantData.test.tsx kiểm cách hiện. */
export function DataResult({ answer }: { answer: DataAnswer }) {
  return (
    <Stack>
      {answer.outcome === "refused" ? (
        <Alert color="yellow" title="Trợ lý không chạy câu này">
          {answer.reason}
        </Alert>
      ) : (
        answer.tables.map((table, index) => (
          // Hai bảng có thể cùng tiêu đề (tổng hợp và danh sách của cùng một nguồn); thứ tự không đổi.
          // biome-ignore lint/suspicious/noArrayIndexKey: tiêu đề có thể trùng, xem chú thích trên
          <ResultTable key={`${index}/${table.title}`} table={table} />
        ))
      )}
      <Title order={2} size="h4">
        {answer.outcome === "refused" ? "Câu truy vấn bị từ chối" : "Câu truy vấn đã chạy"}
      </Title>
      <Code block>{answer.query}</Code>
    </Stack>
  );
}

function ResultTable({ table }: { table: DataTable }) {
  return (
    <Stack gap="xs">
      <Title order={2} size="h4">
        {table.title}
      </Title>
      {table.rows.length === 0 ? (
        <Text>Không có dòng nào trong phạm vi quyền của tài khoản này.</Text>
      ) : (
        <ScrollArea>
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                {table.columns.map((column) => (
                  <Table.Th key={column.key}>{column.label}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {table.rows.map((row, index) => (
                // Dòng không có khóa riêng (cột do câu truy vấn chọn); danh sách vẽ một lần cho mỗi kết quả.
                // biome-ignore lint/suspicious/noArrayIndexKey: dòng không có khóa ổn định, xem chú thích trên
                <Table.Tr key={index}>
                  {table.columns.map((column) => (
                    <Table.Td key={column.key}>{text(row[column.key])}</Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Stack>
  );
}

// React thoát chữ khi vẽ, nên ô chứa thẻ HTML hay lời "bỏ qua quy tắc" hiện đúng như chữ đã nhập.
const text = (value: Cell | undefined) => (value === null || value === undefined ? "" : String(value));
