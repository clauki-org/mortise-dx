// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Nút "sửa dòng đang xem" (detail.edit) và "thêm dòng con" (add của đối tượng con) của thành phần danh mục, ADR 0054:
// bấm thì mở biểu mẫu của gói trong hộp thoại, gửi bằng token người dùng với vai trò của biểu mẫu. CatalogRecord.tsx
// đặt nút sửa ở đầu trang và nút thêm cạnh tiêu đề bảng con; xong thì gọi onSaved để nơi gọi đọc lại dữ liệu. Nút chỉ
// hiện khi token có vai trò của biểu mẫu; ai sửa, thêm được dòng nào do quyền Hasura quyết định.

import { Alert, Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useClient, useQuery } from "urql";
import { ReadableError } from "./errorText";
import { FormFields } from "./FormFields";
import { type FormConfig, formRole, payloadOf, type Values } from "./formConfig";
import { insertError, insertMutation } from "./formInsert";
import {
  CONFLICT,
  changedColumns,
  prefillOf,
  readColumns,
  rowQuery,
  updateError,
  updateMutation,
  updateWhere,
} from "./formUpdate";
import { rolesOf } from "./menu";
import { ErrorNotice, Loading } from "./States";
import { useSession } from "./session";

/** Sửa dòng có khóa keyValue, hoặc thêm dòng con với cột via mang khóa của dòng cha (shown là ô chỉ đọc hiện ra). */
export type Target =
  | { kind: "update"; key: string; keyValue: unknown }
  | { kind: "insert"; via: string; parentKey: unknown; shown: { label: string; text: string } };

type Props = { label: string; form: FormConfig; target: Target; onSaved: () => void; primary?: boolean };

/** Lệnh sửa không khớp dòng nào: không phải lỗi của máy chủ mà là tín hiệu để đọc lại dòng. */
class Conflict extends Error {}

type BodyProps = { form: FormConfig; onDone: (message: string) => void; onCancel: () => void };

function Actions({ form, pending, onCancel }: { form: FormConfig; pending: boolean; onCancel: () => void }) {
  return (
    <Group justify="flex-end" mt="md">
      <Button variant="default" onClick={onCancel} disabled={pending}>
        Hủy
      </Button>
      <Button type="submit" loading={pending}>
        {form.submit.label}
      </Button>
    </Group>
  );
}

/** Gửi một lần: nút khóa theo trạng thái chỉ đổi ở lần vẽ sau, nên lần bấm thứ hai đến sớm bị chặn ở đây. */
function useOnce() {
  const sending = useRef(false);
  return (run: (release: () => void) => void) => {
    if (sending.current) return;
    sending.current = true;
    run(() => {
      sending.current = false;
    });
  };
}

function InsertBody({ form, target, onDone, onCancel }: BodyProps & { target: Extract<Target, { kind: "insert" }> }) {
  const client = useClient();
  const role = formRole(form);
  const table = form.submit.insert ?? "";
  const [values, setValues] = useState<Values>({});
  const once = useOnce();
  const save = useMutation({
    mutationFn: async (data: Values) => {
      // Khóa của dòng cha đặt sau cùng: trình duyệt không có ô nào ghi được cột này.
      const object = { ...payloadOf(form, data), [target.via]: target.parentKey };
      const context = { role, additionalTypenames: [table] };
      const result = await client.mutation(insertMutation(table), { object }, context).toPromise();
      if (result.error) throw new ReadableError(insertError(result.error, role, form.fields));
      if (result.data?.result?.affected_rows !== 1) {
        throw new ReadableError(
          "Máy chủ không thêm dòng nào. Tải lại trang rồi gửi lại; nếu vẫn lỗi, báo người quản trị.",
        );
      }
    },
  });
  const send = (data: Values) =>
    once((release) => save.mutate(data, { onSuccess: () => onDone(form.done.message), onSettled: release }));
  return (
    <Stack gap="sm">
      <TextInput label={target.shown.label} value={target.shown.text} readOnly disabled />
      <FormFields config={form} values={values} onValues={setValues} onSubmit={send}>
        {save.isError && <ErrorNotice title="Chưa thêm được" error={save.error} />}
        <Actions form={form} pending={save.isPending} onCancel={onCancel} />
      </FormFields>
    </Stack>
  );
}

type Loaded = { row: Values; version: unknown };

