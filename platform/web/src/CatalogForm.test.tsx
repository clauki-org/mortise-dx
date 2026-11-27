// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm khi nào nút sửa, nút thêm dòng con của danh mục hiện (CatalogForm.tsx, ADR 0054): chỉ khi token có vai trò
// của biểu mẫu; và biểu mẫu sửa dòng đặt trên menu thì báo cấu hình sai thay vì vẽ ô nhập. Dựng ra HTML bằng
// react-dom/server, không cần trình duyệt hay máy chủ.

import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "oidc-client-ts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { Client, Provider } from "urql";
import { describe, expect, it } from "vitest";
import { CatalogForm } from "./CatalogForm";
import { FormPanel } from "./FormPanel";
import type { FormConfig } from "./formConfig";
import { SessionContext } from "./session";

// Client không có exchange nào gửi yêu cầu: bài chỉ xem cách vẽ, không gọi mạng.
const client = new Client({ url: "/v1/graphql", exchanges: [] });

const form: FormConfig = {
  title: "Sửa",
  role: "tenant_admin",
  fields: [{ name: "code", label: "Mã", type: "string" }],
  submit: { label: "Lưu", update: "app_example_items", version: "updated_at" },
  done: { message: "Đã lưu" },
};

function render(roles: string[], node: ReactNode): string {
  const payload = btoa(JSON.stringify({ realm_access: { roles } }));
  const session = { user: {} as User, getToken: () => `x.${payload}.y` };
  return renderToStaticMarkup(
    <MantineProvider>
      <MemoryRouter>
        <SessionContext.Provider value={session}>
          <QueryClientProvider client={new QueryClient()}>
            <Provider value={client}>{node}</Provider>
          </QueryClientProvider>
        </SessionContext.Provider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

const button = (
  <CatalogForm label="Sửa dòng" form={form} target={{ kind: "update", key: "id", keyValue: "1" }} onSaved={() => {}} />
);

describe("CatalogForm", () => {
  it("nút hiện khi token có vai trò của biểu mẫu, ẩn khi không có", () => {
    expect(render(["user", "tenant_admin"], button)).toContain("Sửa dòng");
    expect(render(["user"], button)).not.toContain("Sửa dòng");
  });

  it("biểu mẫu sửa dòng đặt trên menu báo cấu hình sai, không vẽ ô nhập", () => {
    const html = render(["tenant_admin"], <FormPanel config={form} app="example" />);
    expect(html).toContain("biểu mẫu sửa dòng chỉ mở được từ màn hình chi tiết của danh mục");
    expect(html).not.toContain("<input");
  });
});
