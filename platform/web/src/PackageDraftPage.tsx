// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Màn hình "Soạn cấu hình gói" của quản trị đơn vị (ADR 0071): gõ nhu cầu, gửi tới /v1/assistant/package-drafts, xem
// bản nháp mô hình soạn và tải từng tệp về. Màn hình không cài gì: quản trị viên tự đặt tệp vào apps/<gói>/ và tự cài.
// Không phải mục menu của gói nào, nên nằm ở nhóm "Chung" như trang "Ứng dụng"; Shell.tsx chỉ hiện mục cho người có
// tenant_admin (canDraft), mở thẳng đường dẫn thì màn hình tự báo.

import { Alert, Button, Group, Loader, Stack, Text, Textarea } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { PackageDraftResult } from "./PackageDraftResult";
import { PageHeader } from "./PageHeader";
import { canDraft, draftPackage } from "./packageDraft";
import { ErrorNotice } from "./States";
import { useSession } from "./session";

export function PackageDraftPage() {
  const { getToken } = useSession();
  const [need, setNeed] = useState("");
  const drafting = useMutation({ mutationFn: (text: string) => draftPackage(getToken(), text) });
  const header = (
    <PageHeader
      title="Soạn cấu hình gói"
      description="Mô tả các màn hình đơn vị cần; trợ lý soạn bản nháp app.yaml và cấu hình component theo hợp đồng của nền tảng, kèm lý do chọn từng component. Trợ lý không cài gì."
    />
  );
  if (!canDraft(getToken())) {
    return (
      <>
        {header}
        <Alert color="yellow" title="Chỉ quản trị đơn vị mở được trang này">
          Cấu hình hệ thống cần quản trị viên của đơn vị chấp nhận.
        </Alert>
      </>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    // Mỗi lần gửi tốn một lượt của mô hình và một dòng nhật ký: không gửi lại khi lượt trước chưa xong.
    const text = need.trim();
    if (text && !drafting.isPending) drafting.mutate(text);
  };
  return (
    <Stack>
      {header}
      <form onSubmit={submit}>
        <Stack gap="xs">
          <Textarea
            label="Nhu cầu"
            description="Ví dụ: quản lý danh sách gì, ai lập hồ sơ gì, gửi ai duyệt, ai theo dõi gì."
            value={need}
            onChange={(event) => setNeed(event.currentTarget.value)}
            autosize
            minRows={3}
          />
          <Group>
            <Button type="submit" disabled={!need.trim() || drafting.isPending}>
              Soạn bản nháp
            </Button>
          </Group>
        </Stack>
      </form>
      {drafting.isPending && (
        // Mô hình soạn và có thể sửa một lần, mất nhiều giây; nói rõ để người dùng không bấm lại hay rời trang.
        <Group gap="xs">
          <Loader size="sm" aria-hidden />
          <Text>Mô hình đang soạn bản nháp; có thể mất một lúc.</Text>
        </Group>
      )}
      {drafting.isError && <ErrorNotice title="Chưa soạn được bản nháp" error={drafting.error} />}
      {drafting.data && !drafting.isPending && <PackageDraftResult draft={drafting.data} />}
    </Stack>
  );
}
