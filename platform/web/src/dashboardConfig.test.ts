// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử lớp đọc cấu hình của bảng điều hành (dashboardConfig.ts): câu truy vấn sinh từ cấu hình, lỗi cấu hình mà
// schema không bắt được, khối nào được truy vấn theo vai trò trong token, khối chính lên đầu, cách viết số, độ dài và
// chữ số của thanh, đầu mút của thang. Cấu hình mẫu
// cùng dạng với contracts/examples/dashboard.example.yaml.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  barMarks,
  barPercents,
  categoryText,
  type DashboardConfig,
  dashboardProblems,
  type GraphqlSource,
  numberText,
  orderedPanels,
  type Panel,
  panelQuery,
  queryErrorText,
  scaleTop,
  sentText,
  visiblePanels,
} from "./dashboardConfig";
import { createGraphqlClient } from "./graphql";

const totals: Panel & { graphql: GraphqlSource } = {
  id: "totals",
  title: "Tổng",
  description: "View tổng của đơn vị.",
  graphql: { field: "app_example_totals", where: { field: "status", equals: "active" } },
  cards: [
    { column: "item_count", label: "Số đối tượng", format: "integer", description: "Đếm mọi dòng." },
    { column: "score", label: "Điểm", description: "Tổng điểm." },
  ],
};
const children: Panel & { graphql: GraphqlSource } = {
  id: "children",
  title: "Đơn vị con",
  description: "View tổng hợp.",
  role: "rollup_reader",
  graphql: { field: "app_example_rollup", limit: 20 },
  chart: {
    type: "bar",
    x: { column: "unit_name", label: "Đơn vị", choices: [{ value: "u1", label: "Đơn vị một" }] },
    y: [
      { column: "score", label: "Điểm", color: "teal" },
      { column: "target", label: "Chỉ tiêu", color: "gray" },
    ],
    details: [{ column: "basis", label: "Căn cứ" }],
  },
};
const config: DashboardConfig = { title: "Tổng quan", panels: [totals, children] };

describe("panelQuery", () => {
  it("thẻ số xin hai dòng, điều kiện đi qua biến, không xếp", () => {
    expect(panelQuery(totals)).toEqual({
      query:
        "query($where: app_example_totals_bool_exp!, $order_by: [app_example_totals_order_by!], $limit: Int!) " +
        "{ rows: app_example_totals(where: $where, order_by: $order_by, limit: $limit) { item_count score } }",
      variables: { where: { status: { _eq: "active" } }, order_by: [], limit: 2 },
    });
  });

  it("biểu đồ đọc trục x, cột số, cột chi tiết, xin thừa một dòng và mặc định xếp theo các cột đó", () => {
    const { query, variables } = panelQuery(children);
    expect(query).toContain("{ unit_name score target basis }");
    expect(variables).toEqual({
      where: {},
      order_by: [{ unit_name: "asc" }, { score: "asc" }, { target: "asc" }, { basis: "asc" }],
      limit: 21,
    });
  });

  it("order_by của gói thay thứ tự mặc định", () => {
    const ordered = {
      ...children,
      graphql: { field: "app_example_rollup", order_by: [{ column: "score", direction: "desc" as const }] },
    };
    expect(panelQuery(ordered).variables).toMatchObject({ order_by: [{ score: "desc" }], limit: 51 });
  });
});

describe("dashboardProblems", () => {
  it("cấu hình mẫu dùng được", () => {
    expect(dashboardProblems(config)).toEqual([]);
  });

  it("chặn tên làm đổi nghĩa câu truy vấn, vai trò lạ, màu ngoài bảng màu, khối trùng tên, cột số trùng", () => {
    const broken: DashboardConfig = {
      title: "x",
      panels: [
        { ...totals, graphql: { field: "t", where: { field: "a } b {", equals: "x" } } },
        { ...totals, role: "Admin" },
        {
          ...children,
          chart: {
            type: "bar",
            x: { column: "n", label: "N" },
            y: [
              { column: "v", label: "V", color: "#f00" },
              { column: "v", label: "W", color: "red" },
            ],
          },
        },
      ],
    };
    expect(dashboardProblems(broken)).toEqual([
      'hai khối cùng tên ngắn "totals"',
      'Tổng: "a } b {" không phải tên hợp lệ (chỉ chữ không dấu, số, gạch dưới)',
      'Tổng: vai trò "Admin" không hợp lệ',
      'Đơn vị con: màu "#f00" không có trong bảng màu',
      "Đơn vị con: một cột khai hai lần trong chart.y",
    ]);
  });

  it("tối đa một khối chính, là thẻ số và rộng cả hàng", () => {
    const main = { ...totals, primary: true };
    expect(dashboardProblems({ title: "x", panels: [main, children] })).toEqual([]);
    expect(
      dashboardProblems({
        title: "x",
        panels: [
          { ...main, size: "half" },
          { ...children, primary: true },
        ],
      }),
    ).toEqual([
      "Tổng: khối chính phải là thẻ số và rộng cả hàng",
      "Đơn vị con: khối chính phải là thẻ số và rộng cả hàng",
      "có hơn một khối chính",
    ]);
  });
});

