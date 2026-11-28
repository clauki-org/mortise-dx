// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kết quả của một lần soạn bản nháp cấu hình gói (ADR 0071): kết luận của bước kiểm, lỗi còn lại, tệp còn phải viết,
// lập luận chọn component của từng mục và nội dung từng tệp kèm nút tải về. Mọi chữ của mô hình (YAML, câu giải
// thích) hiện như chữ thường; câu giải thích ghi rõ là chưa kiểm, vì dịch vụ chỉ kiểm được đoạn nhu cầu và câu công
// dụng. PackageDraftPage.tsx gọi; tách ra để PackageDraftResult.test.tsx dựng mà không cần trình duyệt.

import { Alert, Badge, Blockquote, Button, Code, Group, List, Paper, Stack, Text, Title } from "@mantine/core";
import { download } from "./CatalogExport";
import {
  type DraftArgument,
  type DraftChoice,
  type DraftFile,
  type DraftProblem,
  downloadName,
  draftModelLine,
  type PackageDraft,
} from "./packageDraft";

export function PackageDraftResult({ draft }: { draft: PackageDraft }) {
  const modelLine = (
    <Text size="sm" c="dimmed">
      {draftModelLine(draft)}
    </Text>
  );
  if (draft.outcome === "refused") {
    return (
      <Stack>
        <Alert color="yellow" title="Trợ lý không soạn bản nháp cho nhu cầu này">
          {draft.reason}
        </Alert>
        {modelLine}
      </Stack>
    );
  }
  return (
    <Stack gap="lg">
      <Verdict draft={draft} />
      {modelLine}
      {draft.problems.length > 0 && <Problems title="Lỗi còn lại" problems={draft.problems} />}
      {draft.to_write.length > 0 && <Problems title="Tệp còn phải viết trước khi cài" problems={draft.to_write} />}
      {draft.choices.length > 0 && <Choices choices={draft.choices} />}
      <Files files={draft.files} />
    </Stack>
  );
}

// Qua bước kiểm vẫn chưa cài được: bản nháp không có migration, quyền Hasura, BPMN (ADR 0071). Nói ngay trong kết luận
// để không ai đặt tệp vào apps/ rồi chạy make app-install và nhận lỗi khó hiểu.
const NEXT_STEPS =
  "Đặt các tệp vào apps/<gói>/, viết thêm migration, quyền Hasura và các tệp còn thiếu, rồi chạy make check-fast " +
  "và make app-install.";

function Verdict({ draft }: { draft: PackageDraft }) {
  const passed = draft.outcome === "drafted";
  return (
    <Alert
      color={passed ? "green" : "red"}
      title={passed ? "Bản nháp qua bước kiểm theo hợp đồng" : "Bản nháp còn lỗi"}
    >
      <Text size="sm">
        {passed
          ? "Bước kiểm chỉ xét đúng hợp đồng, không xét bản nháp có đủ mọi việc của nhu cầu hay không."
          : draft.reason}
      </Text>
      <Text size="sm" mt="xs">
        {NEXT_STEPS}
      </Text>
    </Alert>
  );
}

function Problems({ title, problems }: { title: string; problems: DraftProblem[] }) {
  return (
    <Stack gap="xs">
      <Title order={2} size="h4">
        {title}
      </Title>
      <List size="sm" spacing={4}>
        {problems.map((problem) => (
          <List.Item key={`${problem.path}/${problem.message}`}>
            <Code>{problem.path}</Code>: {problem.message}
          </List.Item>
        ))}
      </List>
    </Stack>
  );
}

function Choices({ choices }: { choices: DraftChoice[] }) {
  return (
    <Stack gap="sm">
      <Title order={2} size="h4">
        Vì sao chọn các component
      </Title>
      {choices.map((choice) => (
        <ChoiceCard key={choice.item} choice={choice} />
      ))}
    </Stack>
  );
}

function ChoiceCard({ choice }: { choice: DraftChoice }) {
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="xs">
        <Text fw={600}>
          Mục <Code>{choice.item}</Code> dùng <Code>{choice.component}</Code>
        </Text>
        {choice.arguments.length === 0 && (
          <Text size="sm" c="dimmed">
            Không có lập luận nào qua bước kiểm cho mục này.
          </Text>
        )}
        {choice.arguments.map((argument) => (
          <Argument key={`${argument.need}/${argument.capability}`} argument={argument} />
        ))}
      </Stack>
    </Paper>
  );
}

function Argument({ argument }: { argument: DraftArgument }) {
  return (
    <Stack gap={4}>
      <Blockquote p="xs" cite="Đoạn trong nhu cầu">
        {argument.need}
      </Blockquote>
      <Text size="sm">
        <Text span fw={600}>
          Công dụng (chép từ contracts/):{" "}
        </Text>
        {argument.capability}
      </Text>
      <Text size="sm">
        <Text span fw={600}>
          Giải thích của mô hình, chưa kiểm:{" "}
        </Text>
        {argument.why}
      </Text>
    </Stack>
  );
}

function Files({ files }: { files: DraftFile[] }) {
  return (
    <Stack gap="sm">
      <Title order={2} size="h4">
        Các tệp của bản nháp
      </Title>
      {files.map((file) => (
        <FileCard key={file.path} file={file} />
      ))}
    </Stack>
  );
}

function FileCard({ file }: { file: DraftFile }) {
  const save = () => download(new Blob([file.content], { type: "application/yaml" }), downloadName(file.path));
  return (
    <Paper component="section" withBorder radius="md" p="md" aria-label={file.path}>
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Group gap="xs" miw={0}>
            <Code>{file.path}</Code>
            {file.component && <Badge variant="light">{file.component}</Badge>}
          </Group>
          <Button variant="default" size="compact-sm" aria-label={`Tải tệp ${file.path}`} onClick={save}>
            Tải tệp
          </Button>
        </Group>
        <Code block>{file.content}</Code>
      </Stack>
    </Paper>
  );
}
