// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử lớp đọc cấu hình của thành phần bản đồ (mapConfig.ts) và cách client GraphQL gắn vai trò (graphql.ts):
// câu truy vấn sinh từ cấu hình, lỗi cấu hình mà schema không bắt được, lớp nào được truy vấn theo vai trò trong
// token, màu và tọa độ của từng dòng. Cấu hình mẫu cùng dạng với contracts/examples/map.example.yaml.

import { describe, expect, it } from "vitest";
import { withRole } from "./graphql";
import { colorOf, type Layer, layerQuery, type MapConfig, mapProblems, pointsOf, visibleLayers } from "./mapConfig";

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
      "query($where: app_example_sites_bool_exp!, $limit: Int!) { rows: app_example_sites(where: $where, limit: $limit) { lat lon name group { score } } }",
    );
    expect(variables).toEqual({ where: { status: { _eq: "active" } }, limit: 201 });
  });

  it("không có where thì lấy mọi dòng, theo trần của lớp", () => {
    expect(layerQuery({ ...summary, limit: 5 }).variables).toEqual({ where: {}, limit: 6 });
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

describe("withRole", () => {
  it("thêm header vai trò mà giữ token", () => {
    expect(withRole({ headers: { Authorization: "Bearer t" } }, "rollup_reader")).toEqual({
      headers: { Authorization: "Bearer t", "X-Hasura-Role": "rollup_reader" },
    });
  });
});