describe("orderedPanels", () => {
  it("khối chính lên đầu, các khối khác giữ thứ tự khai", () => {
    const third = { ...totals, id: "third" };
    const ids = orderedPanels([children, third, { ...totals, primary: true }]).map((panel) => panel.id);
    expect(ids).toEqual(["totals", "children", "third"]);
  });
});

describe("visiblePanels", () => {
  it("khối không khai vai trò cần user; khối khai vai trò cần đúng vai trò đó", () => {
    expect(visiblePanels(config, ["user"]).map((panel) => panel.id)).toEqual(["totals"]);
    expect(visiblePanels(config, ["user", "rollup_reader"]).map((panel) => panel.id)).toEqual(["totals", "children"]);
    expect(visiblePanels(config, ["rollup_reader"]).map((panel) => panel.id)).toEqual(["children"]);
  });
});

describe("numberText", () => {
  it("viết số và chuỗi thập phân theo kiểu Việt Nam; integer làm tròn; ô trống là chưa có số liệu", () => {
    expect(numberText(1234.5)).toBe("1.234,5");
    expect(numberText("1234.50")).toBe("1.234,5");
    expect(numberText("1000", "integer")).toBe("1.000");
    expect(numberText(2.6, "integer")).toBe("3");
    expect(numberText(null)).toBe("Chưa có số liệu");
    expect(numberText("")).toBe("Chưa có số liệu");
  });

  it("không đổi chuỗi lạ thành số", () => {
    expect(numberText("1e5")).toBe("1e5");
    expect(numberText("0x10")).toBe("0x10");
  });
});

describe("barPercents và categoryText", () => {
  it("mọi cột số chung một thang; giá trị âm hay không phải số thành thanh rỗng", () => {
    const chart = children.chart ?? totals.chart;
    if (!chart) throw new Error("thiếu biểu đồ mẫu");
    expect(
      barPercents(chart, [
        { score: 50, target: "200" },
        { score: -5, target: "abc" },
      ]),
    ).toEqual([
      [25, 100],
      [0, 0],
    ]);
    expect(barPercents(chart, [{ score: 0, target: 0 }])).toEqual([[0, 0]]);
    expect(categoryText(chart, "u1")).toBe("Đơn vị một");
    expect(categoryText(chart, "u2")).toBe("u2");
  });

  it("thanh có số, kể cả 0, thì được vẽ và ghi số; ô trống không vẽ; thang tới số lớn nhất", () => {
    const chart = children.chart;
    if (!chart) throw new Error("thiếu biểu đồ mẫu");
    const rows = [
      { score: 0, target: "1500.5" },
      { score: null, target: 300 },
    ];
    expect(barMarks(chart, rows)).toEqual([
      [
        { percent: 0, text: "0", drawn: true },
        { percent: 100, text: "1.500,5", drawn: true },
      ],
      [
        { percent: 0, text: "Chưa có số liệu", drawn: false },
        { percent: (300 / 1500.5) * 100, text: "300", drawn: true },
      ],
    ]);
    expect(scaleTop(chart, rows)).toBe(1500.5);
    expect(scaleTop(chart, [{ score: -5, target: null }])).toBe(0);
  });
});

describe("sentText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("đúng từng ký tự với câu mà client thật gửi đi, để mục Nguồn không ghi một câu khác", async () => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => Response.json({ data: { rows: [] } }));
    vi.stubGlobal("fetch", fetch);
    const { query, variables } = panelQuery(children);
    await createGraphqlClient(() => "t")
      .query(query, variables, { role: "rollup_reader", requestPolicy: "network-only" })
      .toPromise();
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).query).toBe(sentText(query));
  });
});

describe("queryErrorText", () => {
  it("lỗi do cấu hình nêu vai trò và where.equals cần sửa, dẫn tới người quản trị", () => {
    const text = queryErrorText(totals, ["validation-failed"], 'expected a boolean for type "Boolean"');
    expect(text).toContain("vai trò user");
    expect(text).toContain('where.equals "active" không hợp kiểu của cột status');
    expect(text).toContain("Báo người quản trị sửa cấu hình của gói");
  });

  it("lỗi khác bảo tải lại trang", () => {
    expect(queryErrorText(children, [], "Failed to fetch")).toBe(
      "Failed to fetch. Tải lại trang; nếu vẫn lỗi, báo người quản trị.",
    );
  });
});
