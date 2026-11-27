// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm phần vẽ của trang "Ứng dụng" (AppsPage.tsx, ADR 0065): mỗi gói một thẻ có tên, mô tả, gói cần, trạng thái bằng
// chữ và nút có tên đọc được; nút bị khóa thì lý do hiện ngay dưới thẻ và nối với nút; lời từ chối của CSDL hiện thành
// cảnh báo. Dựng ra HTML bằng react-dom/server, không cần trình duyệt.

import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PackageCard, PackageList } from "./AppsPage";
import type { PackageRow } from "./apps";

const html = (node: ReactNode) =>
  renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>).replace(/<style[^>]*>[^<]*<\/style>/g, "");

const base: PackageRow = { app: "base", name: "Gói nền", description: "Mô tả nền", requires: [], enabled: true };
const top: PackageRow = { app: "top", name: "Gói trên", description: null, requires: ["base"], enabled: true };
const noop = () => {};

/** Thẻ input của nút bật, tắt trong HTML. */
const switchOf = (page: string) => page.match(/<input[^>]*role="switch"[^>]*>/)?.[0] ?? "";

describe("PackageCard", () => {
  it("tên, mô tả, trạng thái bằng chữ, nút có tên theo gói", () => {
    const page = html(<PackageCard row={base} rows={[base]} busy={false} refusal={null} onChange={noop} />);
    expect(page).toContain("Gói nền");
    expect(page).toContain("Mô tả nền");
    expect(page).toContain("Đang bật");
    expect(page).toContain("Không cần gói nào khác");
    expect(switchOf(page)).toContain('aria-label="Bật gói Gói nền"');
    expect(switchOf(page)).not.toContain("disabled");
  });

  it("gói đang bật khác cần thì nút bị khóa, lý do hiện và nối với nút", () => {
    const page = html(<PackageCard row={base} rows={[base, top]} busy={false} refusal={null} onChange={noop} />);
    const input = switchOf(page);
    expect(input).toContain("disabled");
    const described = input.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(described).toBeDefined();
    expect(page).toContain(`id="${described}"`);
    expect(page).toContain("Chưa tắt được: Gói đang bật Gói trên cần gói này; tắt các gói đó trước.");
  });

  it("gói cần ghi theo tên hiển thị; gói tắt ghi Đã tắt", () => {
    const off = { ...top, enabled: false };
    const page = html(<PackageCard row={off} rows={[base, off]} busy={false} refusal={null} onChange={noop} />);
    expect(page).toContain("Cần: Gói nền");
    expect(page).toContain("Đã tắt");
  });

  it("lời từ chối của CSDL hiện thành cảnh báo", () => {
    const page = html(<PackageCard row={base} rows={[base]} busy={false} refusal="Lý do thử" onChange={noop} />);
    expect(page).toContain('role="alert"');
    expect(page).toContain("Lý do thử");
  });
});

describe("PackageList", () => {
  it("chưa có gói thì báo rỗng kèm cách làm", () => {
    const page = html(<PackageList rows={[]} busy={null} refusals={new Map()} onChange={noop} />);
    expect(page).toContain("Chưa có gói nào trong danh sách.");
  });

  it("đang ghi thì mọi nút bị khóa để không gửi hai lần cùng lúc", () => {
    const page = html(
      <PackageList
        rows={[base, { ...top, app: "x", requires: [] }]}
        busy="base"
        refusals={new Map()}
        onChange={noop}
      />,
    );
    const inputs = page.match(/<input[^>]*role="switch"[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    for (const input of inputs) expect(input).toContain("disabled");
  });
});
