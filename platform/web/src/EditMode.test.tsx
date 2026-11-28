// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm phần vẽ của chế độ Chỉnh sửa (EditMode.tsx, EditSections.tsx, ADR 0070): mỗi nhóm là fieldset có legend, ô và
// nút có tên đọc được gồm tên phần tử, khối cuối cùng không gỡ được, thay đổi chờ lưu và lời từ chối của CSDL hiện
// thành chữ, bảng không thêm tiêu đề nào (trang chỉ có một h1). Dựng tĩnh bằng react-dom/server.

import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Client, Provider } from "urql";
import { describe, expect, it } from "vitest";
import { EditPanel } from "./EditMode";
import { type Change, changeKey } from "./editDraft";
import type { MenuItem } from "./menu";

// Phần "Trường tùy chỉnh" của danh mục đọc định nghĩa qua urql; dựng tĩnh không chạy truy vấn nên client không cần
// trả lời gì, chỉ cần có mặt.
const client = new Client({ url: "/v1/graphql", exchanges: [] });

const html = (node: ReactNode) =>
  renderToStaticMarkup(
    <MantineProvider>
      <Provider value={client}>{node}</Provider>
    </MantineProvider>,
  ).replace(/<style[^>]*>[^<]*<\/style>/g, "");

const item = (id: string, component: string, config: unknown): MenuItem => ({
  app: "a",
  app_name: "Gói",
  item: id,
  label: `Mục ${id}`,
  component,
  config,
  roles: null,
  icon: null,
  on_menu: true,
});

const list = item("list", "catalog", {
  title: "Danh mục",
  source: "t",
  fields: [
    { name: "code", label: "Mã" },
    { name: "status", label: "Tình trạng", choices: [{ value: "x", label: "X" }] },
  ],
  list: { columns: ["code", "status"] },
  kanban: { field: "status" },
});
const page = item("page", "page", { title: "Trang", blocks: [{ item: "list", variant: "cards" }] });
const noop = () => {};

const form = item("form", "form", {
  title: "Biểu mẫu",
  fields: [
    { name: "a", label: "Bắt buộc", required: true },
    { name: "b", label: "Tùy chọn" },
  ],
});
const dashboard = item("dash", "dashboard", {
  title: "Bảng",
  panels: [
    {
      id: "p",
      title: "Khối số",
      description: "",
      cards: [{ column: "c", label: "Thẻ", description: "", tone: { bad_when: { gte: 7, label: "Vượt" } } }],
    },
  ],
});

function panel(entry: MenuItem, changes: Change[] = [], refusals = new Map<string, string>()) {
  return html(
    <EditPanel
      entry={entry}
      items={[page, list]}
      saved={[]}
      draft={{ changes, history: [] }}
      setDraft={noop}
      refusals={refusals}
      busy={false}
      notice=""
      onSave={noop}
    />,
  );
}

describe("EditPanel", () => {
  it("trang: khối có kiểu từ danh sách kiểu vẽ được, nút lên xuống có tên, khối cuối không gỡ được", () => {
    const out = panel(page);
    expect(out).toContain('aria-label="Chỉnh sửa trang"');
    expect(out).toContain("<legend");
    expect(out).toContain("Kiểu của khối &quot;Mục list&quot;");
    expect(out).toContain('value="kanban"');
    expect(out).not.toContain('value="calendar"');
    expect(out).toContain('aria-label="Đưa khối &quot;Mục list&quot; lên"');
    expect(out).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Gỡ khối/);
    expect(out).not.toMatch(/<h[1-6]/);
  });

  it("danh mục: đổi nhãn, hiện trong danh sách cho từng cột", () => {
    const out = panel(list);
    expect(out).toContain("Nhãn của cột &quot;Mã&quot;");
    expect(out).toContain("Hiện cột &quot;Tình trạng&quot; trong danh sách");
    expect(out).toContain("Chưa có thay đổi chờ lưu.");
    // Định nghĩa trường tùy chỉnh nằm trong chế độ Chỉnh sửa của danh mục (ADR 0059), có ghi rằng nó lưu ngay.
    expect(out).toContain("<legend");
    expect(out).toContain(">Trường tùy chỉnh</legend>");
    expect(out).toContain("được lưu ngay");
  });

  it("thay đổi chờ lưu và lời từ chối của CSDL hiện thành chữ", () => {
    const change: Change = {
      type: "set",
      app: "a",
      item: "list",
      kind: "label",
      target: "code",
      value: "Mã số",
      note: 'Đổi nhãn cột "Mã" thành "Mã số"',
    };
    const out = panel(list, [change], new Map([[changeKey(change), "lý do thử"]]));
    expect(out).toContain("1 thay đổi chờ lưu:");
    expect(out).toContain("Đổi nhãn cột &quot;Mã&quot; thành &quot;Mã số&quot;");
    expect(out).toContain("bị từ chối: lý do thử");
    expect(out).toContain('value="Mã số"');
  });

  it("biểu mẫu: trường bắt buộc không có ô ẩn", () => {
    const out = panel(form);
    expect(out).toContain("Ẩn trường &quot;Tùy chọn&quot;");
    expect(out).not.toContain("Ẩn trường &quot;Bắt buộc&quot;");
    expect(out).toContain("Nhãn của trường &quot;Bắt buộc&quot;");
    expect(out).not.toContain(">Trường tùy chỉnh</legend>");
  });

  it("bảng điều hành: tiêu đề khối, ngưỡng kèm phép so và số của gói", () => {
    const out = panel(dashboard);
    expect(out).toContain("Tiêu đề của khối &quot;Khối số&quot;");
    expect(out).toContain("Ngưỡng &quot;Vượt&quot; của thẻ &quot;Thẻ&quot;: từ");
    expect(out).toContain('value="7"');
  });
});
