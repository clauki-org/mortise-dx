// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Client GraphQL tới Hasura qua cổng (/v1/graphql). Mỗi yêu cầu gắn access token hiện tại; Hasura lọc dữ liệu theo
// tenant và vai trò trong token, nên giao diện không tự lọc.

import { Client, cacheExchange, fetchExchange } from "urql";

export function createGraphqlClient(getToken: () => string | undefined) {
  return new Client({
    url: "/v1/graphql",
    exchanges: [cacheExchange, fetchExchange],
    // urql mặc định gửi truy vấn ngắn bằng GET; Hasura chỉ nhận GraphQL qua POST và trả PersistedQueryNotSupported.
    preferGetMethod: false,
    fetchOptions: () => {
      const token = getToken();
      return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
    },
  });
}
