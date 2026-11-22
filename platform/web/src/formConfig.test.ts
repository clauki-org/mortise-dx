// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử phần thuần của thành phần biểu mẫu (ADR 0030): lỗi cấu hình kiểm lại lúc chạy, schema cho rjsf, dữ liệu gửi
// đi, khi nào dùng lại hay đổi Idempotency-Key, câu truy vấn của danh sách chọn và lời báo lỗi của lệnh thêm dòng.
// Cấu hình mẫu cùng dạng với contracts/examples/form.example.yaml.

import { describe, expect, it } from "vitest";
import {
  clearDependents,
  type FormConfig,
  type FormField,
  formProblems,
  formSchema,
  keyFor,
  payloadOf,
  sourceOptions,
  sourceQuery,
} from "./formConfig";
import { insertError, insertMutation } from "./formInsert";

const groups = { table: "app_example_groups", value: "code", label: "name" };
const items = {
  table: "app_example_items",
  value: "id",
  label: "name",
  where: { column: "group_code", field: "group" },
};

const title: FormField = { name: "title", label: "Tên", type: "string", required: true, max_length: 200 };
const group: FormField = { name: "group", label: "Nhóm", type: "choice", required: true, source: groups };
const item: FormField = { name: "item", label: "Đối tượng", type: "choice", source: items };

const config: FormConfig = {
  title: "Lập yêu cầu",
  fields: [
    title,
    group,
    item,
    { name: "amount", label: "Số lượng", type: "number", min: 1 },
    { name: "agree", label: "Xác nhận", type: "boolean", required: true },
    { name: "note", label: "Ghi chú", type: "string", multiline: true },
  ],
  submit: { label: "Gửi", process: "core-approval" },
  done: { message: "Đã gửi" },
};

describe("lỗi cấu hình", () => {
  it("cấu hình mẫu dùng được", () => {
    expect(formProblems(config)).toEqual([]);
  });

  it("từ chối tên sẽ ghép vào câu truy vấn hay đè biến của lõi", () => {
    const fields = [
      { ...title, name: "initiator" },
      { ...group, source: { ...groups, table: "x { y }" } },
      { ...item, source: { ...items, where: { column: "group_code", field: "later" } } },
      { name: "authority_level", label: "Cấp", type: "string" as const },
    ];
    expect(formProblems({ ...config, fields, role: "Admin X" })).toEqual([
      'trường "Tên": "initiator" không dùng làm tên biến hay tên cột được',
      'trường "Nhóm": "x { y }" không phải tên bảng hay cột hợp lệ',
      'trường "Đối tượng": lọc theo "later", không phải trường đứng trước nó',
      'trường "Cấp": "authority_level" không dùng làm tên biến hay tên cột được',
      'vai trò "Admin X" không hợp lệ',
    ]);
  });

  it("đúng một đích gửi, đúng một nguồn của trường chọn", () => {
    const both = { ...group, choices: [{ value: "a", label: "A" }] };
    expect(formProblems({ ...config, fields: [both], submit: { label: "Gửi" } })).toEqual([
      'trường "Nhóm": trường chọn cần đúng một trong choices và source',
      "submit cần đúng một trong process và insert",
    ]);
  });
});

describe("schema cho rjsf", () => {
  const { schema, uiSchema } = formSchema(config);

  it("mỗi trường một thuộc tính đúng kiểu, chỉ mang luật đã khai", () => {
    expect(schema.required).toEqual(["title", "group"]);
    expect(schema.properties).toMatchObject({
      title: { type: "string", title: "Tên", maxLength: 200 },
      amount: { type: "number", minimum: 1 },
      agree: { type: "boolean", default: false, const: true },
    });
    expect(Object.keys(schema.properties?.amount ?? {})).not.toContain("maximum");
    const date = formSchema({ ...config, fields: [{ name: "due", label: "Hạn", type: "date" }] });
    expect(date.schema.properties?.due).toEqual({ type: "string", format: "date", title: "Hạn" });
  });

  it("danh sách đọc từ bảng dùng ô sourceChoice kèm nhãn của trường cha", () => {
    expect(uiSchema.item).toEqual({
      "ui:widget": "sourceChoice",
      "ui:options": { source: items, parentLabel: "Nhóm" },
    });
    expect(uiSchema.note).toEqual({ "ui:widget": "textarea" });
  });
});

