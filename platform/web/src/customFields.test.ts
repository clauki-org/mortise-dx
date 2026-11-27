// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm phần hàm thuần của trường tùy chỉnh (customFields.ts, ADR 0059): định nghĩa sai dạng bị bỏ, cột `custom` chỉ đọc
// khi có định nghĩa, ô nhập theo kiểu, giá trị gửi khi thêm và khi sửa (gộp lên `custom` đã lưu), cột trong tệp xuất,
// và lời từ chối của CSDL hiện đúng lý do.

import { describe, expect, it } from "vitest";
import type { CatalogNode } from "./catalog";
import { buildCsv, exportTable } from "./catalogExport";
import {
  type CustomField,
  customValue,
  definitions,
  displayField,
  inputFields,
  inputName,
  insertCustom,
  prefillCustom,
  updateCustom,
  withCustomColumn,
  withInputs,
} from "./customFields";
import type { FormConfig } from "./formConfig";
import { insertError } from "./formInsert";

const base = { root_tenant_id: "tinh-mau", source: "app_x_items" };
const brand: CustomField = {
  ...base,
  code: "brand",
  label: "Hãng",
  kind: "choice",
  choices: ["A", "B"],
  required: true,
};
const power: CustomField = {
  ...base,
  code: "power",
  label: "Công suất",
  kind: "number",
  choices: null,
  required: false,
};
const since: CustomField = { ...base, code: "since", label: "Ngày lắp", kind: "date", choices: null, required: false };
const note: CustomField = { ...base, code: "name", label: "Ghi chú", kind: "text", choices: null, required: false };
const all = [brand, power, since, note];

describe("definitions", () => {
  it("giữ định nghĩa đúng dạng, bỏ kiểu lạ, mã sai, lựa chọn không phải mảng chữ", () => {
    const rows = [
      { ...brand },
      { ...power, choices: ["x"] },
      { ...base, code: "x", label: "X", kind: "boolean", choices: null, required: false },
      { ...base, code: "Bad-Code", label: "Y", kind: "text", choices: null, required: false },
      { ...base, code: "c", label: "Z", kind: "choice", choices: [1], required: false },
      { code: 1, label: 1, kind: 1 },
      null,
    ];
    expect(definitions(rows)).toEqual([brand, power]);
    expect(definitions(undefined)).toEqual([]);
  });
});

describe("đọc và hiện", () => {
  it("chỉ đọc cột custom khi bảng có định nghĩa", () => {
    expect(withCustomColumn(["code"], [])).toEqual(["code"]);
    expect(withCustomColumn(["code"], [brand])).toEqual(["code", "custom"]);
  });

  it("trường hiện theo kiểu, giá trị đọc từ custom, dòng sai dạng không làm hỏng", () => {
    expect(displayField(power).type).toBe("number");
    expect(displayField(since).type).toBe("date");
    expect(displayField(brand).choices).toEqual([
      { value: "A", label: "A" },
      { value: "B", label: "B" },
    ]);
    expect(customValue({ custom: { brand: "A" } }, "brand")).toBe("A");
    expect(customValue({ custom: 1 }, "brand")).toBeUndefined();
    expect(customValue({}, "brand")).toBeUndefined();
  });
});

const form: FormConfig = {
  title: "Sửa",
  fields: [{ name: "name", label: "Tên", type: "string" }],
  submit: { label: "Lưu", update: "app_x_items", version: "updated_at" },
  done: { message: "Đã lưu" },
};

describe("ô nhập", () => {
  it("mỗi kiểu một ô, tên ô không trùng cột của gói dù mã trùng", () => {
    const fields = withInputs(form, all).fields;
    expect(fields.map((field) => field.name)).toEqual([
      "name",
      inputName("brand"),
      inputName("power"),
      inputName("since"),
      inputName("name"),
    ]);
    expect(fields.map((field) => field.type)).toEqual(["string", "choice", "number", "date", "string"]);
    expect(fields[1]?.required).toBe(true);
    expect(fields[4]?.max_length).toBe(2000);
    expect(withInputs(form, [])).toBe(form);
  });

  it("khi sửa, trường bắt buộc mà dòng chưa có giá trị không bị đòi; khi thêm thì bị đòi", () => {
    expect(inputFields([brand])[0]?.required).toBe(true);
    expect(inputFields([brand], {})[0]?.required).toBe(false);
    expect(inputFields([brand], { brand: "A" })[0]?.required).toBe(true);
  });

  it("lựa chọn đã lưu mà vừa bị bỏ vẫn chọn được, để dòng cũ lưu được", () => {
    const [choice] = inputFields([brand], { brand: "C" });
    expect(choice?.choices?.map((option) => option.value)).toEqual(["A", "B", "C"]);
  });

  it("điền sẵn giá trị đúng kiểu, bỏ giá trị sai kiểu", () => {
    expect(prefillCustom(all, { brand: "A", power: "nhiều", since: "2026-01-02", gone: 1 })).toEqual({
      [inputName("brand")]: "A",
      [inputName("since")]: "2026-01-02",
    });
  });
});

describe("giá trị gửi", () => {
  it("thêm dòng: chỉ ô đã điền; không có định nghĩa thì không gửi custom", () => {
    expect(insertCustom(all, { [inputName("brand")]: "A", [inputName("power")]: 0, [inputName("name")]: "" })).toEqual({
      brand: "A",
      power: 0,
    });
    expect(insertCustom([], { x: 1 })).toBeUndefined();
  });

  it("sửa: không ô nào đổi thì không gửi; đổi thì gộp lên custom đã lưu, ô xóa trắng là null", () => {
    const stored = { brand: "A", power: 5, gone: "giữ" };
    const initial = prefillCustom(all, stored);
    expect(updateCustom(all, initial, { ...initial }, stored)).toBeUndefined();
    const data = { ...initial, [inputName("brand")]: "B", [inputName("power")]: undefined };
    expect(updateCustom(all, initial, data, stored)).toEqual({ brand: "B", power: null, gone: "giữ" });
  });
});

describe("tệp xuất", () => {
  const config: CatalogNode = {
    source: "app_x_items",
    fields: [{ name: "code", label: "Mã" }],
    list: { columns: ["code"] },
  };
  const info = {
    title: "Danh mục",
    source: "app_x_items",
    tenant: "xa-a",
    user: "u",
    exportedAt: new Date("2026-11-24T08:00:00Z"),
    timeZone: "UTC",
    conditions: "",
  };

  it("cột tùy chỉnh đứng sau cột của gói, số là ô số, chữ vẫn chặn công thức", () => {
    const table = exportTable(config, info, [{ code: "A1", custom: { power: 12.5, name: "=1+1" } }], [power, note]);
    expect(table.columns).toEqual(["Mã", "Công suất", "Ghi chú"]);
    expect(table.rows[0]).toEqual([
      { kind: "text", value: "A1" },
      { kind: "number", value: "12.5" },
      { kind: "text", value: "=1+1" },
    ]);
    expect(buildCsv(table)).toContain("A1,12.5,'=1+1");
  });
});

describe("lời từ chối của CSDL", () => {
  const check = (message: string) => ({ graphQLErrors: [{ message, extensions: { code: "permission-error" } }] });

  it("lý do tiếng Việt của trigger hiện nguyên văn, không thành lời chung", () => {
    expect(
      insertError(check('Check constraint violation. Trường "Hãng" (brand) phải là một trong ["A", "B"]'), "user"),
    ).toBe('Trường "Hãng" (brand) phải là một trong ["A", "B"]');
  });
});
