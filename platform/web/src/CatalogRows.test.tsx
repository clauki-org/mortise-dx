// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm cách vẽ các dòng của danh sách danh mục (CatalogRows.tsx, ADR 0050): giá trị có tone thành nhãn có chữ, cột đầu
// là liên kết cùng tên ở cả bảng và thẻ, thẻ không có nút riêng, công tắc Bảng/Thẻ là nhóm chọn một có tên, ô "Sắp
// theo" chỉ có ở dạng thẻ. Dựng ra HTML bằng react-dom/server, không cần trình duyệt.

import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { RowsCards, RowsTable, ViewControls } from "./CatalogRows";
import type { CatalogNode, Field } from "./catalog";

const render = (node: ReactNode) =>
  renderToStaticMarkup(
    <MantineProvider>
      <MemoryRouter>{node}</MemoryRouter>
    </MantineProvider>,
  );

const fields: Field[] = [
  { name: "code", label: "Mã" },
  {
    name: "status",
    label: "Tình trạng",
    choices: [
      { value: "active", label: "Đang dùng", tone: "ok" },
      { value: "retired", label: "Ngừng dùng" },
    ],
  },
  { name: "note", label: "Ghi chú" },
];
const config: CatalogNode = { source: "t", fields, list: { columns: ["code", "status", "note"] } };
const rows = [
  { id: 1, code: "A-1", status: "active", note: null },
  { id: 2, code: "A-2", status: "retired", note: "x" },
];
const props = { config, columns: fields, rows, path: "/apps/x/items" };
const noop = () => undefined;
/** Nút chọn một đang được chọn của công tắc, bất kể thứ tự thuộc tính Mantine viết ra. */
const checkedRadio = (html: string) =>
  /value="(\w+)"/.exec(
    [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].find((m) => m[0].includes("checked"))?.[0] ?? "",
  )?.[1];

describe("RowsTable", () => {
  it("cột đầu là liên kết tới chi tiết; giá trị có tone là nhãn có chữ, giá trị không tone là chữ thường", () => {
    const html = render(
      <RowsTable {...props} label="Danh mục" sort={{ field: "code", direction: "asc" }} onSort={noop} />,
    );
    expect(html).toMatch(/<a[^>]*href="\/apps\/x\/items\/1"[^>]*>A-1<\/a>/);
    expect(html).toMatch(/mantine-Badge-root[^>]*>.*Đang dùng/);
    expect(html).not.toMatch(/mantine-Badge-root[^>]*>(?:(?!<\/td>).)*Ngừng dùng/);
    expect(html).toContain("Chưa có");
  });
});

describe("trường tùy chỉnh", () => {
  const power = {
    root_tenant_id: "r",
    source: "t",
    code: "power",
    label: "Công suất",
    kind: "number" as const,
    choices: null,
    required: false,
  };
  const withCustom = { ...props, rows: [{ ...rows[0], custom: { power: 1500 } }], custom: [power] };

  it("bảng có cột sau các cột của gói, tiêu đề không phải nút sắp xếp, giá trị đọc từ custom", () => {
    const html = render(
      <RowsTable {...withCustom} label="Danh mục" sort={{ field: "code", direction: "asc" }} onSort={noop} />,
    );
    expect(html).toMatch(/<th[^>]*><span[^>]*>Công suất<\/span><\/th>/);
    expect(html).toContain("1.500");
  });

  it("thẻ có cặp nhãn, giá trị của trường tùy chỉnh", () => {
    const html = render(<RowsCards {...withCustom} />);
    expect(html).toMatch(/<dt[^>]*>Công suất<\/dt>/);
    expect(html).toContain("1.500");
  });
});

describe("RowsCards", () => {
  it("mỗi dòng một mục danh sách với liên kết cùng chữ như bảng, nhãn và giá trị, không có nút", () => {
    const html = render(<RowsCards {...props} />);
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toMatch(/<ul/);
    expect(html).toMatch(/<a[^>]*href="\/apps\/x\/items\/2"[^>]*>A-2<\/a>/);
    expect(html).toMatch(/<dt[^>]*>Tình trạng<\/dt>/);
    expect(html).toMatch(/mantine-Badge-root[^>]*>.*Đang dùng/);
    expect(html).not.toContain("<button");
  });
});

describe("ViewControls", () => {
  const sort = { field: "status", direction: "desc" as const };

  it("công tắc là nhóm chọn một có tên, đánh dấu đúng dạng đang xem; dạng bảng không có ô sắp xếp", () => {
    const html = render(
      <ViewControls columns={fields} views={["table", "cards"]} view="table" sort={sort} onView={noop} onSort={noop} />,
    );
    expect(html).toMatch(
      /role="radiogroup"[^>]*aria-label="Kiểu hiển thị"|aria-label="Kiểu hiển thị"[^>]*role="radiogroup"/,
    );
    expect(checkedRadio(html)).toBe("table");
    expect(html).not.toContain("Sắp theo");
  });

  it("dạng thẻ có ô Sắp theo mang thứ tự đang áp, mỗi cột tăng và giảm", () => {
    const html = render(
      <ViewControls columns={fields} views={["table", "cards"]} view="cards" sort={sort} onView={noop} onSort={noop} />,
    );
    expect(checkedRadio(html)).toBe("cards");
    expect(html).toContain("Sắp theo");
    expect(html).toMatch(/value="Tình trạng, giảm dần"/);
    expect(html).not.toContain("Kanban");
  });

  it("chỉ có Kanban, Lịch khi được đưa vào; Kanban có ô Sắp theo, lịch thì không", () => {
    const views = ["table", "cards", "kanban", "calendar"] as const;
    const kanban = render(
      <ViewControls columns={fields} views={[...views]} view="kanban" sort={sort} onView={noop} onSort={noop} />,
    );
    expect(checkedRadio(kanban)).toBe("kanban");
    expect(kanban).toContain("Sắp theo");
    expect(kanban).toContain(">Lịch<");
    const calendar = render(
      <ViewControls columns={fields} views={[...views]} view="calendar" sort={sort} onView={noop} onSort={noop} />,
    );
    expect(checkedRadio(calendar)).toBe("calendar");
    expect(calendar).not.toContain("Sắp theo");
  });
});
