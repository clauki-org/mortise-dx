// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm nút "nạp từ tệp" và phần xem trước (CatalogImport.tsx, CatalogImportPreview.tsx, ADR 0064): nút chỉ hiện khi
// token có vai trò của biểu mẫu; lỗi của từng ô viết bằng chữ và dòng lỗi được ghi rõ, không chỉ tô màu. Dựng ra HTML
// bằng react-dom/server, không cần trình duyệt hay máy chủ.

import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "oidc-client-ts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Client, Provider } from "urql";
import { describe, expect, it } from "vitest";
import { CatalogImport } from "./CatalogImport";
import { CatalogImportPreview } from "./CatalogImportPreview";
import type { Import } from "./catalog";
import { checkSheet } from "./catalogImport";
import { SessionContext } from "./session";

// Client không có exchange nào gửi yêu cầu: bài chỉ xem cách vẽ, không gọi mạng.
const client = new Client({ url: "/v1/graphql", exchanges: [] });

const config: Import = {
  label: "Nạp từ tệp",
  max_rows: 50,
  unique: "code",
  form: {
    title: "Nạp dòng",
    role: "tenant_admin",
    fields: [
      { name: "code", label: "Mã", type: "string", required: true },
      { name: "area", label: "Diện tích", type: "number", required: true },
    ],
    submit: { label: "Nạp", insert: "app_example_parts" },
    done: { message: "Đã nạp." },
  },
};

function render(roles: string[], node: ReactNode): string {
  const payload = btoa(JSON.stringify({ realm_access: { roles } }));
  const session = { user: {} as User, getToken: () => `x.${payload}.y` };
  return renderToStaticMarkup(
    <MantineProvider>
      <SessionContext.Provider value={session}>
        <QueryClientProvider client={new QueryClient()}>
          <Provider value={client}>{node}</Provider>
        </QueryClientProvider>
      </SessionContext.Provider>
    </MantineProvider>,
  );
}

describe("CatalogImport", () => {
  it("nút hiện khi token có vai trò của biểu mẫu, ẩn khi không có", () => {
    const button = (
      <CatalogImport
        id="parts"
        config={config}
        table="app_example_parts"
        via="item_id"
        parentKey="u-1"
        onSaved={() => {}}
      />
    );
    expect(render(["tenant_admin"], button)).toContain("Nạp từ tệp");
    expect(render(["user"], button)).not.toContain("Nạp từ tệp");
  });

  it("xem trước ghi lỗi bằng chữ dưới ô sai và đánh dấu dòng có lỗi", () => {
    const rows = checkSheet(
      config.form,
      [
        ["Mã", "Diện tích"],
        ["P1", "12,5"],
        ["P2", "nhiều"],
      ],
      50,
    ).rows;
    const html = render([], <CatalogImportPreview form={config.form} rows={rows} />);
    expect(html).toContain("1 trong 2 dòng có lỗi");
    expect(html).toContain("Lỗi: Cần một số, ví dụ 12,5");
    expect(html).toContain("3 (có lỗi)");
    expect(html).toContain('aria-label="Xem trước dữ liệu của tệp"');
  });
});
