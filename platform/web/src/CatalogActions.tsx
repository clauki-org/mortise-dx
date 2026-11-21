// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Nút trên màn hình chi tiết của thành phần danh mục (detail.actions, ADR 0026): mỗi nút khởi tạo một quy trình của
// gói cho dòng đang xem qua API quy trình của lõi, với biến lấy từ dòng. CatalogRecord.tsx vẽ khối này dưới tiêu
// đề. Người bấm xem các giá trị sẽ gửi trong hộp xác nhận trước khi gửi; quyền khởi tạo do workflow-api quyết định.

import { Alert, Button, Group, Modal, Stack, Table, Text } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { type Action, actionVariables, type CatalogNode, type Row } from "./catalog";
import { useSession } from "./session";
import { idempotencyKey, startProcess } from "./workflow";

/** Nút đang mở hộp xác nhận, cùng mã Idempotency-Key của lần định gửi này. */
type Pending = { action: Action; key: string };

export function CatalogActions({ node, row }: { node: CatalogNode; row: Row }) {
  const { getToken } = useSession();
  const [open, setOpen] = useState<Pending | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: ({ action, key }: Pending) =>
      startProcess(getToken(), action.process, actionVariables(node, action, row).variables, key),
    onSuccess: (_, { action }) => {
      setOpen(null);
      setDone(action.label);
    },
  });
  const actions = node.detail?.actions ?? [];
  if (actions.length === 0) return null;

  // Mã mới cho mỗi lần mở hộp: bấm đúp hay gửi lại sau lỗi trong cùng hộp dùng lại mã nên chỉ có một hồ sơ, còn lần
  // mở sau là một hồ sơ mới. Mã suy từ khóa của dòng thì không lập lại được hồ sơ cho dòng đó, kể cả khi hồ sơ cũ đã
  // bị trả lại, vì workflow-api trả lại cả quy trình đã kết thúc.
  const choose = (action: Action) => {
    start.reset();
    setDone(null);
    setOpen({ action, key: idempotencyKey() });
  };
  const close = () => {
    if (!start.isPending) setOpen(null);
  };
  const preview = open ? actionVariables(node, open.action, row) : undefined;

  return (
    <Stack gap="xs">
      <Group>
        {actions.map((action) => (
          <Button key={action.id} variant="light" onClick={() => choose(action)}>
            {action.label}
          </Button>
        ))}
      </Group>
      {done && (
        <Alert color="green" title={`Đã gửi: ${done}`} withCloseButton onClose={() => setDone(null)}>
          Hồ sơ đã được lập; người xử lý thấy việc trên bảng việc của họ.
        </Alert>
      )}
      <Modal opened={open !== null} onClose={close} title={open?.action.label} closeOnClickOutside={!start.isPending}>
        {open && preview && (
          <Stack>
            {preview.shown.length > 0 && (
              <>
                <Text size="sm">Hồ sơ được lập với các giá trị sau của dòng này:</Text>
                <Table variant="vertical" layout="fixed">
                  <Table.Tbody>
                    {preview.shown.map((sent) => (
                      <Table.Tr key={sent.label}>
                        <Table.Th w={200}>{sent.label}</Table.Th>
                        <Table.Td>{sent.text}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </>
            )}
            {preview.missing.length > 0 && (
              <Alert color="yellow" title="Chưa lập được hồ sơ">
                Dòng này chưa có giá trị ở: {preview.missing.join(", ")}. Bổ sung dữ liệu rồi thử lại.
              </Alert>
            )}
            {start.error && (
              <Alert color="red" title="Không lập được hồ sơ">
                {start.error.message}. Bấm gửi lại; nếu vẫn lỗi, báo người quản trị.
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={close} disabled={start.isPending}>
                Hủy
              </Button>
              <Button
                onClick={() => start.mutate(open)}
                loading={start.isPending}
                disabled={preview.missing.length > 0}
              >
                Gửi
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
