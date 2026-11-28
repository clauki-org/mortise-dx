// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm hộp thoại "Trường tùy chỉnh" (customFieldsAdmin.ts, CustomFieldsDialog.tsx, ADR 0059): bảng chọn được của danh
// mục, luật của từng ô trước khi gửi, dòng gửi khi thêm, sửa, lời báo khi bị từ chối; danh sách trường và nút của từng
// trường có tên đọc được. Phần vẽ dựng bằng react-dom/server với client urql giả trả định nghĩa cho trước.

import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { Client, type Exchange, Provider } from "urql";
import { describe, expect, it } from "vitest";
import { filter, map, pipe } from "wonka";
import { CustomFieldsEditor } from "./CustomFieldsDialog";
import type { CatalogConfig } from "./catalog";
import type { CustomField } from "./customFields";
import {
  catalogTables,
  type Draft,
  definitionError,
  draftProblems,
  EMPTY_DRAFT,
  insertObject,
  NOT_ROOT_ADMIN,
  updateSet,
} from "./customFieldsAdmin";

const brand: CustomField = {
  root_tenant_id: "tinh-mau",
  source: "app_x_items",
  code: "brand",
  label: "Hãng",
  kind: "choice",
  choices: ["A", "B"],
  required: true,
};

describe("catalogTables", () => {
  it("bảng của danh mục và mọi bảng con, cha trước con, không trùng", () => {
    const child = (id: string, source: string, children: unknown[] = []) => ({
      id,
      label: id,
      via: "parent_id",
      source,
      fields: [{ name: "code", label: "Mã" }],
      list: { columns: ["code"] },
      detail: { children },
    });
    const config = {
      title: "Cơ sở",
      source: "app_x_sites",
      fields: [{ name: "code", label: "Mã" }],
      list: { columns: ["code"] },
      detail: {
        children: [child("toa", "app_x_blocks", [child("phong", "app_x_rooms")]), child("lai", "app_x_sites")],
      },
    } as CatalogConfig;
    expect(catalogTables(config)).toEqual([
      { source: "app_x_sites", label: "Cơ sở" },
      { source: "app_x_blocks", label: "toa" },
      { source: "app_x_rooms", label: "phong" },
    ]);
  });
});

describe("draftProblems", () => {
  const draft = (patch: Partial<Draft>): Draft => ({ ...EMPTY_DRAFT, code: "hang", label: "Hãng", ...patch });

  it("mã theo luật của CSDL, không trùng; khi sửa không xét mã", () => {
    expect(draftProblems(draft({}), [])).toEqual({});
    expect(draftProblems(draft({ code: "Hang" }), []).code).toMatch(/chữ thường/);
    expect(draftProblems(draft({ code: `a${"b".repeat(40)}` }), []).code).toBeDefined();
    expect(draftProblems(draft({ code: "brand" }), [brand]).code).toMatch(/đã có/);
    expect(draftProblems(draft({ code: "brand" }), [brand], "brand")).toEqual({});
  });

  it("nhãn bắt buộc; lựa chọn khác rỗng, không lặp", () => {
    expect(draftProblems(draft({ label: "  " }), []).label).toBe("Bắt buộc nhập");
    expect(draftProblems(draft({ kind: "choice", choices: "\n " }), []).choices).toMatch(/ít nhất/);
    expect(draftProblems(draft({ kind: "choice", choices: "A\nA" }), []).choices).toMatch(/lặp/);
    expect(draftProblems(draft({ kind: "choice", choices: " A \n\nB" }), [])).toEqual({});
  });
});

describe("dòng gửi", () => {
  it("thêm: lựa chọn từ từng dòng, kiểu khác thì choices là null", () => {
    const sent = insertObject("pkg", "app_x_items", {
      code: "hang",
      label: " Hãng ",
      kind: "choice",
      choices: "A\n B\n",
      required: true,
    });
    expect(sent).toEqual({
      app: "pkg",
      source: "app_x_items",
      code: "hang",
      label: "Hãng",
      kind: "choice",
      choices: ["A", "B"],
      required: true,
    });
    expect(insertObject("pkg", "s", { ...EMPTY_DRAFT, code: "x", label: "X", choices: "A" }).choices).toBeNull();
  });

  it("sửa: chỉ nhãn, bắt buộc và lựa chọn của kiểu lựa chọn", () => {
    expect(updateSet(brand, { ...EMPTY_DRAFT, label: "Hãng pin", kind: "choice", choices: "A\nC" })).toEqual({
      label: "Hãng pin",
      required: false,
      choices: ["A", "C"],
    });
    expect(updateSet({ ...brand, kind: "text", choices: null }, { ...EMPTY_DRAFT, label: "X" })).toEqual({
      label: "X",
      required: false,
    });
  });
});

describe("definitionError", () => {
  const failure = (message: string, code = "constraint-violation") => ({
    networkError: undefined,
    graphQLErrors: [{ message, extensions: { code } }],
  });

  it("lý do của trigger hiện nguyên văn; khóa ngoại, trùng mã, quyền có lời riêng", () => {
    const reason = "Tenant xa-a có tenant cha: trường tùy chỉnh chỉ định nghĩa ở tenant gốc của org (ADR 0059)";
    expect(definitionError(failure(`Check constraint violation. ${reason}`, "permission-error") as never)).toBe(reason);
    expect(definitionError(failure("Foreign key violation. insert or update ...") as never)).toMatch(/chưa bật/);
    expect(definitionError(failure("Uniqueness violation. duplicate key") as never)).toMatch(/đã có trường/);
    expect(
      definitionError(failure("check constraint of an insert permission has failed", "permission-error") as never),
    ).toBe(NOT_ROOT_ADMIN);
  });
});

describe("CustomFieldsEditor", () => {
  it("liệt kê trường của bảng, nút sửa, xóa có tên theo nhãn trường; có ô thêm trường", () => {
    const exchange: Exchange = () => (operations) =>
      pipe(
        operations,
        filter((operation) => operation.kind === "query"),
        map((operation) => ({ operation, data: { platform_custom_fields: [brand] }, stale: false, hasNext: false })),
      );
    const client = new Client({ url: "/v1/graphql", exchanges: [exchange] });
    const html = renderToStaticMarkup(
      <MantineProvider>
        <Provider value={client}>
          <CustomFieldsEditor
            app="pkg"
            tables={[
              { source: "app_x_items", label: "Vật tư" },
              { source: "app_x_rooms", label: "Phòng" },
            ]}
          />
        </Provider>
      </MantineProvider>,
    );
    expect(html).toContain("Hãng");
    expect(html).toContain('aria-label="Sửa trường Hãng"');
    expect(html).toContain('aria-label="Xóa trường Hãng"');
    expect(html).toContain("Thêm trường");
    expect(html).toContain("Bảng");
  });
});
