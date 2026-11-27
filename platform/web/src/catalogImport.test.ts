// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử phần kiểm dòng của hộp "nạp từ tệp" (catalogImport.ts, ADR 0064): khớp tiêu đề cột, đổi ô theo kiểu của
// trường, lỗi theo dòng và cột bằng bộ kiểm của biểu mẫu, số dòng tối đa, trùng trong tệp và với dòng đã có, câu đọc
// dòng đã có và lệnh thêm nhiều dòng; cùng lỗi cấu hình của nút trong catalog.ts.

import { describe, expect, it } from "vitest";
import { type CatalogConfig, configProblems } from "./catalog";
import {
  checkSheet,
  coerce,
  existingQuery,
  hasErrors,
  importObjects,
  insertManyMutation,
  markDuplicates,
  markExisting,
  parseDate,
  parseNumber,
} from "./catalogImport";
import type { FormConfig, FormField } from "./formConfig";

const form: FormConfig = {
  title: "Nạp dòng",
  fields: [
    { name: "code", label: "Mã", type: "string", required: true, max_length: 10 },
    { name: "floor", label: "Tầng", type: "integer", min: -10, max: 100 },
    {
      name: "kind",
      label: "Loại",
      type: "choice",
      required: true,
      choices: [
        { value: "a", label: "Loại A" },
        { value: "b", label: "Loại B" },
      ],
    },
    { name: "area", label: "Diện tích", type: "number", required: true, min: 0.01 },
    { name: "since", label: "Từ ngày", type: "date" },
  ],
  submit: { label: "Nạp", insert: "app_example_parts" },
  done: { message: "Đã nạp." },
};

function field(name: string): FormField {
  const found = form.fields.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`biểu mẫu thử không có trường ${name}`);
  return found;
}

const header = ["Mã", "Tầng", "Loại", "Diện tích", "Từ ngày"];

describe("đổi ô theo kiểu của trường", () => {
  it("số: dấu phẩy, dấu chấm thập phân, dấu chấm ngăn nghìn; cách viết khác không đoán", () => {
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber(" 12.5 ")).toBe(12.5);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("12a")).toBeUndefined();
    expect(parseNumber("1,2,3")).toBeUndefined();
  });

  it("ngày: ngày/tháng/năm hay năm-tháng-ngày, ngày không có thật bị từ chối", () => {
    expect(parseDate("5/3/2026")).toBe("2026-03-05");
    expect(parseDate("2026-03-05")).toBe("2026-03-05");
    expect(parseDate("31/02/2026")).toBeUndefined();
  });

  it("ô ngày của Excel đọc theo UTC, không lệch theo múi giờ của máy", () => {
    expect(coerce(field("since"), new Date(Date.UTC(2026, 10, 27)))).toEqual({ value: "2026-11-27" });
  });

  it("lựa chọn nhận nhãn hay giá trị, không phân biệt hoa thường; giá trị lạ báo danh sách được nhận", () => {
    const kind = field("kind");
    expect(coerce(kind, "loại b")).toEqual({ value: "b" });
    expect(coerce(kind, "A")).toEqual({ value: "a" });
    expect(coerce(kind, "Loại C").error).toBe("Chọn một trong: Loại A, Loại B");
  });

  it("số nguyên từ chối số lẻ; ô trống là chưa điền", () => {
    expect(coerce(field("floor"), 2.5).error).toBe("Cần một số nguyên");
    expect(coerce(field("floor"), "  ")).toEqual({});
  });
});

describe("kiểm tệp", () => {
  it("lỗi theo dòng và cột, số dòng như bảng tính, dòng trống bị bỏ", () => {
    const sheet = checkSheet(
      form,
      [
        header,
        ["P1", 1, "Loại A", 12.5, null],
        [],
        ["P2", "x", "Loại A", null, "2026-01-01"],
        ["P3", 2, "Loại B", "0"],
      ],
      10,
    );
    expect(sheet.problems).toEqual([]);
    expect(sheet.rows.map((row) => row.line)).toEqual([2, 4, 5]);
    expect(sheet.rows[0]).toMatchObject({ values: { code: "P1", floor: 1, kind: "a", area: 12.5 }, errors: {} });
    expect(sheet.rows[1]?.errors).toEqual({ floor: "Cần một số, ví dụ 12,5", area: "Bắt buộc nhập" });
    expect(sheet.rows[2]?.errors).toEqual({ area: "Không được nhỏ hơn 0.01" });
    expect(sheet.rows[1]?.shown.floor).toBe("x");
  });

  it("độ dài tối đa của chữ như biểu mẫu", () => {
    const sheet = checkSheet(form, [header, ["MA-QUA-DAI-11", 1, "Loại A", 1]], 10);
    expect(sheet.rows[0]?.errors.code).toBe("Tối đa 10 ký tự");
  });

  it("tiêu đề nhận nhãn hay tên trường; thiếu cột bắt buộc, cột lạ, cột trùng là lỗi cả tệp", () => {
    expect(
      checkSheet(
        form,
        [
          ["code", "Loại", "Diện tích"],
          ["P1", "a", 1],
        ],
        10,
      ).problems,
    ).toEqual([]);
    expect(checkSheet(form, [["Mã", "Ghi chú", "Mã"]], 10).problems).toEqual([
      'Cột "Ghi chú" không có trong tệp mẫu. Xóa cột đó hoặc dùng tệp mẫu.',
      'Cột "Mã" có hai lần. Giữ một cột.',
      'Thiếu cột "Loại".',
      'Thiếu cột "Diện tích".',
    ]);
  });

  it("vượt số dòng tối đa của gói thì không xem trước dòng nào", () => {
    const rows = [header, ["P1", 1, "a", 1], ["P2", 1, "a", 1], ["P3", 1, "a", 1]];
    const sheet = checkSheet(form, rows, 2);
    expect(sheet.rows).toEqual([]);
    expect(sheet.problems[0]).toBe("Tệp có 3 dòng, mỗi lần nạp tối đa 2 dòng. Tách tệp rồi nạp từng phần.");
  });

  it("tệp trống, tệp chỉ có tiêu đề", () => {
    expect(checkSheet(form, [[], [null]], 10).problems[0]).toMatch(/Tệp trống/);
    expect(checkSheet(form, [header], 10).problems[0]).toMatch(/không có dòng dữ liệu/);
  });
});

