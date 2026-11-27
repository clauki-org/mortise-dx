// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử lớp đọc cấu hình của thành phần danh mục (catalog.ts): câu truy vấn và biến sinh ra từ cấu hình, lỗi cấu
// hình mà schema không bắt được, trạng thái danh sách trên thanh địa chỉ, cách hiện giá trị. Cấu hình mẫu cùng dạng
// với contracts/examples/catalog.example.yaml.

import { describe, expect, it } from "vitest";
import { type CatalogConfig, type Child, configProblems, display, resolvePath, toneOf } from "./catalog";
import {
  chainQuery,
  chainVariables,
  emptyState,
  listVariables,
  readState,
  rowsQuery,
  sortOf,
  writeState,
} from "./catalogQuery";

const checks: Child = {
  id: "checks",
  label: "Lần kiểm",
  via: "part_id",
  source: "app_example_checks",
  key: "check_no",
  fields: [{ name: "result", label: "Kết quả" }],
  list: { columns: ["result"] },
};

const parts: Child = {
  id: "parts",
  label: "Thành phần",
  via: "item_id",
  source: "app_example_parts",
  fields: [{ name: "name", label: "Tên" }],
  list: { columns: ["name"] },
  detail: { children: [checks] },
};

const config: CatalogConfig = {
  title: "Danh mục",
  source: "app_example_items",
  fields: [
    { name: "code", label: "Mã" },
    { name: "name", label: "Tên" },
    {
      name: "status",
      label: "Tình trạng",
      choices: [
        { value: "active", label: "Đang dùng", tone: "ok" },
        { value: "retired", label: "Ngừng dùng" },
      ],
    },
    { name: "quantity", label: "Số lượng", type: "number" },
    { name: "created_at", label: "Ngày tạo", type: "datetime" },
  ],
  list: { columns: ["code", "name", "status", "quantity"], search: ["code", "name"], filters: ["status"] },
  detail: { title: "name", children: [parts] },
};

describe("rowsQuery", () => {
  it("chỉ ghép tên từ cấu hình, luôn chọn khóa, không chọn một cột hai lần", () => {
    expect(rowsQuery(config, ["code", "name", "code"])).toBe(
      "query($where: app_example_items_bool_exp!, $order_by: [app_example_items_order_by!], $limit: Int!, " +
        "$offset: Int!) { rows: app_example_items(where: $where, order_by: $order_by, limit: $limit, " +
        "offset: $offset) { id code name } }",
    );
  });

  it("dùng khóa do cấu hình khai", () => {
    expect(rowsQuery({ ...config, key: "code" }, ["name"])).toContain("{ code name }");
    const steps = resolvePath({ ...config, key: "code" }, ["A-1"]) ?? [];
    expect(chainVariables(steps)).toEqual({ w0: { _and: [{ code: { _eq: "A-1" } }] } });
  });
});

describe("listVariables", () => {
  it("mặc định: không điều kiện, xếp theo cột đầu rồi tới khóa, xin thừa một dòng", () => {
    expect(listVariables(config, emptyState)).toEqual({
      where: { _and: [] },
      order_by: [{ code: "asc_nulls_last" }, { id: "asc" }],
      limit: 21,
      offset: 0,
    });
  });

  it("ghép điều kiện cố định, ô tìm và ô lọc; chữ người dùng gõ chỉ nằm trong biến", () => {
    const state = { search: " 50%_a\\ ", filters: { status: "retired", name: "bỏ qua" }, page: 2 };
    const variables = listVariables({ ...config, list: { ...config.list, page_size: 5 } }, state, {
      parent_id: { _eq: "p1" },
    });
    expect(variables.where).toEqual({
      _and: [
        { parent_id: { _eq: "p1" } },
        // % và _ là ký tự đại diện của phép so mẫu, \ là ký tự thoát: cả ba được thoát để khớp đúng chữ đã gõ.
        { _or: [{ code: { _ilike: "%50\\%\\_a\\\\%" } }, { name: { _ilike: "%50\\%\\_a\\\\%" } }] },
        // Chỉ trường khai trong list.filters mới thành điều kiện; khóa lạ trên thanh địa chỉ bị bỏ qua.
        { status: { _eq: "retired" } },
      ],
    });
    expect(variables).toMatchObject({ limit: 6, offset: 10 });
  });

  it("xếp giảm dần vẫn để dòng chưa có giá trị ở cuối", () => {
    const state = { ...emptyState, sort: { field: "quantity", direction: "desc" as const } };
    expect(listVariables(config, state).order_by).toEqual([{ quantity: "desc_nulls_last" }, { id: "asc" }]);
  });

  it("thứ tự của người dùng chỉ được nhận khi trỏ tới một cột đang hiện", () => {
    const sorted = { ...config, list: { ...config.list, sort: { field: "name", direction: "desc" as const } } };
    expect(sortOf(sorted, emptyState)).toEqual({ field: "name", direction: "desc" });
    expect(sortOf(sorted, { ...emptyState, sort: { field: "quantity" } })).toEqual({
      field: "quantity",
      direction: "asc",
    });
    expect(sortOf(sorted, { ...emptyState, sort: { field: "tenant_id", direction: "asc" } })).toEqual({
      field: "name",
      direction: "desc",
    });
  });
});

