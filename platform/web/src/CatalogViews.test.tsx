// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm cách vẽ Kanban và Lịch của danh mục (CatalogKanban.tsx, CatalogCalendar.tsx, ADR 0066) bằng react-dom/server
// với client urql giả trả dữ liệu cho trước: cột theo choices, nút "Chuyển sang" chỉ có khi gói khai move và token có
// vai trò, cột khóa không có nút, bảng chỉ đọc khi không khai move; lịch xếp dòng vào đúng ngày, đánh dấu hôm nay bằng
// chữ, dòng có ngày không đọc được hiện ở danh sách riêng.

import { MantineProvider } from "@mantine/core";
import type { User } from "oidc-client-ts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { Client, type Exchange, Provider } from "urql";
import { describe, expect, it } from "vitest";
import { filter, map, pipe } from "wonka";
import { CatalogCalendar } from "./CatalogCalendar";
import { CatalogKanban } from "./CatalogKanban";
import type { CatalogConfig } from "./catalog";
import { emptyState } from "./catalogQuery";
import type { KanbanConfig } from "./catalogViews";
import { SessionContext } from "./session";

function render(node: ReactNode, data: unknown, roles: string[]) {
  const exchange: Exchange = () => (operations) =>
    pipe(
      operations,
      filter((operation) => operation.kind === "query"),
      map((operation) => ({ operation, data, stale: false, hasNext: false })),
    );
  const client = new Client({ url: "/v1/graphql", exchanges: [exchange] });
  const payload = btoa(JSON.stringify({ realm_access: { roles } }));
  const session = { user: { profile: {} } as unknown as User, getToken: () => `x.${payload}.y` };
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

const config: CatalogConfig = {
  title: "Phiếu",
  source: "app_x_jobs",
  fields: [
    { name: "code", label: "Mã" },
    {
      name: "status",
      label: "Tình trạng",
      choices: [
        { value: "new", label: "Mới" },
        { value: "doing", label: "Đang làm", tone: "info" },
        { value: "review", label: "Chờ nghiệm thu" },
      ],
    },
    { name: "note", label: "Ghi chú" },
    { name: "due_on", label: "Hẹn", type: "date" },
  ],
  list: { columns: ["code", "status", "note"] },
};
const fields = config.fields.slice(0, 3);
const kanban: KanbanConfig = { field: "status", move: { version: "updated_at" }, locked: ["review"] };
const board = {
  c0: [{ id: 1, code: "P-1", status: "new", note: "x", updated_at: "t1" }],
  c1: [],
  c2: [{ id: 2, code: "P-2", status: "review", note: null, updated_at: "t2" }],
  cx: [],
};
const props = { config, columns: fields, state: emptyState, path: "/apps/x/jobs", label: "Phiếu", onClear: () => {} };

describe("CatalogKanban", () => {
  it("mỗi lựa chọn một cột có tiêu đề và số thẻ; cột cuối rỗng không hiện; thẻ có liên kết tới chi tiết", () => {
    const html = render(<CatalogKanban {...props} kanban={kanban} />, board, ["user"]);
    expect(html.match(/<h2/g)).toHaveLength(3);
    expect(html).toMatch(/mantine-Badge-root[^>]*>.*Đang làm/);
    expect(html).not.toContain("Chưa xếp cột");
    expect(html).toMatch(/<a[^>]*href="\/apps\/x\/jobs\/1"[^>]*>P-1<\/a>/);
    expect(html).toContain('role="region"');
    expect(html).toContain('role="status"');
    // Trường chia cột đã là tiêu đề của cột, không lặp trên thẻ.
    expect(html).not.toMatch(/<dt[^>]*>Tình trạng/);
  });

  it("thẻ chuyển được có nút Chuyển sang mang tên thẻ và kéo được; cột khóa không có nút, có lời giải thích", () => {
    const html = render(<CatalogKanban {...props} kanban={kanban} />, board, ["user"]);
    expect(html).toContain('aria-label="Chuyển sang: P-1"');
    expect(html).not.toContain('aria-label="Chuyển sang: P-2"');
    expect(html).toContain("Giá trị do quy trình đặt, không chuyển tay được.");
    expect(html.match(/draggable="true"/g)).toHaveLength(1);
  });

  it("không khai move hay token thiếu vai trò thì bảng chỉ đọc", () => {
    const readOnly = render(<CatalogKanban {...props} kanban={{ field: "status" }} />, board, ["user"]);
    expect(readOnly).not.toContain("Chuyển sang");
    expect(readOnly).not.toContain('draggable="true"');
    const otherRole = { ...kanban, move: { role: "dispatcher", version: "updated_at" } };
    expect(render(<CatalogKanban {...props} kanban={otherRole} />, board, ["user"])).not.toContain("Chuyển sang");
  });

  it("không thẻ nào thì báo danh sách trống như dạng bảng", () => {
    const html = render(<CatalogKanban {...props} kanban={kanban} />, { c0: [], c1: [], c2: [], cx: [] }, []);
    expect(html).toContain("Chưa có dòng nào.");
  });
});

describe("CatalogCalendar", () => {
  const calendar = { field: "due_on" };
  const today = new Date(2026, 10, 26);
  const rows = {
    rows: [
      { id: 1, code: "P-1", due_on: "2026-11-26" },
      { id: 2, code: "P-2", due_on: "2026-11-03" },
      { id: 3, code: "P-3", due_on: "không rõ" },
    ],
  };

  it("lưới tháng bảy cột từ thứ hai, dòng nằm ở ngày của nó, hôm nay có chữ và aria-current", () => {
    const html = render(<CatalogCalendar {...props} calendar={calendar} today={today} />, rows, []);
    expect(html).toContain("Tháng 11/2026");
    expect(html).toMatch(/<abbr title="Thứ hai"[^>]*>T2<\/abbr>/);
    expect(html).toMatch(/aria-current="date"[^>]*>(?:(?!<\/td>).)*26 \(hôm nay\)(?:(?!<\/td>).)*P-1/);
    expect(html).toMatch(/<a[^>]*href="\/apps\/x\/jobs\/2"[^>]*>P-2<\/a>/);
    expect(html).toContain('aria-label="Lịch theo"');
  });

  it("dòng có ngày không đọc được hiện ở danh sách riêng; không dòng nào thì báo trống", () => {
    const html = render(<CatalogCalendar {...props} calendar={calendar} today={today} />, rows, []);
    expect(html).toMatch(/Không xếp được vào lịch(?:(?!<\/ul>).)*P-3/);
    const empty = render(<CatalogCalendar {...props} calendar={calendar} today={today} />, { rows: [] }, []);
    expect(empty).toContain("Chưa có dòng nào.");
  });
});
