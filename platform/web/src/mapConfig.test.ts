// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử lớp đọc cấu hình của thành phần bản đồ (mapConfig.ts) và cách client GraphQL gắn vai trò (graphql.ts):
// câu truy vấn sinh từ cấu hình, lỗi cấu hình mà schema không bắt được, lớp nào được truy vấn theo vai trò trong
// token, màu, tọa độ và chữ hiện ra của từng dòng, header mà client thật gửi đi. Cấu hình mẫu cùng dạng với
// contracts/examples/map.example.yaml.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createGraphqlClient, withRole } from "./graphql";
import {
  colorOf,
  fieldText,
  type Layer,
  layerQuery,
  type MapConfig,
  mapProblems,
  pointsOf,
  visibleLayers,
} from "./mapConfig";

const sites: Layer = {
  id: "sites",
  label: "Điểm đang dùng",
  source: "app_example_sites",
  latitude: "lat",
  longitude: "lon",
  title: "name",
  where: { field: "status", equals: "active" },
  fields: [{ name: "group.score", label: "Điểm của nhóm", type: "number" }],
  color: {
    by: "group.score",
    label: "Điểm của nhóm",
    steps: [
      { color: "teal", label: "Thấp" },
      { above: 10, color: "orange", label: "Vừa" },
      { above: 20, color: "red", label: "Cao" },
    ],
  },
};
const summary: Layer = {
  id: "summary",
  label: "Tổng hợp",
  source: "app_example_rollup",
  role: "rollup_reader",
  latitude: "lat",
  longitude: "lon",
  title: "name",
  color: { fixed: "gray" },
};
const config: MapConfig = { title: "Bản đồ", layers: [sites, summary] };

describe("layerQuery", () => {
  it("ghép đường dẫn qua quan hệ thành lựa chọn lồng, điều kiện đi qua biến, xin thừa một dòng", () => {
    const { query, variables } = layerQuery(sites);
    expect(query).toBe(
      "query($where: app_example_sites_bool_exp!, $order_by: [app_example_sites_order_by!], $limit: Int!) " +
        "{ rows: app_example_sites(where: $where, order_by: $order_by, limit: $limit) { lat lon name group { score } } }",
    );
    expect(variables).toMatchObject({ where: { status: { _eq: "active" } }, limit: 201 });
  });

  it("xếp theo tên rồi mọi cột đang đọc, kể cả cột qua quan hệ, để các dòng đầu không đổi giữa hai lần tải", () => {
    expect(layerQuery(sites).variables.order_by).toEqual([
      { name: "asc" },
      { lat: "asc" },
      { lon: "asc" },
      { group: { score: "asc" } },
    ]);
  });

  it("điều kiện của dòng đang xem cộng vào where của lớp, cột khóa của liên kết được đọc", () => {
    const fixed = { item_id: { _eq: "a/1" } };
    const linked: Layer = { ...sites, record: { item: "items", column: "item_id" } };
    const { query, variables } = layerQuery(linked, fixed);
    expect(variables.where).toEqual({ _and: [{ status: { _eq: "active" } }, fixed] });
    expect(query).toContain("{ lat lon name group { score } item_id }");
  });

  it("không có where thì lấy mọi dòng, theo trần của lớp", () => {
    expect(layerQuery({ ...summary, limit: 5 }).variables).toMatchObject({ where: {}, limit: 6 });
  });
});

describe("mapProblems", () => {
  it("cấu hình mẫu dùng được", () => {
    expect(mapProblems(config)).toEqual([]);
  });

  it("chặn tên làm đổi nghĩa câu truy vấn, vai trò lạ và tên lớp trùng", () => {
    const broken: MapConfig = {
      title: "x",
      layers: [{ ...summary, source: "a.b", title: "name { id }", role: "Admin\nX" }, { ...summary }],
    };
    expect(mapProblems(broken)).toEqual([
      'hai lớp cùng tên ngắn "summary"',
      'Tổng hợp: "a.b" không phải tên hợp lệ (chỉ chữ không dấu, số, gạch dưới)',
      'Tổng hợp: "name { id }" không phải tên hợp lệ (chỉ chữ không dấu, số, gạch dưới)',
      'Tổng hợp: vai trò "Admin\nX" không hợp lệ',
    ]);
  });

  it("chặn hai vùng cùng tên", () => {
    const outline: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    const items = [
      { name: "Vùng 1", outline },
      { name: "Vùng 1", outline },
    ];
    expect(mapProblems({ ...config, areas: { label: "Ranh giới", color: "indigo", items } })).toEqual([
      'hai vùng cùng tên "Vùng 1"',
    ]);
  });

  it("bậc màu phải tăng dần, bậc đầu không có ngưỡng", () => {
    const steps = [
      { color: "teal", label: "a" },
      { above: 20, color: "red", label: "b" },
      { above: 10, color: "orange", label: "c" },
    ];
    const layer = { ...sites, color: { by: "group.score", label: "x", steps } };
    expect(mapProblems({ title: "x", layers: [layer] })).toEqual([
      "Điểm đang dùng: bậc màu đầu không có above, các bậc sau có above tăng dần",
    ]);
  });
});