describe("configProblems", () => {
  it("cấu hình mẫu dùng được", () => {
    expect(configProblems(config)).toEqual([]);
  });

  it("từ chối tên không phải tên GraphQL trước khi nó được ghép vào câu truy vấn", () => {
    expect(configProblems({ ...config, source: "items { secret }" })).toHaveLength(1);
    expect(configProblems({ ...config, key: "id) { x" })).toHaveLength(1);
    expect(configProblems({ ...config, detail: { children: [{ ...parts, via: "item_id }" }] } })).toHaveLength(1);
  });

  it("báo tên trỏ tới trường chưa khai, trường khai hai lần, ô lọc không có choices, ô tìm trên cột không phải chữ", () => {
    const list = { columns: ["code", "missing"], search: ["quantity", "status"], filters: ["name"] };
    const [first] = config.fields;
    const fields = first ? [...config.fields, first] : config.fields;
    expect(configProblems({ ...config, fields, list, detail: { title: "nothing" } })).toEqual([
      'trường "code" được khai hai lần trong fields',
      'list.columns dùng trường "missing" chưa khai trong fields',
      'detail.title dùng trường "nothing" chưa khai trong fields',
      'list.filters dùng trường "name" không có choices',
      'list.search dùng trường "quantity" không phải kiểu text',
      'list.search dùng trường "status" không phải kiểu text',
    ]);
  });

  it("báo tone ngoài bộ nghĩa chung, vì cấu hình đọc từ CSDL không qua schema", () => {
    const fields = [{ name: "code", label: "Mã", choices: [{ value: "a", label: "A", tone: "red" as never }] }];
    expect(configProblems({ ...config, fields, list: { columns: ["code"] }, detail: undefined })).toEqual([
      'trường "code" khai tone "red" ngoài bad, warn, info, ok, neutral',
    ]);
  });
});

describe("đối tượng con lồng trong cấu hình", () => {
  it("lỗi ở một loại con nằm sâu vẫn được báo, kèm tên các bảng con dẫn tới nó", () => {
    const broken = { ...checks, list: { columns: ["missing"] } };
    const nested = { ...config, detail: { children: [{ ...parts, detail: { children: [broken] } }] } };
    expect(configProblems(nested)).toEqual([
      'Thành phần: Lần kiểm: list.columns dùng trường "missing" chưa khai trong fields',
    ]);
  });

  it("hai loại con cùng tên ngắn bị báo, vì tên ngắn quyết định đường dẫn", () => {
    expect(configProblems({ ...config, detail: { children: [parts, { ...checks, id: "parts" }] } })).toEqual([
      'hai loại đối tượng con cùng tên ngắn "parts"',
    ]);
  });

  it("đọc đường dẫn thành các chặng từ ngoài vào trong; khóa chứa dấu / được mã hóa lại", () => {
    const steps = resolvePath(config, ["A 1/2", "parts", "p7", "checks", "42"]);
    expect(steps?.map(({ node, key, via, path }) => [node.source, key, via, path])).toEqual([
      ["app_example_items", "A 1/2", undefined, "A%201%2F2"],
      ["app_example_parts", "p7", "item_id", "A%201%2F2/parts/p7"],
      ["app_example_checks", "42", "part_id", "A%201%2F2/parts/p7/checks/42"],
    ]);
  });

  it("đường dẫn thiếu khóa hoặc gọi một loại con không có thì không khớp", () => {
    expect(resolvePath(config, ["a1", "parts"])).toBeUndefined();
    expect(resolvePath(config, ["a1", "no-such-child", "x"])).toBeUndefined();
    expect(resolvePath(config, [])).toBeUndefined();
  });

  it("mỗi chặng chỉ khớp khi thuộc đúng dòng ở chặng trước, nên sai cha hay sai ông đều không hiện dòng", () => {
    const steps = resolvePath(config, ["a1", "parts", "p7", "checks", "42"]) ?? [];
    expect(chainVariables(steps)).toEqual({
      w0: { _and: [{ id: { _eq: "a1" } }] },
      w1: { _and: [{ id: { _eq: "p7" } }, { item_id: { _eq: "a1" } }] },
      w2: { _and: [{ check_no: { _eq: "42" } }, { part_id: { _eq: "p7" } }] },
    });
  });

  it("một câu truy vấn đọc cả chuỗi: dòng đang xem đủ trường, các dòng cha chỉ tiêu đề", () => {
    const steps = resolvePath(config, ["a1", "parts", "p7", "checks", "42"]) ?? [];
    expect(chainQuery(steps)).toBe(
      "query($w0: app_example_items_bool_exp!, $w1: app_example_parts_bool_exp!, $w2: app_example_checks_bool_exp!) " +
        "{ s0: app_example_items(where: $w0, limit: 1) { id name } " +
        "s1: app_example_parts(where: $w1, limit: 1) { id name } " +
        "s2: app_example_checks(where: $w2, limit: 1) { check_no result } }",
    );
  });
});

