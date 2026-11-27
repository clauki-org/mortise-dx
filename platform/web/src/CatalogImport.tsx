// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Nút "nạp từ tệp" của bảng đối tượng con trong danh mục (import của đối tượng con, ADR 0064): hộp thoại có tệp mẫu
// .xlsx, ô chọn tệp .xlsx hay CSV, phần xem trước báo lỗi theo dòng và cột (CatalogImportPreview.tsx), rồi một lệnh
// thêm mọi dòng bằng token người dùng với vai trò của biểu mẫu. CatalogRecord.tsx đặt nút cạnh nút thêm dòng con; xong
// thì gọi onSaved để bảng con đọc lại. Đọc tệp, kiểm dòng ở catalogImport.ts và catalogImportFile.ts.

import { Alert, Button, FileInput, Group, Modal, Stack, Text } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useClient } from "urql";
import { download } from "./CatalogExport";
import { CatalogImportPreview } from "./CatalogImportPreview";
import type { Import } from "./catalog";
import {
  checkSheet,
  existingQuery,
  hasErrors,
  type ImportSheet,
  importObjects,
  insertManyMutation,
  markDuplicates,
  markExisting,
} from "./catalogImport";
import { readGrid } from "./catalogImportFile";
import { templateBlob } from "./catalogImportTemplate";
import { ReadableError } from "./errorText";
import { formRole, type Values } from "./formConfig";
import { insertError } from "./formInsert";
import { rolesOf } from "./menu";
import { ErrorNotice, Loading } from "./States";
import { useSession } from "./session";

type Props = { id: string; config: Import; table: string; via: string; parentKey: unknown; onSaved: () => void };

function useCheckFile({ config, table, via, parentKey }: Omit<Props, "onSaved" | "id">) {
  const client = useClient();
  const role = formRole(config.form);
  return useMutation({
    mutationFn: async (file: File): Promise<ImportSheet> => {
      const sheet = checkSheet(config.form, await readGrid(file), config.max_rows);
      const unique = config.unique;
      if (!unique || sheet.problems.length > 0) return sheet;
      const rows = markDuplicates(sheet.rows, unique);
      // Đọc lại dòng đã có lúc chọn tệp, bằng vai trò sẽ ghi: lời báo trùng phải đúng với chính lệnh sẽ gửi.
      const { query, variables } = existingQuery(table, via, unique, parentKey, rows);
      const result = await client
        .query<{ rows: Values[] }>(query, variables, { role, requestPolicy: "network-only" })
        .toPromise();
      if (result.error || !result.data) {
        throw new ReadableError(
          "Không đọc được danh sách hiện tại để kiểm trùng. Chọn lại tệp; nếu vẫn lỗi, báo người quản trị.",
        );
      }
      return {
        problems: [],
        rows: markExisting(
          rows,
          unique,
          result.data.rows.map((row) => row[unique]),
        ),
      };
    },
  });
}