describe("visibleLayers", () => {
  it("lớp có vai trò chỉ được truy vấn khi token có vai trò đó", () => {
    expect(visibleLayers(config, ["user"]).map((layer) => layer.id)).toEqual(["sites"]);
    expect(visibleLayers(config, ["user", "rollup_reader"]).map((layer) => layer.id)).toEqual(["sites", "summary"]);
  });
});

describe("colorOf", () => {
  it("chọn bậc cuối cùng có ngưỡng nhỏ hơn giá trị; bằng ngưỡng thì chưa sang bậc", () => {
    const at = (score: unknown) => colorOf(sites.color, { group: { score } }, sites.label).label;
    expect([at(0), at(10), at(10.5), at(25), at("21.00")]).toEqual(["Thấp", "Thấp", "Vừa", "Cao", "Cao"]);
  });

  it("chưa có giá trị thì màu xám, không lẫn với bậc thấp nhất", () => {
    expect(colorOf(sites.color, { group: null }, sites.label)).toEqual({ color: "gray", label: "Chưa có số liệu" });
  });

  it("màu cố định lấy tên lớp làm nhãn", () => {
    expect(colorOf(summary.color, {}, summary.label)).toEqual({ color: "gray", label: "Tổng hợp" });
  });
});

describe("pointsOf", () => {
  it("bỏ dòng thiếu hay sai tọa độ và đếm chúng", () => {
    const rows = [
      { lat: 0.5, lon: 0.25, name: "A", group: { score: 30 } },
      { lat: null, lon: null, name: "B", group: { score: 0 } },
      { lat: 95, lon: 0, name: "C", group: { score: 0 } },
    ];
    const { points, unplaced } = pointsOf(sites, rows);
    expect(points.map((p) => [p.title, p.latitude, p.longitude, p.color])).toEqual([["A", 0.5, 0.25, "red"]]);
    expect(unplaced).toBe(2);
  });
});

describe("fieldText", () => {
  const amount = { name: "a", label: "Giá trị", type: "number" } as const;

  it("trường number viết số và chuỗi thập phân theo kiểu Việt Nam", () => {
    expect([fieldText(amount, 1234.5), fieldText(amount, "1234.50"), fieldText(amount, "21.00")]).toEqual([
      "1.234,5",
      "1.234,5",
      "21",
    ]);
  });

  it("chuỗi không phải số thập phân thường thì để nguyên; trường text giữ cả số 0 ở đầu", () => {
    expect([fieldText(amount, "chưa đo"), fieldText(amount, "1e5"), fieldText(amount, " ")]).toEqual([
      "chưa đo",
      "1e5",
      " ",
    ]);
    expect(fieldText({ name: "code", label: "Mã" }, "00123")).toBe("00123");
  });
});

describe("withRole", () => {
  it("thêm header vai trò mà giữ token", () => {
    expect(withRole({ headers: { Authorization: "Bearer t" } }, "rollup_reader")).toEqual({
      headers: { Authorization: "Bearer t", "X-Hasura-Role": "rollup_reader" },
    });
  });
});

describe("createGraphqlClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Header của yêu cầu mà client thật gửi đi cho một truy vấn với context cho trước. */
  async function sentHeaders(context: Record<string, unknown>) {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => Response.json({ data: { rows: [] } }));
    vi.stubGlobal("fetch", fetch);
    const client = createGraphqlClient(() => "t");
    await client.query("{ rows: example { id } }", {}, context).toPromise();
    return new Headers(fetch.mock.calls[0]?.[1]?.headers);
  }

  it("truy vấn có role gửi kèm X-Hasura-Role mà không mất token", async () => {
    const headers = await sentHeaders({ role: "rollup_reader" });
    expect([headers.get("Authorization"), headers.get("X-Hasura-Role")]).toEqual(["Bearer t", "rollup_reader"]);
  });

  it("truy vấn không có role không gửi header vai trò", async () => {
    const headers = await sentHeaders({});
    expect([headers.get("Authorization"), headers.get("X-Hasura-Role")]).toEqual(["Bearer t", null]);
  });
});
