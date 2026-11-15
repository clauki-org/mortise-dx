// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Đơn vị của người đang đăng nhập, hiện ở thanh trên. Đọc qua GraphQL bằng token: Hasura chỉ trả đúng đơn vị trong
// token, nên tên hiện ra cũng cho biết đường đăng nhập và quyền dữ liệu theo tenant đang đúng.

import { Loader, Text } from "@mantine/core";
import { useQuery } from "urql";

const TENANTS = "query { core_tenants { id name } }";

type TenantsData = { core_tenants: { id: string; name: string }[] };

export function TenantInfo() {
  const [{ data, fetching, error }] = useQuery<TenantsData>({ query: TENANTS });
  if (fetching) return <Loader size="sm" aria-label="Đang tải đơn vị" />;
  if (error) {
    return (
      <Text size="sm" c="red" title={error.message}>
        Không đọc được đơn vị
      </Text>
    );
  }
  const tenant = data?.core_tenants[0];
  return (
    <Text size="sm" c="dimmed">
      {tenant ? tenant.name : "Tài khoản chưa được gán đơn vị"}
    </Text>
  );
}
