// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm cách bảng điều hành vẽ dòng đã đọc (DashboardView.tsx): thẻ số có nhãn, số viết kiểu Việt Nam, đơn vị và cách
// tính; nguồn trả nhiều dòng cho thẻ số thì báo cấu hình sai; biểu đồ ẩn phần thanh khỏi trình đọc màn hình và luôn
// kèm bảng số liệu có chú thích; mục "Nguồn" ghi nguyên văn câu truy vấn và biến, hay đường dẫn REST đã gửi; khối
// việc đang chờ người xem nói rõ là của người xem; khối của vai trò khác không hiện. Dựng ra HTML bằng react-dom/server, không cần trình duyệt hay máy chủ.

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

describe("SourceDetails của nguồn REST", () => {
  it("ghi loại nguồn, đường dẫn và các dòng giải thích, không ghi câu GraphQL", () => {
    const counts: Panel = {
      id: "c",
      title: "Hồ sơ",
      description: "Số hồ sơ.",
      role: "manager",
      workflow: { process: "review", counts: "tenant" },
      cards: [{ column: "open", label: "Còn mở", description: "Hồ sơ còn mở." }],
    };
    const out = html(
      <SourceDetails
        panel={counts}
        rest={{ path: "/v1/workflow/processes/review/counts", notes: ["Đếm lúc 9:00."] }}
      />,
    );
    expect(out).toContain("workflow-api");
    expect(out).toContain("GET /v1/workflow/processes/review/counts");
    expect(out).toContain("Đếm lúc 9:00.");
    expect(out).toContain("Khối chỉ hiện với vai trò: manager");
    expect(out).not.toContain("Câu truy vấn");
  });

  it("thẻ và biểu đồ không có dòng thì ghi lời của nguồn", () => {
    expect(html(<CardsView cards={cards} rows={[]} empty="Chưa có số đo" />)).toContain("Chưa có số đo.");
    expect(html(<ChartView chart={chart} rows={[]} title="T" empty="Không có việc nào" />)).toContain(
      "Không có việc nào.",
    );
  });
});

describe("DashboardPanel", () => {
  const config: DashboardConfig = {
    title: "Tổng quan",
    panels: [
      {
        id: "flow",
        title: "Hồ sơ",
        description: "Số hồ sơ.",
        workflow: { process: "review", counts: "mine" },
        cards: [{ column: "open", label: "Đang chờ", description: "Việc đang chờ." }],
      },
      {
        id: "readings",
        title: "Số đo",
        description: "Số đo thiết bị.",
        context: { type: "Device", attribute: "level" },
        chart: {
          type: "bar",
          x: { column: "id", label: "Thiết bị" },
          y: [{ column: "value", label: "Mức", color: "blue" }],
        },
      },
      panel,
      { ...panel, id: "mine", title: "Của tôi", role: undefined },
    ],
  };

  it("khối REST ghi đường dẫn đã gửi, khối việc của người xem nói rõ; khối của vai trò khác không hiện", () => {
    const out = html(<DashboardPanel config={config} app="example" />);
    expect(out).toContain("Số việc đang chờ bạn");
    expect(out).toContain("GET /v1/workflow/tasks");
    expect(out).toContain("GET /v1/context/entities?type=Device&amp;attrs=level&amp;limit=51");
    expect(out).toContain("Khối chỉ hiện với vai trò: user");
    expect(out).toContain("Giá trị: id, value");
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
