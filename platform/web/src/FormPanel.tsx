// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thành phần biểu mẫu nhập liệu (contracts/form.schema.json, ADR 0030): vẽ các trường theo cấu hình của gói bằng rjsf
// với bộ kiểm formValidator, rồi khởi tạo một quy trình qua workflow-api (submit.process) hoặc thêm một dòng qua
// GraphQL (submit.insert), bằng token của người dùng. Trình duyệt chỉ kiểm trước cho nhanh; workflow-api và Hasura
// vẫn quyết định. Ở đây không có tên bảng hay chữ của một lĩnh vực nào.

import { Alert, Anchor, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { Form as MantineForm } from "@rjsf/mantine";
import type { RJSFValidationError } from "@rjsf/utils";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useClient } from "urql";
import {
  clearDependents,
  type FormConfig,
  formProblems,
  formSchema,
  type KeyState,
  keyFor,
  payloadOf,
  type Values,
} from "./formConfig";
import { insertError, insertMutation } from "./formInsert";
import { formValidator } from "./formValidator";
import { findItem, itemPath, rolesOf } from "./menu";
import { usePackageMenu } from "./PackagePage";
import { type FormContext, SourceChoice } from "./SourceChoice";
import { useSession } from "./session";
import { idempotencyKey, startProcess } from "./workflow";

// Ô nhập của Mantine đã tự hiện lỗi dưới ô; danh sách lỗi riêng của rjsf dưới mỗi trường sẽ lặp lại cùng lỗi đó.
const NoFieldErrorList = () => null;
const TEMPLATES = { FieldErrorTemplate: NoFieldErrorList };
const WIDGETS = { sourceChoice: SourceChoice };

const freshKey = (): KeyState => ({ key: idempotencyKey() });

/** Gửi một lần: khởi tạo quy trình hoặc thêm một dòng. Ném Error mang lời báo cho người dùng. */
function useSubmit(config: FormConfig) {
  const { getToken } = useSession();
  const client = useClient();
  const role = config.role ?? "user";
  return useMutation({
    mutationFn: async ({ payload, key }: { payload: Values; key: string }) => {
      if (config.submit.process) {
        await startProcess(getToken(), config.submit.process, payload, key);
        return;
      }
      const table = config.submit.insert ?? "";
      // additionalTypenames: kết quả chỉ có affected_rows, không mang kiểu của bảng, nên urql không tự biết danh sách
      // đã đọc từ bảng này (ví dụ danh mục ở done.menu) cần đọc lại.
      const context = { role, additionalTypenames: [table] };
      const result = await client.mutation(insertMutation(table), { object: payload }, context).toPromise();
      if (result.error) throw new Error(insertError(result.error, role));
      if (result.data?.result?.affected_rows !== 1) {
        throw new Error("Máy chủ không thêm dòng nào. Tải lại trang rồi gửi lại; nếu vẫn lỗi, báo người quản trị.");
      }
    },
  });
}

function Done({ config, app, onAgain }: { config: FormConfig; app: string; onAgain: () => void }) {
  const { items } = usePackageMenu();
  // Mục menu dành cho vai trò khác thì không có trong danh sách, và không hiện đường dẫn tới trang không mở được.
  const next = config.done.menu ? findItem(items, app, config.done.menu) : undefined;
  return (
    <Alert color="green" title={config.done.message}>
      <Group mt="xs">
        <Button variant="light" onClick={onAgain}>
          Lập tiếp
        </Button>
        {next && (
          <Anchor component={Link} to={itemPath(next)}>
            {next.label}
          </Anchor>
        )}
      </Group>
    </Alert>
  );
}

function FormBody({ config, app }: { config: FormConfig; app: string }) {
  const { schema, uiSchema } = useMemo(() => formSchema(config), [config]);
  const [values, setValues] = useState<Values>({});
  const [done, setDone] = useState(false);
  const keys = useRef<KeyState>(freshKey());
  // Nút khóa theo trạng thái gửi, nhưng trạng thái đó chỉ đổi ở lần vẽ sau; lần bấm thứ hai đến trước lúc ấy vẫn
  // gọi onSubmit. Lệnh thêm dòng không có Idempotency-Key, nên chặn ở đây.
  const sending = useRef(false);
  const submit = useSubmit(config);
  const context: FormContext = { values, role: config.role };

  const send = (data: Values) => {
    if (sending.current) return;
    sending.current = true;
    const payload = payloadOf(config, data);
    keys.current = keyFor(keys.current, JSON.stringify(payload), idempotencyKey);
    submit.mutate(
      { payload, key: keys.current.key },
      {
        onSuccess: () => {
          keys.current = freshKey();
          setDone(true);
        },
        onSettled: () => {
          sending.current = false;
        },
      },
    );
  };
  const again = () => {
    submit.reset();
    setValues({});
    setDone(false);
  };
  // Ô đánh dấu bắt buộc mang luật const: true; thông điệp chung "Giá trị không đúng" không nói phải làm gì.
  const transformErrors = (errors: RJSFValidationError[]) =>
    errors.map((error) => (error.name === "const" ? { ...error, message: "Cần đánh dấu ô này" } : error));

  if (done) return <Done config={config} app={app} onAgain={again} />;
  return (
    <MantineForm
      schema={schema}
      uiSchema={uiSchema}
      formData={values}
      formContext={context}
      validator={formValidator}
      widgets={WIDGETS}
      templates={TEMPLATES}
      transformErrors={transformErrors}
      onChange={(event) => setValues((previous) => clearDependents(config, previous, event.formData ?? {}))}
      onSubmit={(event) => send(event.formData ?? {})}
      showErrorList={false}
      noHtml5Validate
    >
      <Stack mt="md" gap="sm">
        {submit.isError && (
          <Alert color="red" title="Chưa gửi được">
            {submit.error.message}
            {config.submit.process && ". Bấm gửi lại; nếu vẫn lỗi, báo người quản trị."}
          </Alert>
        )}
        <Group>
          <Button type="submit" loading={submit.isPending}>
            {config.submit.label}
          </Button>
        </Group>
      </Stack>
    </MantineForm>
  );
}

export function FormPanel({ config, app }: { config: FormConfig; app: string }) {
  const { getToken } = useSession();
  const problems = formProblems(config);
  if (problems.length > 0) {
    return (
      <Alert color="red" title="Cấu hình biểu mẫu sai">
        {problems.join("; ")}. Báo người quản trị sửa cấu hình của gói.
      </Alert>
    );
  }
  const allowed = config.role === undefined || rolesOf(getToken()).includes(config.role);
  return (
    <Stack maw={720}>
      <Title order={1} size="h2">
        {config.title}
      </Title>
      {config.description && <Text c="dimmed">{config.description}</Text>}
      {allowed ? (
        <Paper withBorder radius="md" p="md">
          <FormBody config={config} app={app} />
        </Paper>
      ) : (
        <Alert color="yellow" title="Tài khoản chưa dùng được biểu mẫu này">
          Biểu mẫu cần vai trò {config.role} mà tài khoản đang đăng nhập không có. Báo người quản trị cấp vai trò, hoặc
          đăng nhập bằng tài khoản có vai trò đó.
        </Alert>
      )}
    </Stack>
  );
}
