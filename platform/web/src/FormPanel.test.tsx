// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm cách thành phần biểu mẫu vẽ cấu hình của gói: mỗi trường có nhãn gắn với ô nhập (trình đọc màn hình đọc được),
// trường con chưa chọn được khi trường cha còn trống, nhãn là chữ chứ không phải HTML, và token thiếu vai trò của biểu
// mẫu thì biểu mẫu không hiện. Dựng ra HTML bằng react-dom/server, không cần trình duyệt hay máy chủ.

import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "oidc-client-ts";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { Client, Provider } from "urql";
import { describe, expect, it } from "vitest";
import { FormPanel } from "./FormPanel";
import type { FormConfig } from "./formConfig";
import { SessionContext } from "./session";

// Client không có exchange nào gửi yêu cầu: bài chỉ xem cách vẽ, không gọi mạng.
const client = new Client({ url: "/v1/graphql", exchanges: [] });

const config: FormConfig = {
  title: "Lập <b>yêu cầu</b>",
  role: "tenant_admin",
  fields: [
    { name: "title", label: "Tên yêu cầu", type: "string", required: true },
    { name: "group", label: "Nhóm", type: "choice", required: true, source: { table: "t_g", value: "c", label: "n" } },
    {
      name: "item",
      label: "Đối tượng",
      type: "choice",
      source: { table: "t_i", value: "c", label: "n", where: { column: "g", field: "group" } },
    },
    { name: "kind", label: "Loại", type: "choice", choices: [{ value: "a", label: "Loại A" }] },
  ],
  submit: { label: "Gửi", process: "core-approval" },
  done: { message: "Đã gửi" },
};

function render(roles: string[], form: FormConfig = config): string {
  const payload = btoa(JSON.stringify({ realm_access: { roles } }));
  const session = { user: {} as User, getToken: () => `x.${payload}.y` };
  return renderToStaticMarkup(
    <MantineProvider>
      <MemoryRouter>
        <SessionContext.Provider value={session}>
          <QueryClientProvider client={new QueryClient()}>
            <Provider value={client}>
              <FormPanel config={form} app="example" />
            </Provider>
          </QueryClientProvider>
        </SessionContext.Provider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe("FormPanel", () => {
  it("mỗi trường có nhãn gắn với ô nhập; trường con khóa tới khi chọn trường cha", () => {
    const html = render(["user", "tenant_admin"]);
    expect(html).toContain("Lập &lt;b&gt;yêu cầu&lt;/b&gt;");
    for (const [name, label] of [
      ["title", "Tên yêu cầu"],
      ["group", "Nhóm"],
      ["item", "Đối tượng"],
      ["kind", "Loại"],
    ]) {
      expect(html).toMatch(new RegExp(`<label[^>]*for="root_${name}"[^>]*>${label}`));
      expect(html).toContain(`id="root_${name}"`);
    }
    // Ô chọn là combobox có tên lấy từ nhãn; e2e tìm ô theo vai trò và tên này.
    const item = /<input[^>]*id="root_item"[^>]*>/.exec(html)?.[0] ?? "";
    expect(item).toContain('role="combobox"');
    expect(item).toContain('disabled=""');
    expect(item).toContain('placeholder="Chọn Nhóm trước"');
    // Danh sách cố định vẽ bằng ô chọn của rjsf, cũng là combobox.
    expect(/<input[^>]*id="root_kind"[^>]*>/.exec(html)?.[0]).toContain('role="combobox"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>.*Gửi/);
  });

  it("token thiếu vai trò của biểu mẫu thì báo, không vẽ ô nhập", () => {
    const html = render(["user"]);
    expect(html).toContain("Tài khoản chưa dùng được biểu mẫu này");
    expect(html).not.toContain('id="root_title"');
  });

  it("biểu mẫu không khai role dùng vai trò user: token có user thì vẽ, không có thì báo", () => {
    const { role: _, ...plain } = config;
    expect(render(["user"], plain)).toContain('id="root_title"');
    const html = render([], plain);
    expect(html).toContain("Biểu mẫu cần vai trò user");
    expect(html).not.toContain('id="root_title"');
  });

  it("gợi ý của gói hiện dưới nhãn và gắn vào ô bằng aria-describedby, với mọi kiểu trường", () => {
    const fields: FormConfig["fields"] = [
      { name: "title", label: "Tên", type: "string", help: "Gợi ý chữ" },
      { name: "note", label: "Ghi chú", type: "string", multiline: true, help: "Gợi ý nhiều dòng" },
      { name: "amount", label: "Số lượng", type: "number", help: "Gợi ý số" },
      { name: "day", label: "Ngày", type: "date", help: "Gợi ý ngày" },
      { name: "kind", label: "Loại", type: "choice", choices: [{ value: "a", label: "A" }], help: "Gợi ý chọn" },
      {
        name: "group",
        label: "Nhóm",
        type: "choice",
        source: { table: "t_g", value: "c", label: "n" },
        help: "Gợi ý danh sách",
      },
      { name: "agree", label: "Xác nhận", type: "boolean", help: "Gợi ý ô đánh dấu" },
      { name: "plain", label: "Không gợi ý", type: "string" },
    ];
    const html = render(["user"], { ...config, role: undefined, fields });
    for (const field of fields) {
      const input = new RegExp(`<(input|textarea|button)[^>]*id="root_${field.name}"[^>]*>`).exec(html)?.[0] ?? "";
      expect(input, field.name).not.toBe("");
      const described = /aria-describedby="([^"]*)"/.exec(input)?.[1] ?? "";
      if (!field.help) {
        expect(described, field.name).toBe("");
        continue;
      }
      const texts = described.split(" ").map((id) => new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)?.[1] ?? "");
      expect(texts, field.name).toContain(field.help);
      // Gợi ý chỉ hiện một lần: ô nào cũng vẽ thêm một dòng riêng thì người đọc thấy hai lần.
      expect(html.split(field.help).length - 1, field.name).toBe(1);
    }
  });
});
