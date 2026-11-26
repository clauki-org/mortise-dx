// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm đầu trang và nhãn trạng thái dùng chung: tiêu đề là h1 duy nhất, giữ nguyên chữ của cấu hình; đường về, mô tả,
// việc chính đứng đúng chỗ; mỗi nghĩa của StatusBadge một màu riêng; vùng cuộn của bảng có nhãn và tiêu điểm. Dựng ra HTML bằng react-dom/server.

import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";
import { StatusBadge, type Tone } from "./StatusBadge";
import { Blank, keepTogether, TableScroll } from "./TableScroll";

const render = (node: ReactNode) => renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);

describe("PageHeader", () => {
  it("tiêu đề là h1 duy nhất, đường về đứng trước, việc chính đứng sau", () => {
    const html = render(
      <PageHeader
        before={<a href="/x">Về danh sách</a>}
        title="Cơ sở nhà, đất"
        description="Mô tả ngắn"
        action={<button type="button">Việc chính</button>}
      />,
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Cơ sở nhà, đất<\/h1>/);
    expect(html.indexOf("Về danh sách")).toBeLessThan(html.indexOf("<h1"));
    expect(html.indexOf("Mô tả ngắn")).toBeGreaterThan(html.indexOf("<h1"));
    expect(html.indexOf("Việc chính")).toBeGreaterThan(html.indexOf("Mô tả ngắn"));
  });

  it("không có mô tả thì không có dòng trống", () => {
    expect(render(<PageHeader title="T" />)).not.toContain("<p");
  });
});

describe("StatusBadge", () => {
  it("mỗi nghĩa một màu", () => {
    const tones: Tone[] = ["overdue", "active", "done", "neutral"];
    const colors = tones.map(
      (tone) => render(<StatusBadge tone={tone}>x</StatusBadge>).match(/color-(\w+)-light/)?.[1],
    );
    expect(colors).toEqual(["red", "blue", "green", "gray"]);
  });
});

describe("TableScroll", () => {
  it("vùng cuộn có nhãn và nhận tiêu điểm bàn phím", () => {
    const html = render(
      <TableScroll label="Cơ sở nhà, đất" minWidth={480}>
        <table />
      </TableScroll>,
    );
    expect(html).toMatch(/role="region"/);
    expect(html).toContain('aria-label="Cơ sở nhà, đất"');
    expect(html).toContain('tabindex="0"');
  });

  it("giá trị trống là gạch mờ, trình đọc màn hình đọc Chưa có", () => {
    const html = render(<Blank />);
    expect(html).toMatch(/aria-hidden="true"[^>]*>—</);
    expect(html).toContain("Chưa có");
  });

  it("mã ngắn không xuống dòng, câu có khoảng trắng thì được", () => {
    expect(keepTogether("TS-A1")).toBe(true);
    expect(keepTogether("Trụ sở xã")).toBe(false);
  });
});
