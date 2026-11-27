// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm cách bảng điều hành vẽ dòng đã đọc (DashboardView.tsx): thẻ số có nhãn, số viết kiểu Việt Nam và đơn vị, cách
// tính không nằm trên thẻ; nguồn trả nhiều dòng cho thẻ số thì báo cấu hình sai; biểu đồ ẩn phần thanh khỏi trình đọc
// màn hình, ghi số trên từng thanh kể cả số 0, có thang, và luôn kèm bảng số liệu có chú thích; mục "Xem cách tính"
// ghi cách tính của khối và thẻ, nguyên văn câu truy vấn và biến, hay đường dẫn REST đã gửi; thẻ có mức độ mang màu
// và chữ của mức; vòng đo có tên đọc được gồm phần trăm và hai số gốc; biểu đồ có trần; khối xếp đúng thứ tự khai
// trên lưới bốn cột; khối việc đang chờ người xem nói rõ là của người xem; khối của vai trò khác không hiện. Dựng ra HTML bằng
// react-dom/server, không cần trình duyệt hay máy chủ.

import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "oidc-client-ts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { Client, Provider } from "urql";
import { describe, expect, it } from "vitest";
import { DashboardPanel } from "./DashboardPanel";
import { CardsView, ChartView, MethodDetails } from "./DashboardView";
import { type Card, type Chart, type DashboardConfig, type Panel, panelQuery } from "./dashboardConfig";
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

const cards: Card[] = [
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
  description: "Mô tả cho người xem.",
  method: "View tổng hợp, mỗi đơn vị một dòng.",
  role: "rollup_reader",
  graphql: { field: "app_example_rollup" },
  chart,
};