function ImportBody({
  id,
  config,
  table,
  via,
  parentKey,
  onDone,
}: Omit<Props, "onSaved"> & { onDone: (m: string) => void }) {
  const client = useClient();
  const role = formRole(config.form);
  const [file, setFile] = useState<File | null>(null);
  const check = useCheckFile({ config, table, via, parentKey });
  const template = useMutation({
    mutationFn: async () => download(await templateBlob(config.form), `mau-${id}.xlsx`),
  });
  // Gửi một lần: nút khóa theo trạng thái chỉ đổi ở lần vẽ sau, lần bấm thứ hai đến sớm thì thành hai lệnh thêm.
  const sending = useRef(false);
  const save = useMutation({
    mutationFn: async (sheet: ImportSheet) => {
      const objects = importObjects(sheet.rows, via, parentKey);
      const context = { role, additionalTypenames: [table] };
      const result = await client.mutation(insertManyMutation(table), { objects }, context).toPromise();
      if (result.error) throw new ReadableError(insertError(result.error, role, config.form.fields));
      if (result.data?.result?.affected_rows !== objects.length) {
        throw new ReadableError("Máy chủ không thêm đủ số dòng. Tải lại trang, xem lại danh sách rồi nạp lại.");
      }
      return objects.length;
    },
  });
  const sheet = check.data;
  const ready = sheet && sheet.problems.length === 0 && !sheet.rows.some(hasErrors);
  const choose = (chosen: File | null) => {
    setFile(chosen);
    save.reset();
    if (chosen) check.mutate(chosen);
    else check.reset();
  };
  const send = () => {
    if (!sheet || sending.current) return;
    sending.current = true;
    save.mutate(sheet, {
      onSuccess: (count) => onDone(`${config.form.done.message} Số dòng đã thêm: ${count}.`),
      onSettled: () => {
        sending.current = false;
      },
    });
  };
  return (
    <Stack gap="sm">
      {config.form.description && <Text size="sm">{config.form.description}</Text>}
      <Text size="sm">
        Điền vào tệp mẫu, mỗi dòng một mục, tối đa {config.max_rows} dòng; nhận tệp .xlsx hoặc CSV UTF-8. Có lỗi ở dòng
        nào thì không dòng nào được thêm.
      </Text>
      <Group align="flex-end">
        <Button variant="default" onClick={() => template.mutate()} loading={template.isPending}>
          Tải tệp mẫu (.xlsx)
        </Button>
        <FileInput
          label="Tệp dữ liệu"
          placeholder="Chưa chọn tệp"
          accept=".xlsx,.csv"
          value={file}
          onChange={choose}
          clearable
          // Nút xóa tệp chỉ là biểu tượng; thiếu tên thì trình đọc màn hình đọc "nút" trống và axe báo lỗi.
          clearButtonProps={{ "aria-label": "Bỏ tệp đã chọn" }}
          w={320}
        />
      </Group>
      {template.error && <ErrorNotice title="Không tạo được tệp mẫu" error={template.error} />}
      {check.isPending && <Loading what="tệp" />}
      {check.error && <ErrorNotice title="Không đọc được tệp" error={check.error} />}
      {sheet && sheet.problems.length > 0 && (
        <Alert color="red" title="Tệp chưa đúng mẫu">
          <Stack gap={4}>
            {sheet.problems.map((problem) => (
              <Text key={problem} size="sm">
                {problem}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}
      {sheet && sheet.problems.length === 0 && <CatalogImportPreview form={config.form} rows={sheet.rows} />}
      {save.error && <ErrorNotice title="Chưa nạp được" error={save.error} />}
      <Group justify="flex-end">
        <Button onClick={send} disabled={!ready} loading={save.isPending}>
          {sheet && ready ? `${config.form.submit.label} ${sheet.rows.length} dòng` : config.form.submit.label}
        </Button>
      </Group>
    </Stack>
  );
}

export function CatalogImport({ onSaved, ...props }: Props) {
  const { getToken } = useSession();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  // Nút chỉ là lối vào; token thiếu vai trò thì lệnh thêm gửi kèm vai trò đó bị Hasura từ chối.
  if (!rolesOf(getToken()).includes(formRole(props.config.form))) return null;
  const finish = (message: string) => {
    setOpen(false);
    setDone(message);
    onSaved();
  };
  return (
    <Stack gap="xs" align="flex-end">
      <Button
        variant="default"
        onClick={() => {
          setDone(null);
          setOpen(true);
        }}
      >
        {props.config.label}
      </Button>
      {done && (
        <Alert
          maw={420}
          color="green"
          title={done}
          withCloseButton
          closeButtonLabel="Đóng thông báo"
          onClose={() => setDone(null)}
        />
      )}
      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title={props.config.form.title}
        size="xl"
        closeButtonProps={{ "aria-label": "Đóng hộp nạp tệp" }}
      >
        {/* Thân chỉ dựng khi hộp mở: lần mở sau bắt đầu lại, không giữ tệp và lỗi của lần trước. */}
        {open && <ImportBody {...props} onDone={finish} />}
      </Modal>
    </Stack>
  );
}
