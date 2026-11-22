// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thành phần trợ lý hỏi văn bản (ADR 0021): ô hỏi, câu hỏi mẫu, câu trả lời kèm câu trích nguyên văn, hay lời từ chối
// có lý do. Câu trích hiện đúng chữ lưu trong dữ liệu mà dịch vụ trả về, không phải chữ của mô hình; dưới câu trả lời
// là mô hình đã trả lời và nơi nó chạy. Thành phần chỉ biết cấu hình của nó và gói của mục menu (ADR 0013); không có
// chữ của một lĩnh vực nào.

import { Alert, Blockquote, Button, Group, Loader, Stack, Text, Textarea, Title } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { type Answer, type AssistantConfig, ask, configProblems, modelLine } from "./assistant";
import { useSession } from "./session";

type Props = { config: AssistantConfig; app: string };

export function Assistant({ config, app }: Props) {
  const { getToken } = useSession();
  const [question, setQuestion] = useState("");
  const asking = useMutation({ mutationFn: (text: string) => ask(getToken(), app, config, text) });
  const problems = configProblems(config);
  if (problems.length > 0) {
    return (
      <Alert color="red" title="Cấu hình trợ lý sai">
        {problems.join("; ")}.
      </Alert>
    );
  }
  const send = (text: string) => {
    if (text.trim() && !asking.isPending) asking.mutate(text.trim());
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(question);
  };
  return (
    <Stack>
      <Title order={1} size="h2">
        Hỏi văn bản
      </Title>
      <Text>{config.intro}</Text>
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
            <Button type="submit" disabled={!question.trim() || asking.isPending}>
              Hỏi
            </Button>
            {config.examples?.map((example) => (
              <Button
                key={example}
                variant="default"
                size="compact-sm"
                disabled={asking.isPending}
                onClick={() => {
                  setQuestion(example);
                  send(example);
                }}
              >
                {example}
              </Button>
            ))}
          </Group>
        </Stack>
      </form>
      {asking.isPending && (
        // Mô hình chạy trên CPU có thể mất hàng chục giây; nói rõ để người hỏi không bấm lại.
        <Group gap="xs">
          <Loader size="sm" aria-hidden />
          <Text>Đang tìm trong văn bản và trả lời; có thể mất một lúc.</Text>
        </Group>
      )}
      {asking.isError && (
        <Alert color="red" title="Chưa hỏi được">
          {asking.error.message}
        </Alert>
      )}
      {asking.data && <Result answer={asking.data} />}
    </Stack>
  );
}

/** Câu trả lời hay lời từ chối; tách ra để Assistant.test.tsx kiểm cách hiện câu trích. */
export function Result({ answer }: { answer: Answer }) {
  if (answer.outcome === "refused") {
    return (
      <Alert color="yellow" title="Trợ lý không trả lời">
        {answer.reason}
      </Alert>
    );
  }
  return (
    <Stack>
      <Text fw={500}>{answer.answer}</Text>
      {answer.model && (
        <Text size="sm" c="dimmed">
          {modelLine(answer.model)}
        </Text>
      )}
      <Title order={2} size="h4">
        Căn cứ
      </Title>
      {answer.citations.map((citation, index) => (
        // Hai câu trích có thể trùng mọi trường (một câu được dẫn hai lần), nên thứ tự là một phần của khóa; danh
        // sách hiện một lần cho mỗi câu trả lời, không đổi thứ tự.
        // biome-ignore lint/suspicious/noArrayIndexKey: các trường khác có thể trùng nhau, xem chú thích trên
        <Blockquote key={`${index}/${citation.document_id}/${citation.passage_id}/${citation.sentence}`} p="sm">
          <Text>{citation.sentence}</Text>
          <Text size="sm" c="dimmed" mt="xs">
            {citation.title}, {citation.label}
          </Text>
        </Blockquote>
      ))}
    </Stack>
  );
}