describe("trùng mã", () => {
  const rows = checkSheet(
    form,
    [header, ["P1", 1, "a", 1], ["P2", 1, "a", 1], ["P1", 1, "a", 1], ["P9", 1, "a", 1]],
    10,
  ).rows;

  it("trong tệp: mỗi dòng trùng chỉ tới các dòng còn lại", () => {
    const marked = markDuplicates(rows, "code");
    expect(marked.map((row) => row.errors.code)).toEqual([
      "Trùng với dòng 4",
      undefined,
      "Trùng với dòng 2",
      undefined,
    ]);
  });

  it("với dòng đã có dưới cùng dòng cha", () => {
    const marked = markExisting(rows, "code", ["P9"]);
    expect(marked.filter(hasErrors).map((row) => row.line)).toEqual([5]);
    expect(marked[3]?.errors.code).toBe("Đã có trong danh sách hiện tại");
  });

  it("câu đọc dòng đã có lọc theo dòng cha và các mã trong tệp, giá trị đi qua biến", () => {
    const { query, variables } = existingQuery("app_example_parts", "item_id", "code", "u-1", rows);
    expect(query).toBe(
      "query($where: app_example_parts_bool_exp!) { rows: app_example_parts(where: $where) { code } }",
    );
    expect(variables).toEqual({
      where: { _and: [{ item_id: { _eq: "u-1" } }, { code: { _in: ["P1", "P2", "P9"] } }] },
    });
  });
});

describe("gửi", () => {
  it("một mutation cho mọi dòng; khóa của dòng cha đặt sau cùng", () => {
    expect(insertManyMutation("app_example_parts")).toBe(
      "mutation($objects: [app_example_parts_insert_input!]!) { result: insert_app_example_parts(objects: $objects) { affected_rows } }",
    );
    const rows = checkSheet(form, [header, ["P1", null, "a", 1]], 10).rows;
    expect(importObjects(rows, "item_id", "u-1")).toEqual([{ code: "P1", kind: "a", area: 1, item_id: "u-1" }]);
  });
});

describe("cấu hình nút nạp", () => {
  const catalog = (load: Record<string, unknown>): CatalogConfig =>
    ({
      title: "Danh mục",
      source: "app_example_items",
      fields: [{ name: "name", label: "Tên" }],
      list: { columns: ["name"] },
      detail: {
        children: [
          {
            id: "parts",
            label: "Thành phần",
            via: "item_id",
            source: "app_example_parts",
            fields: [{ name: "code", label: "Mã" }],
            list: { columns: ["code"] },
            import: { label: "Nạp từ tệp", max_rows: 100, unique: "code", form, ...load },
          },
        ],
      },
    }) as CatalogConfig;

  it("cấu hình đúng không có lỗi", () => {
    expect(configProblems(catalog({}))).toEqual([]);
  });

  it("bảng đích, cột nối, trường không nạp được, số dòng, unique", () => {
    const wrong = {
      ...form,
      fields: [...form.fields, { name: "item_id", label: "Cha", type: "string" as const }],
      submit: { label: "Nạp", insert: "app_example_items" },
    };
    expect(configProblems(catalog({ form: wrong, max_rows: 5000, unique: "nope" }))).toEqual([
      'Thành phần: nút "Nạp từ tệp": biểu mẫu phải thêm dòng vào bảng app_example_parts (submit.insert)',
      'Thành phần: nút "Nạp từ tệp": cột item_id nhận khóa của dòng cha, không khai thành trường',
      'Thành phần: nút "Nạp từ tệp": max_rows phải từ 1 tới 1000',
      'Thành phần: nút "Nạp từ tệp": unique "nope" không phải trường của biểu mẫu',
    ]);
    const source = {
      ...form,
      fields: [
        { name: "kind", label: "Loại", type: "choice" as const, source: { table: "t", value: "v", label: "l" } },
      ],
    };
    expect(configProblems(catalog({ form: source, unique: undefined }))).toEqual([
      'Thành phần: nút "Nạp từ tệp": trường "Loại" không nạp từ tệp được (source hay boolean)',
    ]);
  });
});
