// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử phần sửa dòng và thêm dòng con từ danh mục (formUpdate.ts, các luật trong catalog.ts và formConfig.ts, ADR
// 0054): câu đọc lại, giá trị điền sẵn, chỉ cột đã đổi, điều kiện version, lời báo lỗi, và lỗi cấu hình mà nút sửa,
// nút thêm phải bắt. Cấu hình mẫu cùng dạng với contracts/examples/catalog.example.yaml.

import { describe, expect, it } from "vitest";
import { type CatalogConfig, type Child, configProblems } from "./catalog";
import { type FormConfig, formProblems } from "./formConfig";
import {
  changedColumns,
  prefillOf,
  readColumns,
  rowQuery,
  updateError,
  updateMutation,
  updateWhere,
} from "./formUpdate";

const edit: FormConfig = {
  title: "Sửa",
  fields: [
    { name: "code", label: "Mã", type: "string", required: true },
    { name: "note", label: "Ghi chú", type: "string" },
    { name: "floors", label: "Số tầng", type: "integer" },
    { name: "status", label: "Tình trạng", type: "choice", choices: [{ value: "a", label: "A" }] },
  ],
  submit: { label: "Lưu", update: "app_example_items", version: "updated_at" },
  done: { message: "Đã lưu" },
};

const add: FormConfig = {
  title: "Thêm",
  fields: [{ name: "name", label: "Tên", type: "string", required: true }],
  submit: { label: "Thêm", insert: "app_example_parts" },
  done: { message: "Đã thêm" },
};

const parts: Child = {
  id: "parts",
  label: "Thành phần",
  via: "item_id",
  source: "app_example_parts",
  fields: [{ name: "name", label: "Tên" }],
  list: { columns: ["name"] },
  add: { label: "Thêm thành phần", parent: "code", form: add },
};

const catalog: CatalogConfig = {
  title: "Danh mục",
  source: "app_example_items",
  fields: [{ name: "code", label: "Mã" }],
  list: { columns: ["code"] },
  detail: { edit: { label: "Sửa", form: edit }, children: [parts] },
};

describe("đọc lại dòng lúc mở", () => {
  it("đọc khóa, các trường và cột version, không trùng cột", () => {
    expect(readColumns(edit, "id")).toEqual(["id", "code", "note", "floors", "status", "updated_at"]);
    expect(rowQuery("app_example_items", ["id", "code"])).toBe(
      "query($where: app_example_items_bool_exp!) { rows: app_example_items(where: $where, limit: 1) { id code } }",
    );
  });

  it("ô trống không vào dữ liệu của biểu mẫu; số dạng chữ thành số, lựa chọn thành chữ", () => {
    const row = { id: "1", code: "A1", note: null, floors: "2", status: "a", updated_at: "t" };
    expect(prefillOf(edit, row)).toEqual({ code: "A1", floors: 2, status: "a" });
  });
});

describe("lệnh sửa", () => {
  it("chỉ gửi cột đã đổi; ô bị xóa trắng gửi null; không đổi gì thì rỗng", () => {
    const initial = { code: "A1", note: "cũ", floors: 2 };
    expect(changedColumns(edit, initial, { code: "A1", note: "", floors: 3 })).toEqual({ note: null, floors: 3 });
    expect(changedColumns(edit, initial, { ...initial })).toEqual({});
    expect(changedColumns(edit, { code: "A1" }, { code: "A1", note: undefined })).toEqual({});
  });

  it("điều kiện gồm khóa và đúng chuỗi version đã đọc, kể cả phần micro giây", () => {
    const version = "2026-11-27T10:00:00.123456+00:00";
    expect(updateWhere("id", "1", "updated_at", version)).toEqual({
      _and: [{ id: { _eq: "1" } }, { updated_at: { _eq: version } }],
    });
    expect(updateMutation("app_example_items")).toBe(
      "mutation($where: app_example_items_bool_exp!, $set: app_example_items_set_input!) " +
        "{ result: update_app_example_items(where: $where, _set: $set) { affected_rows } }",
    );
  });

  it("lời báo nói về sửa, không nói về thêm; lỗi chung dùng lại lời của lệnh thêm", () => {
    const failure = (code: string, message: string) => ({ graphQLErrors: [{ message, extensions: { code } }] });
    expect(updateError(failure("constraint-violation", "Uniqueness violation. x"), "user")).toBe(
      "Đã có dòng khác mang cùng mã. Đổi mã rồi lưu lại.",
    );
    expect(
      updateError(failure("permission-error", "check constraint of an update permission has failed"), "user"),
    ).toBe("Tài khoản không được sửa dòng này như vậy với vai trò user. Báo người quản trị cấp quyền.");
    const check = 'Check constraint violation. new row for relation "rooms" violates check constraint "rooms_area"';
    expect(updateError(failure("permission-error", check), "user")).toBe(
      "Một giá trị không hợp lệ theo luật của bảng (ví dụ số âm). Sửa giá trị rồi gửi lại.",
    );
    expect(updateError({ networkError: new Error("x"), graphQLErrors: [] }, "user")).toBe(
      "Không kết nối được máy chủ. Kiểm tra mạng rồi bấm gửi lại.",
    );
  });
});

describe("lỗi cấu hình", () => {
  it("cấu hình mẫu dùng được", () => {
    expect(configProblems(catalog)).toEqual([]);
  });

  it("submit.update cần cột version hợp lệ; version chỉ đi cùng update", () => {
    expect(formProblems({ ...edit, submit: { label: "Lưu", update: "t" } })).toEqual([
      "submit.update cần version là tên cột thời điểm sửa cuối",
    ]);
    expect(formProblems({ ...add, submit: { label: "Thêm", insert: "t", version: "v" } })).toEqual([
      "submit.version chỉ dùng cùng submit.update",
    ]);
  });

  it("nút sửa ghi đúng bảng của danh sách; nút thêm ghi đúng bảng con, không có trường cho cột nối về cha", () => {
    const wrongEdit = { ...edit, submit: { ...edit.submit, update: "app_other" } };
    const viaField = { ...add, fields: [...add.fields, { name: "item_id", label: "Cha", type: "string" as const }] };
    const config: CatalogConfig = {
      ...catalog,
      detail: {
        edit: { label: "Sửa", form: wrongEdit },
        children: [{ ...parts, add: { label: "Thêm", parent: "missing", form: viaField } }],
      },
    };
    expect(configProblems(config)).toEqual([
      'nút "Sửa": biểu mẫu phải sửa bảng app_example_items của danh sách này (submit.update)',
      'Thành phần: nút "Thêm": cột item_id nhận khóa của dòng cha, không khai thành trường',
      'Thành phần: nút "Thêm": parent "missing" không phải khóa hay trường đã khai của dòng cha',
    ]);
  });

  it("danh sách đọc view đọc chéo đơn vị: biểu mẫu ghi bảng writes, không ghi chính view", () => {
    const viaView: CatalogConfig = {
      ...catalog,
      source: "app_example_item_board",
      writes: "app_example_items",
      detail: { edit: { label: "Sửa", form: edit } },
    };
    expect(configProblems(viaView)).toEqual([]);
    const onView = { ...edit, submit: { ...edit.submit, update: "app_example_item_board" } };
    expect(configProblems({ ...viaView, detail: { edit: { label: "Sửa", form: onView } } })).toEqual([
      'nút "Sửa": biểu mẫu phải sửa bảng app_example_items của danh sách này (submit.update)',
    ]);
  });
});
