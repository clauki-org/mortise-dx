// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần "Trường tùy chỉnh" của chế độ Chỉnh sửa (ADR 0059, ADR 0070): chọn một bảng của danh mục, xem các trường đã
// định nghĩa, thêm trường (mã, nhãn, kiểu, lựa chọn, bắt buộc), sửa nhãn, lựa chọn, bắt buộc, và xóa. EditSections.tsx
// đặt phần này trong bảng chỉnh của mục danh mục, nên chỉ quản trị org (tenant_admin của tenant không có cha) thấy;
// Hasura và trigger của platform.custom_fields vẫn là nơi chặn cuối.

import {
  Alert,
  Button,
  Checkbox,
  Group,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  VisuallyHidden,
} from "@mantine/core";
import { type FormEvent, useState } from "react";
import { useClient } from "urql";
import { type CustomField, KIND_LABELS, KINDS } from "./customFields";
import {
  ADMIN_CONTEXT,
  type CatalogTableRef,
  DELETE_FIELD,
  type Draft,
  definitionError,
  draftOf,
  draftProblems,
  EMPTY_DRAFT,
  INSERT_FIELD,
  insertObject,
  NOT_ROOT_ADMIN,
  pkOf,
  UPDATE_FIELD,
  updateSet,
} from "./customFieldsAdmin";
import { Loading } from "./States";
import { TableScroll } from "./TableScroll";
import { useCustomFields } from "./useCustomFields";

type Run = (query: string, variables: object) => Promise<string | null>;

/** Gửi một lệnh ghi bằng vai trò tenant_admin; trả lời báo khi bị từ chối, null khi ghi được. */
function useRun(): Run {
  const client = useClient();
  return async (query, variables) => {
    const result = await client.mutation(query, variables, ADMIN_CONTEXT).toPromise();
    if (result.error) return definitionError(result.error);
    return result.data?.result ? null : NOT_ROOT_ADMIN;
  };
}

type FormProps = {
  app: string;
  source: string;
  existing: CustomField[];
  /** Trường đang sửa; không có là thêm trường mới */
  editing?: CustomField;
  onDone: (message: string) => void;
  onCancel: () => void;
};

function FieldForm({ app, source, existing, editing, onDone, onCancel }: FormProps) {
  const run = useRun();
  const [draft, setDraft] = useState<Draft>(editing ? draftOf(editing) : EMPTY_DRAFT);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const problems = tried ? draftProblems(draft, existing, editing?.code) : {};
  const change = (patch: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...patch }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    // Bấm đúp trong lúc đang gửi thì không gửi lần hai.
    if (busy || Object.keys(draftProblems(draft, existing, editing?.code)).length > 0) return;
    setBusy(true);
    setRefusal(null);
    const failed = editing
      ? await run(UPDATE_FIELD, { pk: pkOf(editing), set: updateSet(editing, draft) })
      : await run(INSERT_FIELD, { object: insertObject(app, source, draft) });
    setBusy(false);
    if (failed) setRefusal(failed);
    else onDone(editing ? `Đã lưu trường "${draft.label.trim()}".` : `Đã thêm trường "${draft.label.trim()}".`);
  };

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="sm">
        <Text fw={600}>{editing ? `Sửa trường "${editing.label}"` : "Thêm trường"}</Text>
        <Group grow align="flex-start">
          <TextInput
            label="Mã"
            description="Chữ thường không dấu, số, gạch dưới; không đổi được sau khi tạo"
            value={draft.code}
            onChange={(event) => change({ code: event.currentTarget.value })}
            error={problems.code}
            disabled={editing !== undefined}
            required
          />
          <TextInput
            label="Nhãn"
            description="Chữ hiện trên danh mục, biểu mẫu, tệp xuất"
            value={draft.label}
            onChange={(event) => change({ label: event.currentTarget.value })}
            error={problems.label}
            required
          />
        </Group>
        <Select
          label="Kiểu"
          description={editing ? "Kiểu không đổi được sau khi tạo" : undefined}
          data={KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))}
          value={draft.kind}
          onChange={(value) => change({ kind: KINDS.find((kind) => kind === value) ?? "text" })}
          allowDeselect={false}
          disabled={editing !== undefined}
        />
        {draft.kind === "choice" && (
          <Textarea
            label="Các lựa chọn"
            description="Mỗi dòng một lựa chọn; chữ gõ ở đây là giá trị lưu và hiện ra"
            value={draft.choices}
            onChange={(event) => change({ choices: event.currentTarget.value })}
            error={problems.choices}
            autosize
            minRows={3}
            required
          />
        )}
        <Checkbox
          label="Bắt buộc"
          description="Xét khi thêm dòng và khi sửa trường tùy chỉnh của dòng; dòng cũ không bị khóa"
          checked={draft.required}
          onChange={(event) => change({ required: event.currentTarget.checked })}
        />
        {refusal && (
          <Alert color="red" title="Chưa lưu được">
            {refusal}
          </Alert>
        )}
        <Group justify="flex-end">
          {editing && (
            <Button variant="default" onClick={onCancel} disabled={busy}>
              Hủy sửa
            </Button>
          )}
          <Button type="submit" loading={busy}>
            {editing ? "Lưu trường" : "Thêm trường"}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

