// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thành phần trợ lý hỏi dữ liệu (ADR 0027, ADR 0034): câu mẫu của gói hiện thành nút, bấm là chạy câu truy vấn viết
// sẵn qua /v1/assistant/data-queries; câu gõ vào ô hỏi đi qua /v1/assistant/data-questions, nơi mô hình viết câu truy
// vấn. Cả hai cho kết quả là bảng do giao diện vẽ, kèm đúng câu truy vấn đã chạy; mô hình không viết chữ nào trong
// bảng. Mỗi ô hiện như chữ
// thường: dữ liệu do người dùng nhập (tên một bản ghi, ghi chú) không bao giờ được hiểu là định dạng hay lệnh. Thành phần
// chỉ biết cấu hình của nó, gói và mục menu (ADR 0013); không có chữ của một lĩnh vực nào.

import { Alert, Button, Code, Group, Loader, ScrollArea, Stack, Table, Text, Textarea, Title } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  askData,
  type Cell,
  configProblems,
  type DataAnswer,
  type DataAssistantConfig,
  type DataExample,
  type DataTable,
  type ModelInfo,
  queryModelLine,
  runDataQuery,
} from "./assistant";
import { useSession } from "./session";

type Props = { config: DataAssistantConfig; app: string; item: string };
// Câu mẫu chạy câu viết sẵn; câu gõ tự do để mô hình viết câu. Một kết quả trên màn hình cho cả hai.
type Asked = { example: DataExample } | { question: string };

export function AssistantData({ config, app, item }: Props) {
  const { getToken } = useSession();
  const [question, setQuestion] = useState("");
  const running = useMutation({
    mutationFn: (asked: Asked) =>
      "example" in asked
        ? runDataQuery(getToken(), app, item, asked.example)
        : askData(getToken(), app, item, asked.question),
  });
  const problems = configProblems(config);
  if (problems.length > 0) {
    return (
      <Alert color="red" title="Cấu hình trợ lý sai">
        {problems.join("; ")}.
      </Alert>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (question.trim() && !running.isPending) running.mutate({ question: question.trim() });
  };
  const writing = running.variables !== undefined && "question" in running.variables;
  return (
    <Stack>
      <Title order={1} size="h2">
        Hỏi dữ liệu
      </Title>
      <Text>{config.intro}</Text>
      <Text size="sm" c="dimmed">
        Kết quả chỉ gồm dữ liệu mà tài khoản đang hỏi được quyền xem.
      </Text>
      <form onSubmit={submit}>
        <Stack gap="xs">
          <Textarea
            label="Câu hỏi"
            value={question}
            onChange={(event) => setQuestion(event.currentTarget.value)}
            autosize
            minRows={2}
          />
          <Group>
            <Button type="submit" disabled={!question.trim() || running.isPending}>
              Hỏi
            </Button>
            {config.data.examples.map((example) => (
              <Button
                key={example.id}
                variant="default"
                size="compact-sm"
                disabled={running.isPending}
                onClick={() => running.mutate({ example })}
              >
                {example.question}
              </Button>
            ))}
          </Group>
        </Stack>
      </form>
      {running.isPending && (
        // Mô hình có thể mất hàng chục giây để viết câu; nói rõ để người hỏi không bấm lại.
        <Group gap="xs">
          <Loader size="sm" aria-hidden />
          <Text>{writing ? "Mô hình đang viết câu truy vấn; có thể mất một lúc." : "Đang chạy câu truy vấn."}</Text>
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

// Lời từ chối theo bước đã từ chối câu hỏi gõ tự do: chữ cố định của giao diện, không phải chữ của mô hình.
const REFUSED: Record<NonNullable<DataAnswer["refused_by"]>, string> = {
  model:
    "Mô hình không viết câu truy vấn cho câu hỏi này: câu hỏi nằm ngoài các bảng của mục, hỏi dữ liệu của đơn vị " +
    "khác hay đòi sửa dữ liệu. Không câu nào được chạy.",
  guard: "Câu truy vấn mô hình viết không qua bước kiểm (guard) nên không được chạy.",
  hasura: "API dữ liệu từ chối câu truy vấn đã qua bước kiểm; không có dữ liệu nào được trả.",
};

/** Bảng kết quả hay lời từ chối, luôn kèm câu truy vấn; tách ra để AssistantData.test.tsx kiểm cách hiện. */
export function DataResult({ answer }: { answer: DataAnswer }) {
  return (
    <Stack>
      {answer.outcome === "refused" ? (
        <Refusal answer={answer} />
      ) : (
        answer.tables.map((table, index) => (
          // Hai bảng có thể cùng tiêu đề (tổng hợp và danh sách của cùng một nguồn); thứ tự không đổi.
          // biome-ignore lint/suspicious/noArrayIndexKey: tiêu đề có thể trùng, xem chú thích trên
          <ResultTable key={`${index}/${table.title}`} table={table} />
        ))
      )}
      {answer.model && <WrittenBy model={answer.model} answer={answer} />}
      {answer.query !== "" && (
        <>
          <Title order={2} size="h4">
            {answer.outcome === "refused" ? "Câu truy vấn bị từ chối" : "Câu truy vấn đã chạy"}
          </Title>
          <Code block>{answer.query}</Code>
        </>
      )}
    </Stack>
  );
}

function Refusal({ answer }: { answer: DataAnswer }) {
  // Câu mẫu không có refused_by: lý do của guard hay của dịch vụ hiện nguyên như trước.
  if (answer.refused_by === null) {
    return (
      <Alert color="yellow" title="Trợ lý không chạy câu này">
        {answer.reason}
      </Alert>
    );
  }
  return (
    <Alert color="yellow" title="Trợ lý không chạy câu này">
      <Text size="sm">{REFUSED[answer.refused_by]}</Text>
      {/* Lý do của guard nêu phần tử vi phạm trong câu hiện bên dưới; chữ của dịch vụ, không của mô hình. */}
      {answer.refused_by === "guard" && answer.reason && (
        <Text size="sm" mt="xs">
          {answer.reason}
        </Text>
      )}
    </Alert>
  );
}

function WrittenBy({ model, answer }: { model: ModelInfo; answer: DataAnswer }) {
  return (
    <Stack gap={4}>
      <Text size="sm" c="dimmed">
        {queryModelLine(model)}
        {answer.attempts === 2 && "; guard từ chối câu đầu, mô hình đã viết lại một lần"}.
      </Text>
      {answer.outcome === "data" && (
        <Text size="sm" c="dimmed">
          Đọc câu truy vấn đã chạy bên dưới để chắc nó hỏi đúng điều bạn hỏi: câu đã qua guard vẫn có thể hiểu sai câu
          hỏi.
        </Text>
      )}
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
