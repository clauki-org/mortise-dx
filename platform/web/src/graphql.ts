// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Client GraphQL tới Hasura qua cổng (/v1/graphql). Mỗi yêu cầu gắn access token hiện tại; Hasura lọc dữ liệu theo
// tenant và vai trò trong token, nên giao diện không tự lọc. Truy vấn nào cần vai trò khác vai trò mặc định thì ghi
// `role` vào context của truy vấn (ADR 0024); Hasura vẫn từ chối vai trò không có trong token.

import { Client, cacheExchange, fetchExchange, makeOperation, mapExchange } from "urql";

/** fetchOptions của một yêu cầu, thêm header chọn vai trò Hasura mà giữ nguyên các header đã có (token). */
export function withRole(options: RequestInit, role: string): RequestInit {
  return { ...options, headers: { ...(options.headers as Record<string, string>), "X-Hasura-Role": role } };
}

// Đặt fetchOptions riêng ở từng truy vấn sẽ thay hẳn fetchOptions của client và làm mất token; exchange này gộp vào.
const roleExchange = mapExchange({
  onOperation(operation) {
    const role = operation.context.role;
    if (typeof role !== "string") return operation;
    const base = operation.context.fetchOptions;
    const options = typeof base === "function" ? base() : (base ?? {});
    return makeOperation(operation.kind, operation, { ...operation.context, fetchOptions: withRole(options, role) });
  },
});

export function createGraphqlClient(getToken: () => string | undefined) {
  return new Client({
    url: "/v1/graphql",
    exchanges: [cacheExchange, roleExchange, fetchExchange],
    // urql mặc định gửi truy vấn ngắn bằng GET; Hasura chỉ nhận GraphQL qua POST và trả PersistedQueryNotSupported.
    preferGetMethod: false,
    fetchOptions: () => {
      const token = getToken();
      return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
    },
  });
}
