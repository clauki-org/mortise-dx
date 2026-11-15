// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Đơn vị của người đang đăng nhập, đọc qua GraphQL bằng token: kiểm cả đường đăng nhập lẫn quyền dữ liệu theo tenant
// (Hasura chỉ trả đúng đơn vị trong token).

import { Alert, Loader, Text } from "@mantine/core";
import { useQuery } from "urql";

const TENANTS = "query { core_tenants { id name } }";

type TenantsData = { core_tenants: { id: string; name: string }[] };

export function TenantInfo() {
  const [{ data, fetching, error }] = useQuery<TenantsData>({ query: TENANTS });
  if (fetching) return <Loader size="sm" aria-label="Đang tải đơn vị" />;
  if (error) {
    return (
      <Alert color="red" title="Không đọc được dữ liệu">
        {error.message}. Kiểm tra cổng API đang chạy và tài khoản đã được gán đơn vị.
      </Alert>
    );
  }
  const tenant = data?.core_tenants[0];
  return <Text>Đơn vị: {tenant ? tenant.name : "chưa được gán"}</Text>;
}