describe("dữ liệu gửi đi", () => {
  it("bỏ trường trống, giữ 0 và false, theo thứ tự khai", () => {
    const payload = payloadOf(config, { note: "", amount: 0, title: "A", agree: false, item: undefined });
    expect(JSON.stringify(payload)).toBe('{"title":"A","amount":0,"agree":false}');
  });

  it("đổi trường cha thì xóa trường con, giữ các trường khác", () => {
    expect(clearDependents(config, { group: "g1", item: "i1" }, { group: "g2", item: "i1", title: "A" })).toEqual({
      group: "g2",
      title: "A",
    });
    expect(clearDependents(config, { group: "g1" }, { group: "g1", item: "i2" })).toEqual({ group: "g1", item: "i2" });
  });
});

describe("Idempotency-Key", () => {
  let next = 0;
  const newKey = () => `key-${++next}`;

  it("cùng dữ liệu dùng lại mã; dữ liệu khác thì mã mới", () => {
    const first = keyFor({ key: "key-0" }, '{"a":1}', newKey);
    expect(first).toEqual({ key: "key-0", sent: '{"a":1}' });
    expect(keyFor(first, '{"a":1}', newKey)).toEqual(first);
    expect(keyFor(first, '{"a":2}', newKey)).toEqual({ key: "key-1", sent: '{"a":2}' });
  });
});

describe("danh sách chọn", () => {
  it("lọc qua biến, xếp theo nhãn rồi giá trị, xin thừa một dòng", () => {
    expect(sourceQuery(items, "g1")).toEqual({
      query:
        "query($where: app_example_items_bool_exp!, $order_by: [app_example_items_order_by!], $limit: Int!) " +
        "{ rows: app_example_items(where: $where, order_by: $order_by, limit: $limit) { name id } }",
      variables: { where: { group_code: { _eq: "g1" } }, order_by: [{ name: "asc" }, { id: "asc" }], limit: 201 },
    });
  });

  it("giá trị thành chữ, bỏ dòng trống và trùng, cắt ở trần", () => {
    const rows = [{ id: 1, name: "A" }, { id: null, name: "B" }, { id: 1, name: "C" }, { id: 2 }];
    expect(sourceOptions(items, rows)).toEqual([
      { value: "1", label: "A" },
      { value: "2", label: "2" },
    ]);
    expect(sourceOptions({ ...items, limit: 1 }, rows)).toHaveLength(1);
  });
});

describe("lệnh thêm dòng", () => {
  it("mutation thêm một dòng với kiểu insert_input của bảng", () => {
    expect(insertMutation("app_x_items")).toBe(
      "mutation($object: app_x_items_insert_input!) { result: insert_app_x_items(objects: [$object]) { affected_rows } }",
    );
  });

  it("lỗi của Hasura thành lời báo có cách khắc phục; lỗi lạ giữ nguyên văn", () => {
    const fail = (code: string, message: string) => ({ graphQLErrors: [{ message, extensions: { code } }] });
    expect(insertError(fail("constraint-violation", "Uniqueness violation. duplicate key"), "tenant_admin")).toMatch(
      /^Đã có dòng mang cùng mã\./,
    );
    expect(insertError(fail("permission-error", "check failed"), "tenant_admin")).toBe(
      "Tài khoản không được thêm dòng này với vai trò tenant_admin. Báo người quản trị cấp quyền.",
    );
    expect(insertError(fail("unexpected", "boom"), "user")).toBe("boom. Bấm gửi lại; nếu vẫn lỗi, báo người quản trị.");
    expect(insertError({ networkError: new Error("x"), graphQLErrors: [] }, "user")).toMatch(/^Không kết nối/);
  });
});