type ListProps = {
  fields: CustomField[];
  label: string;
  onEdit: (field: CustomField) => void;
  onDelete: (field: CustomField) => void;
};

function FieldList({ fields, label, onEdit, onDelete }: ListProps) {
  if (fields.length === 0) return <Text c="dimmed">{label} chưa có trường tùy chỉnh nào.</Text>;
  return (
    <TableScroll label={`Trường tùy chỉnh của ${label}`} minWidth={560}>
      <Table verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Mã</Table.Th>
            <Table.Th>Nhãn</Table.Th>
            <Table.Th>Kiểu</Table.Th>
            <Table.Th>Lựa chọn</Table.Th>
            <Table.Th>Bắt buộc</Table.Th>
            <Table.Th>
              <VisuallyHidden>Thao tác</VisuallyHidden>
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {fields.map((field) => (
            <Table.Tr key={field.code}>
              <Table.Td>{field.code}</Table.Td>
              <Table.Td>{field.label}</Table.Td>
              <Table.Td>{KIND_LABELS[field.kind]}</Table.Td>
              <Table.Td>{(field.choices ?? []).join(", ")}</Table.Td>
              <Table.Td>{field.required ? "Có" : "Không"}</Table.Td>
              <Table.Td>
                <Group gap="xs" wrap="nowrap">
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() => onEdit(field)}
                    aria-label={`Sửa trường ${field.label}`}
                  >
                    Sửa
                  </Button>
                  <Button
                    size="xs"
                    variant="light"
                    color="red"
                    onClick={() => onDelete(field)}
                    aria-label={`Xóa trường ${field.label}`}
                  >
                    Xóa
                  </Button>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </TableScroll>
  );
}

function ConfirmDelete({
  field,
  onDone,
  onCancel,
}: {
  field: CustomField;
  onDone: (m: string) => void;
  onCancel: () => void;
}) {
  const run = useRun();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    const failed = await run(DELETE_FIELD, pkOf(field));
    setBusy(false);
    if (failed) setRefusal(failed);
    else onDone(`Đã xóa trường "${field.label}".`);
  };
  return (
    <Alert color="yellow" title={`Xóa trường "${field.label}"?`}>
      <Text size="sm">
        Giá trị đã nhập ở các dòng không hiện nữa và không sửa được; thêm lại trường cùng mã thì hiện lại.
      </Text>
      {refusal && (
        <Alert color="red" title="Chưa xóa được" mt="xs">
          {refusal}
        </Alert>
      )}
      <Group mt="sm">
        <Button color="red" onClick={remove} loading={busy}>
          Xóa trường
        </Button>
        <Button variant="default" onClick={onCancel} disabled={busy}>
          Không xóa
        </Button>
      </Group>
    </Alert>
  );
}

type EditorProps = { app: string; tables: CatalogTableRef[] };

/** Phần định nghĩa trường; nơi gọi đưa gói (cột app của định nghĩa) và các bảng chọn được, bảng đầu được chọn sẵn. */
export function CustomFieldsEditor({ app, tables }: EditorProps) {
  const [source, setSource] = useState(tables[0]?.source ?? "");
  const { fields, settled } = useCustomFields(source);
  const [editing, setEditing] = useState<CustomField>();
  const [deleting, setDeleting] = useState<CustomField>();
  const [notice, setNotice] = useState<string | null>(null);
  // Số lần ghi xong: biểu mẫu thêm dựng lại từ ô trống sau mỗi lần.
  const [saved, setSaved] = useState(0);
  const label = tables.find((table) => table.source === source)?.label ?? source;
  const done = (message: string) => {
    setEditing(undefined);
    setDeleting(undefined);
    setNotice(message);
    setSaved((count) => count + 1);
  };
  return (
    <Stack gap="md">
      <Text size="sm">
        Trường thêm ở đây áp cho mọi đơn vị của org. Chưa tìm, lọc hay sắp xếp theo trường tùy chỉnh; Kanban, Lịch và
        nạp từ tệp chưa có chúng.
      </Text>
      {tables.length > 1 && (
        <Select
          label="Bảng"
          data={tables.map((table) => ({ value: table.source, label: table.label }))}
          value={source}
          onChange={(value) => {
            if (!value) return;
            setSource(value);
            setEditing(undefined);
            setDeleting(undefined);
            setNotice(null);
          }}
          allowDeselect={false}
        />
      )}
      {notice && (
        <Alert
          color="green"
          title={notice}
          withCloseButton
          closeButtonLabel="Đóng thông báo"
          onClose={() => setNotice(null)}
        />
      )}
      {settled ? (
        <FieldList
          fields={fields}
          label={label}
          onEdit={(field) => {
            setDeleting(undefined);
            setEditing(field);
          }}
          onDelete={(field) => {
            setEditing(undefined);
            setDeleting(field);
          }}
        />
      ) : (
        <Loading />
      )}
      {deleting && <ConfirmDelete field={deleting} onDone={done} onCancel={() => setDeleting(undefined)} />}
      <FieldForm
        key={`${source}-${editing?.code ?? ""}-${saved}`}
        app={app}
        source={source}
        existing={fields}
        editing={editing}
        onDone={done}
        onCancel={() => setEditing(undefined)}
      />
    </Stack>
  );
}
