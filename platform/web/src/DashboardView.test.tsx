// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm cách bảng điều hành vẽ dòng đã đọc (DashboardView.tsx): thẻ số có nhãn, số viết kiểu Việt Nam, đơn vị và cách
// tính; nguồn trả nhiều dòng cho thẻ số thì báo cấu hình sai; biểu đồ ẩn phần thanh khỏi trình đọc màn hình và luôn
// kèm bảng số liệu có chú thích; mục "Nguồn" ghi nguyên văn câu truy vấn và biến; khối có nguồn chưa hỗ trợ thì báo
// chưa hỗ trợ, khối của vai trò khác không hiện. Dựng ra HTML bằng react-dom/server, không cần trình duyệt hay máy chủ.

import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "oidc-client-ts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { Client, Provider } from "urql";
import { describe, expect, it } from "vitest";
import { DashboardPanel } from "./DashboardPanel";
import { CardsView, ChartView, SourceDetails } from "./DashboardView";
import { type Chart, type DashboardConfig, type Panel, panelQuery } from "./dashboardConfig";
import { SessionContext } from "./session";

// Client không có exchange nào gửi yêu cầu: bài chỉ xem cách vẽ, không gọi mạng.
const client = new Client({ url: "/v1/graphql", exchanges: [] });

function html(node: ReactNode, roles: string[] = ["user"]): string {
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

const cards = [
  { column: "area", label: "Diện tích", unit: "m²", description: "Tổng cột area." },
  { column: "count", label: "Số dòng", format: "integer" as const, description: "Đếm trong view." },
];
const chart: Chart = {
  type: "bar",
  x: { column: "name", label: "Đơn vị" },
  y: [{ column: "value", label: "Giá trị", color: "teal" }],
  details: [
    { column: "basis", label: "Căn cứ" },
    { column: "rate", label: "Mức", format: "number" },
  ],
};
const panel: Panel & { graphql: { field: string } } = {
  id: "p",
  title: "Khối",
  description: "Mô tả nguồn.",
  role: "rollup_reader",
  graphql: { field: "app_example_rollup" },
  chart,
};

describe("CardsView", () => {
  it("mỗi thẻ có nhãn, số kiểu Việt Nam kèm đơn vị và cách tính", () => {
    const out = html(<CardsView cards={cards} rows={[{ area: "1234.50", count: 7 }]} />);
    expect(out).toContain("Diện tích");
    expect(out).toContain("1.234,5 m²");
    expect(out).toContain("Cách tính: Tổng cột area.");
    expect(out).toContain(">7<");
  });

  it("không dòng là chưa có số liệu; nhiều dòng là cấu hình sai, không chọn đại một dòng", () => {
    expect(html(<CardsView cards={cards} rows={[]} />)).toContain("Chưa có số liệu");
    const out = html(<CardsView cards={cards} rows={[{ area: 1 }, { area: 2 }]} />);
    expect(out).toContain("Cấu hình khối sai");
    expect(out).not.toContain("Cách tính");
  });
});

describe("ChartView", () => {
  it("phần thanh ẩn khỏi trình đọc màn hình; bảng số liệu có chú thích, số và cột chi tiết", () => {
    const out = html(
      <ChartView chart={chart} rows={[{ name: "A", value: 1500, basis: "001", rate: "20.00" }]} title="Khối" />,
    );
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain("var(--mantine-color-teal-6)");
    expect(out).toContain("<caption");
    expect(out).toContain("Số liệu của biểu đồ");
    expect(out).toContain("1.500");
    // Cột chi tiết không khai format hiện nguyên văn; khai format thì viết như số.
    expect(out).toContain(">001<");
    expect(out).toContain(">20<");
  });
});

describe("SourceDetails", () => {
  it("ghi loại nguồn, bảng, cột, vai trò, nguyên văn câu truy vấn và biến đã gửi", () => {
    const request = panelQuery(panel);
    const out = html(<SourceDetails panel={panel} request={request} />);
    expect(out).toContain("<details");
    expect(out).toContain("app_example_rollup");
    expect(out).toContain("Cột: name, value, basis, rate");
    expect(out).toContain("Vai trò: rollup_reader");
    // Câu như urql gửi: in lại nhiều dòng, có thêm __typename của cacheExchange.
    expect(out).toContain("rows: app_example_rollup(where: $where, order_by: $order_by, limit: $limit) {");
    expect(out).toContain("__typename");
    expect(out).toContain("&quot;limit&quot;:51");
  });
});

describe("DashboardPanel", () => {
  const config: DashboardConfig = {
    title: "Tổng quan",
    panels: [
      { id: "flow", title: "Hồ sơ", description: "Số hồ sơ.", workflow: {}, cards },
      panel,
      { ...panel, id: "mine", title: "Của tôi", role: undefined },
    ],
  };

  it("nguồn chưa hỗ trợ thì báo; khối của vai trò khác không hiện", () => {
    const out = html(<DashboardPanel config={config} app="example" />);
    expect(out).toContain("Nguồn chưa hỗ trợ");
    expect(out).toContain("Của tôi");
    expect(out).not.toContain("rollup_reader");
  });

  it("cấu hình sai thì không truy vấn khối nào mà báo lỗi", () => {
    const out = html(
      <DashboardPanel config={{ ...config, panels: [{ ...panel, role: "Bad Role" }] }} app="example" />,
      ["Bad Role"],
    );
    expect(out).toContain("Cấu hình bảng điều hành sai");
  });
});
