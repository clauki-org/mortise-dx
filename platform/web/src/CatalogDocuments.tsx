// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần tài liệu đính kèm trên màn hình chi tiết của danh mục (detail.documents, ADR 0041). Dòng nối đọc qua GraphQL
// nên Hasura quyết định ai thấy tệp nào; tên, cỡ của tệp đọc từ /v1/files/{id}; tải xuống và tải lên qua api.ts.
// CatalogRecord.tsx vẽ phần này dưới bảng trường của dòng đang xem, chỉ đưa cấu hình và khóa của dòng.

import { Alert, Button, FileInput, Group, Paper, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { useClient, useQuery } from "urql";
import { ApiError, callApi, downloadFile, uploadFile } from "./api";
import { display, type Row } from "./catalog";
import {
  type DocumentsConfig,
  type FileInfo,
  formatSize,
  insertMutation,
  limitOf,
  linkError,
  linkObject,
  listQuery,
  listVariables,
  uploadError,
  uploadRole,
} from "./documents";
import { rolesOf } from "./menu";
import { useSession } from "./session";

type Props = { config: DocumentsConfig; recordKey: unknown };

/** Ô tải xuống của một dòng: tên tệp lấy từ /v1/files, tệp không đọc được (404) vẫn hiện thành một dòng báo. */
function FileCell({ info, failed, id }: { info?: FileInfo; failed: boolean; id: string }) {
  const { getToken } = useSession();
  const download = useMutation({
    mutationFn: (file: FileInfo) => downloadFile(getToken(), file.id, file.name),
  });
  if (failed) return <Text c="dimmed">Không đọc được tệp {id} (đã bị xóa hoặc thuộc đơn vị khác)</Text>;
  if (!info) return <Text c="dimmed">Đang tải thông tin tệp…</Text>;
  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Button variant="subtle" size="compact-sm" onClick={() => download.mutate(info)} loading={download.isPending}>
          {info.name}
        </Button>
        <Text size="sm" c="dimmed">
          {formatSize(info.size)}, {info.contentType}
        </Text>
      </Group>
      {download.error && (
        <Text size="sm" c="red">
          Không tải được tệp: {download.error.message}. Thử lại; nếu vẫn lỗi, báo người quản trị.
        </Text>
      )}
    </Stack>
  );
}

/** Ô chọn tệp và nút đính kèm: tải tệp lên /v1/files rồi thêm dòng nối; xong thì gọi onDone để đọc lại danh sách. */
function Upload({ config, recordKey, onDone }: Props & { onDone: () => void }) {
  const { getToken } = useSession();
  const client = useClient();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const attach = useMutation({
    mutationFn: async (chosen: File) => {
      let stored: FileInfo;
      try {
        stored = await uploadFile<FileInfo>(getToken(), chosen);
      } catch (error) {
        throw new Error(error instanceof ApiError ? uploadError(error.status, error.message) : String(error));
      }
      const context = { role: uploadRole(config), additionalTypenames: [config.source] };
      const object = linkObject(config, recordKey, stored.id, note);
      const result = await client.mutation(insertMutation(config), { object }, context).toPromise();
      if (result.error) throw new Error(linkError(result.error));
      return stored.name;
    },
    onSuccess: (name) => {
      setDone(name);
      setFile(null);
      setNote("");
      onDone();
    },
  });
  if (!rolesOf(getToken()).includes(uploadRole(config))) return null;
  return (
    <Stack gap="xs">
      <Group align="flex-end">
        <FileInput
          label="Chọn tệp"
          placeholder="Chưa chọn tệp"
          value={file}
          onChange={(chosen) => {
            setFile(chosen);
            setDone(null);
            attach.reset();
          }}
          clearable
          w={320}
        />
        {config.upload?.note && (
          <TextInput label="Ghi chú" value={note} onChange={(event) => setNote(event.currentTarget.value)} w={320} />
        )}
        <Button onClick={() => file && attach.mutate(file)} disabled={!file} loading={attach.isPending}>
          {config.upload?.label ?? "Đính kèm"}
        </Button>
      </Group>
      {attach.error && (
        <Alert color="red" title="Chưa đính kèm được tệp">
          {attach.error.message}
        </Alert>
      )}
      {done && (
        <Alert
          color="green"
          title="Đã đính kèm"
          withCloseButton
          closeButtonLabel="Đóng thông báo"
          onClose={() => setDone(null)}
        >
          Tệp {done} đã được gắn vào dòng này.
        </Alert>
      )}
    </Stack>
  );
}

export function CatalogDocuments({ config, recordKey }: Props) {
  const { getToken } = useSession();
  const [{ data, fetching, error }, reload] = useQuery<{ rows: Row[] }>({
    query: listQuery(config),
    variables: listVariables(config, recordKey),
    requestPolicy: "cache-and-network",
  });
  const rows = data?.rows ?? [];
  // Một tệp gắn hai lần vào cùng dòng (bảng nối không có UNIQUE) vẫn là một tệp; hiện một lần để mã tệp làm khóa.
  const shown = rows
    .filter((row, index) => rows.findIndex((other) => other[config.file] === row[config.file]) === index)
    .slice(0, limitOf(config));
  const ids = shown.map((row) => String(row[config.file] ?? ""));
  const files = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["file", id],
      queryFn: () => callApi<FileInfo>(`/v1/files/${encodeURIComponent(id)}`, getToken()),
      // Tệp không đọc được (404) sẽ vẫn 404; thử lại chỉ tốn lượt gọi trong giới hạn tần suất của cổng.
      retry: false,
      staleTime: 5 * 60_000,
    })),
  });
  const fields = config.fields ?? [];

  return (
    <Stack gap="xs">
      <Title order={2} size="h4">
        {config.title}
      </Title>
      {error && (
        <Alert color="red" title="Không tải được danh sách tệp">
          {error.message}. Tải lại trang; nếu vẫn lỗi, báo người quản trị kiểm cấu hình và quyền của bảng nối.
        </Alert>
      )}
      {!error && !fetching && shown.length === 0 && <Text c="dimmed">Chưa có tệp nào.</Text>}
      {shown.length > 0 && (
        <Paper withBorder radius="md">
          <Table verticalSpacing="sm" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tệp</Table.Th>
                {fields.map((field) => (
                  <Table.Th key={field.name}>{field.label}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((row, index) => (
                <Table.Tr key={ids[index]}>
                  <Table.Td>
                    <FileCell info={files[index]?.data} failed={files[index]?.isError ?? false} id={ids[index] ?? ""} />
                  </Table.Td>
                  {fields.map((field) => (
                    <Table.Td key={field.name}>{display(field, row[field.name])}</Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
      {rows.length > shown.length && (
        <Text size="sm" c="dimmed">
          Chỉ hiện {shown.length} tệp đầu theo thứ tự đã khai.
        </Text>
      )}
      {/* Đọc lại từ máy chủ: urql không tự làm mới danh sách đang rỗng sau khi thêm dòng, vì kết quả rỗng không mang
          kiểu của bảng để đối chiếu với lệnh thêm. */}
      {config.upload && (
        <Upload config={config} recordKey={recordKey} onDone={() => reload({ requestPolicy: "network-only" })} />
      )}
    </Stack>
  );
}
