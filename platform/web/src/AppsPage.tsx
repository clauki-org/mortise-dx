// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Trang "Ứng dụng" của quản trị org (ADR 0065): mỗi gói đã cài một thẻ với tên, mô tả, gói cần và nút bật, tắt. Tắt
// thì Hasura không trả mục menu của gói cho ai trong org nữa, nên menu, trang chủ và khối của gói mất mà dữ liệu vẫn
// còn. Nút bị khóa kèm lý do khi gói đang bật khác cần gói này hay gói này cần gói đang tắt (apps.ts); CSDL từ chối
// thì hiện lời từ chối của CSDL. Shell.tsx chỉ đặt trang này lên menu cho quản trị org (useOrgAdmin).

import { Alert, Group, Paper, Stack, Switch, Text, Title } from "@mantine/core";
import { useId, useState } from "react";
import { useMutation, useQuery } from "urql";
import {
  blockedReason,
  isOrgAdmin,
  PACKAGES_CONTEXT,
  PACKAGES_QUERY,
  type PackageRow,
  type PackagesData,
  refusalText,
  requiredNames,
  SET_PACKAGE_STATE,
  TENANT_QUERY,
  type TenantData,
} from "./apps";
import { rolesOf } from "./menu";
import { PageHeader } from "./PageHeader";
import { Empty, ErrorNotice, Loading } from "./States";
import { StatusBadge } from "./StatusBadge";
import { useSession } from "./session";

/**
 * Người đăng nhập có phải quản trị org không: tenant_admin của tenant không có cha. undefined khi chưa đọc xong tenant,
 * để trang không báo "không có quyền" rồi đổi ngay sau đó; lỗi đọc thì coi như không phải.
 */
export function useOrgAdmin(): boolean | undefined {
  const { getToken } = useSession();
  const [{ data, error }] = useQuery<TenantData>({ query: TENANT_QUERY });
  if (!data && !error) return undefined;
  return isOrgAdmin(rolesOf(getToken()), data?.core_tenants);
}

type CardProps = {
  row: PackageRow;
  rows: PackageRow[];
  busy: boolean;
  refusal: string | null;
  onChange: (enabled: boolean) => void;
};

/** Thẻ của một gói. Trạng thái ghi bằng chữ cạnh nút, không chỉ bằng màu của nút. */
export function PackageCard({ row, rows, busy, refusal, onChange }: CardProps) {
  const headingId = useId();
  const reasonId = useId();
  const blocked = blockedReason(rows, row.app);
  const needs = requiredNames(rows, row);
  return (
    <Paper component="section" withBorder radius="md" p="lg" aria-labelledby={headingId}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
        <Stack gap={4} miw={0}>
          <Group gap="xs">
            <Title order={2} size="h4" id={headingId}>
              {row.name}
            </Title>
            <StatusBadge tone={row.enabled ? "ok" : "neutral"}>{row.enabled ? "Đang bật" : "Đã tắt"}</StatusBadge>
          </Group>
          {row.description && <Text size="sm">{row.description}</Text>}
          <Text size="sm" c="gray.7">
            {needs.length > 0 ? `Cần: ${needs.join(", ")}` : "Không cần gói nào khác"}
          </Text>
        </Stack>
        <Switch
          checked={row.enabled}
          disabled={busy || blocked !== null}
          onChange={(event) => onChange(event.currentTarget.checked)}
          aria-label={`Bật gói ${row.name}`}
          aria-describedby={blocked ? reasonId : undefined}
          size="md"
        />
      </Group>
      {blocked && (
        <Text size="sm" c="gray.7" mt="xs" id={reasonId}>
          {row.enabled ? "Chưa tắt được: " : "Chưa bật được: "}
          {blocked}
        </Text>
      )}
      {refusal && (
        <Alert color="red" title="Không đổi được trạng thái" role="alert" mt="xs">
          {refusal}
        </Alert>
      )}
    </Paper>
  );
}

export function PackageList({
  rows,
  busy,
  refusals,
  onChange,
}: {
  rows: PackageRow[];
  busy: string | null;
  refusals: Map<string, string>;
  onChange: (app: string, enabled: boolean) => void;
}) {
  if (rows.length === 0) {
    return (
      <Empty
        title="Chưa có gói nào trong danh sách."
        hint="Gói cài trước khi có trang này hiện ra sau khi người vận hành chạy lại make app-install cho gói đó."
      />
    );
  }
  return (
    <Stack gap="sm">
      {rows.map((row) => (
        <PackageCard
          key={row.app}
          row={row}
          rows={rows}
          busy={busy !== null}
          refusal={refusals.get(row.app) ?? null}
          onChange={(enabled) => onChange(row.app, enabled)}
        />
      ))}
    </Stack>
  );
}

export function AppsPage() {
  const orgAdmin = useOrgAdmin();
  // Người không có vai trò tenant_admin gửi truy vấn với vai trò đó thì Hasura báo lỗi vai trò; không gửi là đủ.
  const [{ data, error }] = useQuery<PackagesData>({
    query: PACKAGES_QUERY,
    context: PACKAGES_CONTEXT,
    pause: orgAdmin !== true,
  });
  const [, setState] = useMutation(SET_PACKAGE_STATE);
  const [busy, setBusy] = useState<string | null>(null);
  const [refusals, setRefusals] = useState(new Map<string, string>());

  const change = async (app: string, enabled: boolean) => {
    setBusy(app);
    const result = await setState({ app, enabled }, PACKAGES_CONTEXT);
    const next = new Map(refusals);
    if (result.error) {
      next.set(app, refusalText(result.error) ?? "Không gửi được yêu cầu; thử lại sau ít phút.");
    } else {
      next.delete(app);
    }
    setRefusals(next);
    setBusy(null);
  };

  const header = (
    <PageHeader
      title="Ứng dụng"
      description="Bật, tắt từng gói cho cả org. Tắt gói thì menu, trang chủ và khối của gói ẩn đi ở mọi đơn vị; dữ liệu giữ nguyên, bật lại thì hiện như cũ."
    />
  );
  // Lúc vừa thôi tạm dừng, truy vấn có thể chưa chạy (fetching còn false); chưa có dữ liệu cũng là đang tải, không thì
  // trang hiện "chưa có gói nào" trong chốc lát.
  if (orgAdmin === undefined || (!data && !error)) return <Loading what="danh sách gói" />;
  if (orgAdmin === false) {
    return (
      <>
        {header}
        <Alert color="yellow" title="Chỉ quản trị org mở được trang này">
          Trang này dành cho quản trị của đơn vị gốc của org.
        </Alert>
      </>
    );
  }
  if (error) {
    return (
      <>
        {header}
        <ErrorNotice title="Không đọc được danh sách gói" error={error} />
      </>
    );
  }
  return (
    <>
      {header}
      <PackageList rows={data?.platform_apps_by_tenant ?? []} busy={busy} refusals={refusals} onChange={change} />
    </>
  );
}