describe("trạng thái trên thanh địa chỉ", () => {
  it("ghi rồi đọc lại cho đúng trạng thái cũ", () => {
    const state = {
      search: "nhà a",
      filters: { status: "active" },
      sort: { field: "name", direction: "desc" as const },
      page: 2,
    };
    expect(writeState(state).toString()).toBe("q=nh%C3%A0+a&f.status=active&sort=-name&page=3");
    expect(readState(writeState(state))).toEqual(state);
  });

  it("trạng thái mặc định không để lại gì trên thanh địa chỉ; số trang sai về trang đầu", () => {
    expect(writeState(emptyState).toString()).toBe("");
    expect(readState(new URLSearchParams("page=abc")).page).toBe(0);
    expect(readState(new URLSearchParams("page=-4")).page).toBe(0);
  });

  it("kiểu đã chọn nằm trên thanh địa chỉ, chưa chọn thì không; giá trị lạ là kiểu mặc định của danh mục", () => {
    const cards = { ...emptyState, view: "cards" as const };
    expect(writeState(cards).toString()).toBe("view=cards");
    expect(readState(writeState(cards))).toEqual(cards);
    expect(readState(new URLSearchParams("view=table")).view).toBe("table");
    expect(readState(new URLSearchParams("view=grid")).view).toBeUndefined();
  });
});

describe("display", () => {
  const field = (name: string) => {
    const found = config.fields.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`cấu hình mẫu thiếu trường ${name}`);
    return found;
  };

  it("hiện chữ của choices thay cho giá trị lưu; giá trị ngoài choices hiện nguyên", () => {
    expect(display(field("status"), "retired")).toBe("Ngừng dùng");
    expect(display(field("status"), "unknown")).toBe("unknown");
  });

  it("tone theo lựa chọn gói khai; lựa chọn không khai tone, giá trị ngoài choices hay trống thì không có", () => {
    expect(toneOf(field("status"), "active")).toBe("ok");
    expect(toneOf(field("status"), "retired")).toBeUndefined();
    expect(toneOf(field("status"), "unknown")).toBeUndefined();
    expect(toneOf(field("status"), null)).toBeUndefined();
  });

  it("số theo cách viết tiếng Việt; giá trị trống thành chuỗi rỗng", () => {
    expect(display(field("quantity"), 1234.5)).toBe("1.234,5");
    expect(display(field("quantity"), null)).toBe("");
    expect(display(field("name"), "")).toBe("");
  });

  it("ngày không có giờ không lùi một ngày theo múi giờ; giá trị không phải ngày hiện nguyên", () => {
    expect(display({ name: "d", label: "Ngày", type: "date" }, "2026-11-17")).toBe("17/11/2026");
    // Năm hai chữ số làm 1820 và 2020 hiện giống nhau.
    expect(display({ name: "d", label: "Ngày", type: "date" }, "1820-01-01")).toBe("01/01/1820");
    expect(display({ name: "d", label: "Lúc", type: "datetime" }, "2026-11-01T08:30:00")).toBe("08:30 01/11/2026");
    expect(display({ name: "d", label: "Ngày", type: "date" }, "không phải ngày")).toBe("không phải ngày");
  });
});
