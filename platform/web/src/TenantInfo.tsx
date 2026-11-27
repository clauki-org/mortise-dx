// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Đơn vị và người đang đăng nhập, hiện ở thanh trên ("<đơn vị> · <tên đăng nhập>"). Đơn vị đọc qua GraphQL bằng
// token: Hasura chỉ trả đúng đơn vị trong token, nên tên hiện ra cũng cho biết đường đăng nhập và quyền dữ liệu theo
// tenant đang đúng.

import { Group, Loader, Text } from "@mantine/core";
import { useQuery } from "urql";

const TENANTS = "query { core_tenants { id name } }";

type TenantsData = { core_tenants: { id: string; name: string }[] };

function TenantName() {
  const [{ data, fetching, error }] = useQuery<TenantsData>({ query: TENANTS });
  if (fetching) return <Loader size="sm" aria-label="Đang tải đơn vị" />;
  if (error) {
    return (
      <Text size="sm" c="red.8" title={error.message} truncate>
        Không đọc được đơn vị
      </Text>
    );
  }
  const tenant = data?.core_tenants[0];
  // Màu chữ mặc định chứ không phải dimmed: xám nhạt của Mantine không đạt tương phản WCAG AA trên nền trắng.
  return (
    <Text size="sm" fw={600} truncate title={tenant?.name}>
      {tenant ? tenant.name : "Tài khoản chưa được gán đơn vị"}
    </Text>
  );
}

// Khi hẹp, tên đơn vị co và cắt bằng dấu ba chấm trước, tên đăng nhập giữ tới 40% bề rộng; `title` giữ đủ chữ.
export function TenantInfo({ username }: { username: string | undefined }) {
  return (
    <Group gap={6} wrap="nowrap" miw={0}>
      <TenantName />
      {username && (
        <>
          <Text size="sm" c="gray.7" aria-hidden="true">
            ·
          </Text>
          <Text size="sm" c="gray.7" truncate title={username} style={{ flexShrink: 0, maxWidth: "40vw" }}>
            {username}
          </Text>
        </>
      )}
    </Group>
  );
}