describe("CardsView", () => {
  it("mỗi thẻ có nhãn, số kiểu Việt Nam liền đơn vị; cách tính không nằm trên thẻ", () => {
    const out = html(<CardsView cards={cards} rows={[{ area: "1234.50", count: 7 }]} />);
    expect(out).toContain("Diện tích");
    expect(out).toContain(">1.234,5 m²<");
    expect(out).toContain(">7<");
    expect(out).not.toContain("Tổng cột area.");
  });

  it("thẻ của khối chính dùng cỡ chữ lớn nhất của theme", () => {
    const out = html(<CardsView cards={cards} rows={[{ area: 1, count: 2 }]} large />);
    expect(out).toContain("var(--mantine-h1-font-size)");
    expect(html(<CardsView cards={cards} rows={[{ area: 1, count: 2 }]} />)).not.toContain("h1-font-size");
  });

  it("thẻ khớp mức độ có viền, số màu của nghĩa và chữ của mức; không khớp thì không màu, không chữ", () => {
    const toned: Card[] = [
      {
        ...(cards[0] as Card),
        tone: { warn_when: { gt: 0, label: "Cần để ý" }, bad_when: { gt: 100, label: "Vượt" } },
      },
    ];
    const bad = html(<CardsView cards={toned} rows={[{ area: 420 }]} />);
    expect(bad).toContain("var(--mantine-color-red-light-color)");
    expect(bad).toContain(">Vượt<");
    expect(bad).not.toContain("Cần để ý");
    const warn = html(<CardsView cards={toned} rows={[{ area: 5 }]} />);
    expect(warn).toContain("var(--mantine-color-orange-light-color)");
    expect(warn).toContain(">Cần để ý<");
    const calm = html(<CardsView cards={toned} rows={[{ area: 0 }]} />);
    expect(calm).not.toContain("light-color");
    expect(calm).not.toContain("Cần để ý");
  });

  it("vòng đo có tên đọc được gồm nhãn của gói, phần trăm của view và hai số gốc của thẻ", () => {
    const gauge = { value: "area", limit: "count", percent: "pct", label: "Đang dùng so với được phép" };
    const out = html(<CardsView cards={cards} rows={[{ area: 1000, count: 580, pct: 172 }]} gauge={gauge} />);
    expect(out).toContain('role="img" aria-label="Đang dùng so với được phép: 172%. Diện tích 1.000 m²; Số dòng 580."');
    expect(out).toContain(">172%<");
    // Hai vòng: vòng ngoài đầy, vòng trong là phần trên 100%.
    expect(out.match(/stroke-dasharray/g)).toHaveLength(2);
    const empty = html(<CardsView cards={cards} rows={[{ area: 0, count: 0, pct: null }]} gauge={gauge} />);
    expect(empty).toContain(": Chưa có số liệu.");
    expect(empty).not.toContain("stroke-dasharray");
  });

  it("không dòng là chưa có số liệu; nhiều dòng là cấu hình sai, không chọn đại một dòng", () => {
    expect(html(<CardsView cards={cards} rows={[]} />)).toContain("Chưa có số liệu");
    const out = html(<CardsView cards={cards} rows={[{ area: 1 }, { area: 2 }]} />);
    expect(out).toContain("Cấu hình khối sai");
    expect(out).not.toContain('role="group"');
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
    // Bảng luôn có trong trang nhưng thu gọn, vì các thanh đã ghi số.
    expect(out).toMatch(/<details[^>]*><summary[^>]*><span[^>]*>Xem bảng số liệu<\/span><\/summary>/);
  });

  it("mỗi thanh ghi số của nó; số 0 vẫn có vạch và chữ 0; thang từ 0 tới số lớn nhất", () => {
    const two: Chart = {
      ...chart,
      y: [
        { column: "value", label: "Được phép", color: "teal" },
        { column: "used", label: "Đang dùng", color: "blue" },
      ],
    };
    const out = html(
      <ChartView
        chart={two}
        rows={[
          { name: "A", value: 1500, used: 0 },
          { name: "B", value: 750, used: null },
        ]}
        title="Khối"
      />,
    );
    const bars = out.slice(0, out.indexOf("<details"));
    expect(bars).toContain(">1.500<");
    expect(bars).toContain(">750<");
    expect(bars).toContain(">0<");
    expect(bars).toContain("width:max(0%, 2px)");
    expect(bars).toContain("width:max(50%, 2px)");
    // Ô trống không vẽ thanh, chỉ ghi chữ; thang có đầu 0 và đầu 1.500.
    expect(bars.match(/width:max\(/g)).toHaveLength(3);
    expect(bars).toContain("Chưa có số liệu");
    expect(bars.match(/>1\.500</g)).toHaveLength(2);
    // Hai cột số thì có chú giải màu.
    expect(bars).toContain("var(--mantine-color-blue-6)");
  });

  it("biểu đồ có trần: thanh theo trần của gói, thang kết thúc ở trần, số trên thanh vẫn đúng", () => {
    const out = html(<ChartView chart={{ ...chart, max: 100 }} rows={[{ name: "A", value: 81 }]} title="Khối" />);
    const bars = out.slice(0, out.indexOf("<details"));
    expect(bars).toContain("width:max(81%, 2px)");
    expect(bars).toContain(">81<");
    expect(bars).toContain(">100<");
  });

  it("mã máy trên trục thành số thứ tự trên thanh, mã gốc còn trong bảng; khung cuộn của bảng nhận focus", () => {
    const axis: Chart = {
      ...chart,
      x: { column: "name", label: "Thiết bị", choices: [{ value: "m2", label: "Kho" }] },
    };
    const out = html(<ChartView chart={axis} rows={[{ name: "m1" }, { name: "m2" }]} title="Đo" ordinal />);
    const bars = out.slice(0, out.indexOf("<details"));
    expect(bars).toContain(">Thiết bị 1<");
    expect(bars).toContain(">Kho<");
    expect(bars).not.toContain(">m1<");
    expect(out.slice(out.indexOf("<details"))).toContain(">m1<");
    expect(out).toContain('tabindex="0" role="group" aria-label="Bảng số liệu của biểu đồ &quot;Đo&quot;"');
  });
});

describe("MethodDetails", () => {
  it("một mục thu gọn ghi cách tính, loại nguồn, bảng, cột, vai trò, nguyên văn câu truy vấn và biến đã gửi", () => {
    const request = panelQuery(panel);
    const out = html(<MethodDetails panel={panel} request={request} />);
    expect(out.match(/<details/g)).toHaveLength(1);
    expect(out).toContain("Xem cách tính");
    expect(out).toContain("View tổng hợp, mỗi đơn vị một dòng.");
    expect(out).toContain("app_example_rollup");
    expect(out).toContain("Cột: name, value, basis, rate");
    expect(out).toContain("Vai trò: rollup_reader");
    // Câu như urql gửi: in lại nhiều dòng, có thêm __typename của cacheExchange.
    expect(out).toContain("rows: app_example_rollup(where: $where, order_by: $order_by, limit: $limit) {");
    expect(out).toContain("__typename");
    expect(out).toContain("&quot;limit&quot;:51");
  });
});

describe("MethodDetails của nguồn REST", () => {
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
      <MethodDetails
        panel={counts}
        rest={{ path: "/v1/workflow/processes/review/counts", notes: ["Đếm lúc 9:00."] }}
      />,
    );
    expect(out).toContain("workflow-api");
    expect(out).toContain("GET /v1/workflow/processes/review/counts");
    expect(out).toContain("Đếm lúc 9:00.");
    expect(out).toContain("Khối chỉ hiện với vai trò: manager");
    expect(out).not.toContain("Câu truy vấn");
    // Cách tính của từng thẻ nằm trong mục này, kèm nhãn của thẻ.
    expect(out).toContain("Còn mở:</span> Hồ sơ còn mở.");
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

  it("khối xếp đúng thứ tự khai; bề rộng tính trên khối người xem thấy, khối bị ẩn không để ô trống", () => {
    const main: Panel = {
      id: "main",
      title: "Chính",
      description: "Số chính.",
      primary: true,
      size: "half",
      graphql: { field: "app_example_totals" },
      cards,
    };
    const block = (id: string, size: Panel["size"], role?: string): Panel => ({
      ...panel,
      id,
      title: id,
      size,
      role,
    });
    const out = html(
      <DashboardPanel
        config={{
          title: "Tổng quan",
          panels: [main, block("Một", "quarter"), block("Ẩn", "quarter", "rollup_reader"), block("Hai", "half")],
        }}
        app="example"
      />,
    );
    // Lưới 12 phần: trên màn hình rộng khối "Một" nới từ 3 ra 6 phần vì khối "Ẩn" sau nó không hiện, "Hai" cả hàng.
    const wide = (title: string) =>
      out.match(
        new RegExp(`75em\\)\\{[^}]*--col-flex-basis:([^;]*);[^<]*</style><div[^>]*><section[^>]*aria-label="${title}"`),
      )?.[1];
    expect([wide("Chính"), wide("Một"), wide("Hai")]).toEqual([
      "calc(50% - 0.5 * var(--grid-column-gap))",
      "calc(50% - 0.5 * var(--grid-column-gap))",
      "100%",
    ]);
    expect(out).not.toContain('aria-label="Ẩn"');
    const order = ["Chính", "Một", "Hai"].map((title) => out.indexOf(`aria-label="${title}"`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("cấu hình sai thì không truy vấn khối nào mà báo lỗi", () => {
    const out = html(
      <DashboardPanel config={{ ...config, panels: [{ ...panel, role: "Bad Role" }] }} app="example" />,
      ["Bad Role"],
    );
    expect(out).toContain("Cấu hình bảng điều hành sai");
  });
});
