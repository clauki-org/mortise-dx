// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thành phần biểu mẫu nhập liệu (contracts/form.schema.json, ADR 0030): vẽ các trường theo cấu hình của gói bằng rjsf
// với bộ kiểm formValidator, rồi khởi tạo một quy trình qua workflow-api (submit.process) hoặc thêm một dòng qua
// GraphQL (submit.insert), bằng token của người dùng. Trình duyệt chỉ kiểm trước cho nhanh; workflow-api và Hasura
// vẫn quyết định. Ở đây không có tên bảng hay chữ của một lĩnh vực nào.

import { Alert, Anchor, Button, Group, Paper, Stack } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useClient } from "urql";
import { casesPathFor } from "./cases";
import { insertCustom, withInputs } from "./customFields";
import { ReadableError } from "./errorText";
import { FormFields } from "./FormFields";
import { type FormConfig, formProblems, formRole, type KeyState, keyFor, payloadOf, type Values } from "./formConfig";
import { insertError, insertMutation } from "./formInsert";
import { findItem, itemPath, rolesOf } from "./menu";
import { usePackageMenu } from "./PackagePage";
import { PageHeader } from "./PageHeader";
import { ErrorNotice, Loading } from "./States";
import { useSession } from "./session";
import { useCustomFields } from "./useCustomFields";
import { idempotencyKey, startProcess } from "./workflow";

const freshKey = (): KeyState => ({ key: idempotencyKey() });

/** Gửi một lần: khởi tạo quy trình hoặc thêm một dòng. Ném Error mang lời báo cho người dùng. */
function useSubmit(config: FormConfig) {
  const { getToken } = useSession();
  const client = useClient();
  const role = formRole(config);
  return useMutation({
    mutationFn: async ({ payload, key }: { payload: Values; key: string }) => {
      if (config.submit.process) {
        return (await startProcess(getToken(), config.submit.process, payload, key)).id;
      }
      const table = config.submit.insert ?? "";
      // additionalTypenames: kết quả chỉ có affected_rows, không mang kiểu của bảng, nên urql không tự biết danh sách
      // đã đọc từ bảng này (ví dụ danh mục ở done.menu) cần đọc lại.
      const context = { role, additionalTypenames: [table] };
      const result = await client.mutation(insertMutation(table), { object: payload }, context).toPromise();
      if (result.error) throw new ReadableError(insertError(result.error, role, config.fields));
      if (result.data?.result?.affected_rows !== 1) {
        throw new ReadableError(
          "Máy chủ không thêm dòng nào. Tải lại trang rồi gửi lại; nếu vẫn lỗi, báo người quản trị.",
        );
      }
      return undefined;
    },
  });
}

type DoneProps = { config: FormConfig; app: string; started?: string; onAgain: () => void };

function Done({ config, app, started, onAgain }: DoneProps) {
  const { items } = usePackageMenu();
  // Mục menu dành cho vai trò khác thì không có trong danh sách, và không hiện đường dẫn tới trang không mở được.
  const next = config.done.menu ? findItem(items, app, config.done.menu) : undefined;
  // Hồ sơ vừa lập mở được ở trang theo dõi hồ sơ của cùng gói, nếu gói có trang cho quy trình này (ADR 0032).
  const opened =
    started && config.submit.process ? casesPathFor(items, app, config.submit.process, started) : undefined;
  return (
    <Alert color="green" title={config.done.message}>
      <Group mt="xs">
        <Button variant="light" onClick={onAgain}>
          Lập tiếp
        </Button>
        {opened && (
          <Anchor component={Link} to={opened}>
            Xem hồ sơ vừa lập
          </Anchor>
        )}
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
  const [values, setValues] = useState<Values>({});
  // undefined: chưa gửi xong; chuỗi: mã hồ sơ vừa lập, rỗng khi biểu mẫu thêm dòng.
  const [done, setDone] = useState<string>();
  const keys = useRef<KeyState>(freshKey());
  // Nút khóa theo trạng thái gửi, nhưng trạng thái đó chỉ đổi ở lần vẽ sau; lần bấm thứ hai đến trước lúc ấy vẫn
  // gọi onSubmit. Lệnh thêm dòng không có Idempotency-Key, nên chặn ở đây.
  const sending = useRef(false);
  const submit = useSubmit(config);
  // Biểu mẫu thêm dòng vào bảng đã bật trường tùy chỉnh có thêm ô của chúng (ADR 0059); khởi tạo quy trình thì không.
  const custom = useCustomFields(config.submit.insert);
  const shown = useMemo(() => withInputs(config, custom.fields), [config, custom.fields]);

  const send = (data: Values) => {
    if (sending.current) return;
    sending.current = true;
    const extra = insertCustom(custom.fields, data);
    const payload = { ...payloadOf(config, data), ...(extra ? { custom: extra } : {}) };
    keys.current = keyFor(keys.current, JSON.stringify(payload), idempotencyKey);
    submit.mutate(
      { payload, key: keys.current.key },
      {
        onSuccess: (started) => {
          keys.current = freshKey();
          setDone(started ?? "");
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
    setDone(undefined);
  };
  if (done !== undefined) return <Done config={config} app={app} started={done} onAgain={again} />;
  if (!custom.settled) return <Loading />;
  return (
    <FormFields config={shown} values={values} onValues={setValues} onSubmit={send}>
      <Stack mt="md" gap="sm">
        {submit.isError && <ErrorNotice title="Chưa gửi được" error={submit.error} />}
        <Group>
          <Button type="submit" loading={submit.isPending}>
            {config.submit.label}
          </Button>
        </Group>
      </Stack>
    </FormFields>
  );
}

export function FormPanel({ config, app }: { config: FormConfig; app: string }) {
  const { getToken } = useSession();
  const problems = formProblems(config);
  // Lệnh sửa cần một dòng cụ thể mà trang trên menu không có; chỉ màn hình chi tiết của danh mục mở được (ADR 0054).
  if (config.submit?.update !== undefined)
    problems.push("biểu mẫu sửa dòng chỉ mở được từ màn hình chi tiết của danh mục");
  if (problems.length > 0) {
    return (
      <Alert color="red" title="Cấu hình biểu mẫu sai">
        {problems.join("; ")}. Báo người quản trị sửa cấu hình của gói.
      </Alert>
    );
  }
  const role = formRole(config);
  const allowed = rolesOf(getToken()).includes(role);
  return (
    // Một cột hẹp (ADR 0050): mắt không phải đi ngang xa giữa nhãn, gợi ý và ô nhập.
    <Stack maw={640}>
      <PageHeader title={config.title} description={config.description} />
      {allowed ? (
        <Paper withBorder radius="md" p="md">
          <FormBody config={config} app={app} />
        </Paper>
      ) : (
        <Alert color="yellow" title="Tài khoản chưa dùng được biểu mẫu này">
          Biểu mẫu cần vai trò {role} mà tài khoản đang đăng nhập không có. Báo người quản trị cấp vai trò, hoặc đăng
          nhập bằng tài khoản có vai trò đó.
        </Alert>
      )}
    </Stack>
  );
}
