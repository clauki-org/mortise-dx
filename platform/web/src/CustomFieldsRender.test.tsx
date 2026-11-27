// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm trường tùy chỉnh (ADR 0059) khi vẽ thật: ô của biểu mẫu mang tên __custom_<mã> vẫn có nhãn gắn với ô nhập, và
// danh sách của danh mục đọc cột custom rồi hiện cột tùy chỉnh khi bảng có định nghĩa. Dựng bằng react-dom/server với
// client urql giả trả định nghĩa và dòng cho trước.

import { MantineProvider } from "@mantine/core";
import type { User } from "oidc-client-ts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { Client, type Exchange, Provider } from "urql";
import { describe, expect, it } from "vitest";
import { filter, map, pipe } from "wonka";
import { CatalogTable } from "./CatalogTable";
import type { CatalogNode } from "./catalog";
import { emptyState } from "./catalogQuery";
import { type CustomField, inputName, withInputs } from "./customFields";
import { FormFields } from "./FormFields";
import type { FormConfig } from "./formConfig";
import { SessionContext } from "./session";

const base = { root_tenant_id: "r", source: "app_x_items", choices: null, required: false };
const fields: CustomField[] = [
  { ...base, code: "brand", label: "Hãng", kind: "choice", choices: ["A", "B"] },
  { ...base, code: "power", label: "Công suất", kind: "number" },
  { ...base, code: "since", label: "Ngày lắp", kind: "date" },
  { ...base, code: "note", label: "Ghi chú thêm", kind: "text" },
];

function render(node: ReactNode, queries: string[] = []) {
  const exchange: Exchange = () => (operations) =>
    pipe(
      operations,
      filter((operation) => operation.kind === "query"),
      map((operation) => {
        const text = operation.query.loc?.source.body ?? "";
        queries.push(text);
        const data = text.includes("platform_custom_fields")
          ? { platform_custom_fields: fields }
          : { rows: [{ id: 1, code: "A-1", custom: { power: 1500, brand: "B" } }] };
        return { operation, data, stale: false, hasNext: false };
      }),
    );
  const client = new Client({ url: "/v1/graphql", exchanges: [exchange] });
  const session = { user: { profile: {} } as unknown as User, getToken: () => "x.e30.y" };
  return renderToStaticMarkup(
    <MantineProvider>
      <MemoryRouter>
        <SessionContext value={session}>
          <Provider value={client}>{node}</Provider>
        </SessionContext>
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe("ô tùy chỉnh trong biểu mẫu", () => {
  it("mỗi ô có nhãn gắn với ô nhập theo id của rjsf", () => {
    const form: FormConfig = {
      title: "Sửa",
      fields: [{ name: "code", label: "Mã", type: "string" }],
      submit: { label: "Lưu", update: "app_x_items", version: "updated_at" },
      done: { message: "Đã lưu" },
    };
    const html = render(
      <FormFields config={withInputs(form, fields, {})} values={{}} onValues={() => {}} onSubmit={() => {}}>
        {null}
      </FormFields>,
    );
    for (const field of fields) {
      const id = `root_${inputName(field.code)}`;
      expect(html).toMatch(new RegExp(`<label[^>]*for="${id}"[^>]*>(?:(?!</label>).)*${field.label}`));
      expect(html).toContain(`id="${id}"`);
    }
  });
});

describe("danh sách có trường tùy chỉnh", () => {
  it("câu đọc dòng thêm cột custom; bảng có cột tùy chỉnh với giá trị của dòng", () => {
    const config: CatalogNode = {
      source: "app_x_items",
      fields: [{ name: "code", label: "Mã" }],
      list: { columns: ["code"] },
    };
    const queries: string[] = [];
    const html = render(
      <CatalogTable config={config} label="Vật tư" path="/apps/x/items" state={emptyState} onChange={() => {}} />,
      queries,
    );
    const rows = queries.find((query) => query.includes("rows: app_x_items"));
    expect(rows).toMatch(/\{\s*id\s+code\s+custom\s*\}/);
    expect(html).toContain("Công suất");
    expect(html).toContain("1.500");
    expect(html).toContain(">B<");
  });
});