function UpdateEditor({
  form,
  target,
  loaded,
  conflict,
  onConflict,
  onDone,
  onCancel,
}: BodyProps & {
  target: Extract<Target, { kind: "update" }>;
  loaded: Loaded;
  conflict: boolean;
  onConflict: () => void;
}) {
  const client = useClient();
  const role = formRole(form);
  const table = form.submit.update ?? "";
  const version = form.submit.version ?? "";
  const initial = useMemo(() => prefillOf(form, loaded.row), [form, loaded]);
  const [values, setValues] = useState<Values>(initial);
  const once = useOnce();
  const save = useMutation({
    mutationFn: async (data: Values) => {
      const set = changedColumns(form, initial, data);
      if (Object.keys(set).length === 0)
        throw new ReadableError("Chưa có giá trị nào thay đổi, nên không có gì để lưu.");
      const where = updateWhere(target.key, target.keyValue, version, loaded.version);
      const context = { role, additionalTypenames: [table] };
      const result = await client.mutation(updateMutation(table), { where, set }, context).toPromise();
      if (result.error) throw new ReadableError(updateError(result.error, role, form.fields));
      if (result.data?.result?.affected_rows !== 1) throw new Conflict();
    },
  });
  const send = (data: Values) =>
    once((release) =>
      save.mutate(data, {
        onSuccess: () => onDone(form.done.message),
        onError: (error) => {
          if (error instanceof Conflict) onConflict();
        },
        onSettled: release,
      }),
    );
  return (
    <FormFields config={form} values={values} onValues={setValues} onSubmit={send}>
      {/* Lời báo sửa trùng nằm ở thân hộp thoại: biểu mẫu vẽ lại với giá trị mới nên lỗi của lần gửi cũ đã mất. */}
      {conflict && (
        <Alert color="yellow" title="Chưa lưu" mt="md">
          {CONFLICT}
        </Alert>
      )}
      {save.isError && !(save.error instanceof Conflict) && <ErrorNotice title="Chưa lưu được" error={save.error} />}
      <Actions form={form} pending={save.isPending} onCancel={onCancel} />
    </FormFields>
  );
}

function UpdateBody(props: BodyProps & { target: Extract<Target, { kind: "update" }> }) {
  const { form, target } = props;
  const table = form.submit.update ?? "";
  const version = form.submit.version ?? "";
  const [conflict, setConflict] = useState(false);
  const context = useMemo(() => ({ role: formRole(form) }), [form]);
  const [{ data, fetching, error }, reload] = useQuery<{ rows: Values[] }>({
    query: rowQuery(table, readColumns(form, target.key)),
    variables: { where: { [target.key]: { _eq: target.keyValue } } },
    context,
    // Luôn đọc từ máy chủ: giá trị version trong bộ nhớ đệm có thể đã cũ, và bộ nhớ đệm không phân biệt vai trò.
    requestPolicy: "network-only",
  });
  if (error) {
    return (
      <ErrorNotice
        title="Không đọc được dòng này"
        error={error}
        onRetry={() => reload({ requestPolicy: "network-only" })}
      />
    );
  }
  const row = data?.rows[0];
  if (!row) {
    if (fetching || !data) return <Loading />;
    return (
      <Alert color="yellow" title="Không sửa được dòng này">
        Tài khoản không đọc được dòng này với vai trò {formRole(form)}: dòng đã bị xóa, hoặc bạn không còn quyền sửa.
      </Alert>
    );
  }
  const loaded = { row, version: row[version] };
  return (
    <UpdateEditor
      {...props}
      // Dòng đọc lại mang version mới thì biểu mẫu bắt đầu lại từ giá trị mới; giữ giá trị cũ là ghi đè người kia.
      key={String(loaded.version)}
      loaded={loaded}
      conflict={conflict}
      onConflict={() => {
        setConflict(true);
        reload({ requestPolicy: "network-only" });
      }}
    />
  );
}

export function CatalogForm({ label, form, target, onSaved, primary = false }: Props) {
  const { getToken } = useSession();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  // Nút chỉ là lối vào; token thiếu vai trò thì mọi lệnh gửi kèm vai trò đó đều bị Hasura từ chối.
  if (!rolesOf(getToken()).includes(formRole(form))) return null;
  const finish = (message: string) => {
    setOpen(false);
    setDone(message);
    onSaved();
  };
  const body = { form, onDone: finish, onCancel: () => setOpen(false) };
  return (
    <Stack gap="xs" align="flex-end">
      <Button
        variant={primary ? "filled" : "default"}
        onClick={() => {
          setDone(null);
          setOpen(true);
        }}
      >
        {label}
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
        title={form.title}
        size="lg"
        closeButtonProps={{ "aria-label": "Đóng biểu mẫu" }}
      >
        {form.description && (
          <Text size="sm" mb="sm">
            {form.description}
          </Text>
        )}
        {/* Thân chỉ dựng khi hộp mở: mỗi lần mở đọc lại dòng và bắt đầu từ giá trị mới, không giữ lần mở trước. */}
        {open &&
          (target.kind === "update" ? (
            <UpdateBody {...body} target={target} />
          ) : (
            <InsertBody {...body} target={target} />
          ))}
      </Modal>
    </Stack>
  );
}
