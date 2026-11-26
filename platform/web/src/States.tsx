// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Ba trạng thái dùng chung của mọi trang (ADR 0046): đang tải, rỗng và lỗi. Trang nào cũng báo cùng một kiểu: lỗi là
// một khối role="alert" nói bằng lời dễ hiểu chuyện gì xảy ra và nên làm gì (errorText.ts), thông điệp gốc nằm sau
// "Chi tiết kỹ thuật", tải lại được thì có nút "Thử lại". Chữ nghiệp vụ (tên danh mục...) do nơi gọi đưa từ cấu hình.

import { Alert, Button, Group, Loader, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { errorText } from "./errorText";

/**
 * Vòng quay có nhãn cho trình đọc màn hình. Nhãn luôn bắt đầu bằng "Đang tải": e2e chờ mọi nhãn như vậy biến mất
 * để biết trang đã tải xong, nên một nhãn khác sẽ làm phép chờ đó qua sớm.
 */
export function Loading({ what, inline = false }: { what?: string; inline?: boolean }) {
  const label = what ? `Đang tải ${what}` : "Đang tải";
  if (inline) return <Loader size="sm" aria-label={label} />;
  return (
    <Group p="xl" justify="center">
      <Loader aria-label={label} />
    </Group>
  );
}

type EmptyProps = {
  /** Câu chính, ví dụ "Chưa có dòng nào." */
  title: string;
  /** Việc nên làm tiếp, nếu có */
  hint?: ReactNode;
  /** Nút việc chính, ví dụ xóa bộ lọc */
  action?: ReactNode;
};

export function Empty({ title, hint, action }: EmptyProps) {
  return (
    <Stack gap="xs" p="xl" align="center" ta="center">
      <Text c="dimmed">{title}</Text>
      {hint && (
        <Text size="sm" c="dimmed">
          {hint}
        </Text>
      )}
      {action}
    </Stack>
  );
}

type ErrorNoticeProps = {
  /** Việc không làm được, ví dụ "Không tải được dữ liệu" */
  title: string;
  error: unknown;
  /** Có thì hiện nút "Thử lại" gọi lại đúng yêu cầu vừa hỏng */
  onRetry?: () => void;
  /** Lời thêm của nơi gọi, ví dụ phần vẫn dùng được khi phần này hỏng */
  children?: ReactNode;
};

export function ErrorNotice({ title, error, onRetry, children }: ErrorNoticeProps) {
  const { text, detail } = errorText(error);
  return (
    <Alert color="red" title={title} role="alert">
      <Stack gap="xs" align="flex-start">
        <Text size="sm">{text}</Text>
        {children}
        {onRetry && (
          <Button size="xs" variant="light" color="red" onClick={onRetry}>
            Thử lại
          </Button>
        )}
        {/* details của trình duyệt: mở đóng bằng bàn phím, trình đọc màn hình đọc được trạng thái, không cần JS. */}
        {detail && (
          <Text component="details" size="xs" c="dimmed">
            <Text component="summary" size="xs" style={{ cursor: "pointer" }}>
              Chi tiết kỹ thuật
            </Text>
            <Text component="span" size="xs" ff="monospace" style={{ overflowWrap: "anywhere" }}>
              {detail}
            </Text>
          </Text>
        )}
      </Stack>
    </Alert>
  );
}
