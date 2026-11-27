// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử xuất danh sách ra CSV (catalogExport.ts): ô theo RFC 4180, chặn công thức, giá trị theo kiểu trường, phần
// đầu tệp, đọc theo lô với giới hạn dòng và lỗi giữa chừng, tên tệp.

import { describe, expect, it } from "vitest";
import type { CatalogConfig, Field, Row } from "./catalog";
import {
  buildCsv,
  cellOf,
  csvCell,
  describeConditions,
  exportTable,
  exportVariables,
  fileName,
  LIMIT,
  localDate,
  localTimestamp,
  readAll,
  TooManyRows,
} from "./catalogExport";
import { pdfDocument, sheetData } from "./catalogExportOffice";
import { emptyState, listVariables } from "./catalogQuery";

const config: CatalogConfig = {
  title: "Danh mục ví dụ",
  source: "app_example_items",
  fields: [
    { name: "code", label: "Mã" },
    { name: "name", label: "Tên" },
    { name: "size", label: "Cỡ", type: "number" },
    {
      name: "state",
      label: "Tình trạng",
      choices: [
        { value: "open", label: "Đang dùng" },
        { value: "closed", label: "Ngừng" },
      ],
    },
  ],
  list: { columns: ["code", "name", "size", "state"], search: ["code", "name"], filters: ["state"] },
};

const field = (name: string): Field => {
  const found = config.fields.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`thiếu trường ${name} trong cấu hình mẫu`);
  return found;
};

describe("csvCell", () => {
  it("bọc nháy kép khi có dấu phẩy, nháy kép hay xuống dòng", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('cao "nhất"')).toBe('"cao ""nhất"""');
    expect(csvCell("dòng 1\ndòng 2")).toBe('"dòng 1\ndòng 2"');
    expect(csvCell("Trụ sở UBND")).toBe("Trụ sở UBND");
  });

  it("chặn công thức: chữ bắt đầu bằng = + - @, tab hay CR thành chữ thường", () => {
    for (const text of ["=1+1", "+1+1", "-1+1", "@SUM(A1)", "\tx", "\rx"]) {
      expect(csvCell(text).replace(/^"/, "")).toMatch(/^'/);
    }
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });

  it("chuỗi chỉ gồm một số (kể cả âm, có dấu +) không bị thêm dấu ': không phải công thức", () => {
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell("+84")).toBe("+84");
    expect(csvCell("-1+2")).toBe("'-1+2");
  });
});

describe("cellOf", () => {
  it("số giữ dạng máy đọc được, kể cả số Hasura trả dạng chuỗi", () => {
    expect(cellOf(field("size"), 1234.5)).toEqual({ kind: "number", value: "1234.5" });
    expect(cellOf(field("size"), "1000.00")).toEqual({ kind: "number", value: "1000.00" });
    expect(cellOf(field("size"), -3)).toEqual({ kind: "number", value: "-3" });
  });

  it("giá trị không phải số trong trường số là chữ", () => {
    expect(cellOf(field("size"), "=1+1")).toEqual({ kind: "text", value: "=1+1" });
    expect(cellOf(field("size"), Number.NaN)).toEqual({ kind: "text", value: "NaN" });
  });

  it("trường có choices hiện chữ như trên màn hình; ô trống là chữ rỗng", () => {
    expect(cellOf(field("state"), "open")).toEqual({ kind: "text", value: "Đang dùng" });
    expect(cellOf(field("name"), null)).toEqual({ kind: "text", value: "" });
  });
});

describe("describeConditions", () => {
  it("ghi tìm, lọc theo nhãn và thứ tự đang xem", () => {
    const state = { ...emptyState, search: " UBND ", filters: { state: "open" } };
    expect(describeConditions(config, state)).toBe('Tìm "UBND"; Tình trạng: Đang dùng; Sắp xếp theo Mã tăng dần');
  });

  it("không ghi điều kiện mà truy vấn không áp: lọc theo trường ngoài list.filters, tìm khi không có cột tìm", () => {
    const state = { ...emptyState, search: "x", filters: { name: "abc" } };
    expect(describeConditions(config, state)).not.toContain("abc");
    const noSearch = { ...config, list: { ...config.list, search: [] } };
    expect(describeConditions(noSearch, state)).toBe("Sắp xếp theo Mã tăng dần");
  });
});

describe("exportTable và CSV", () => {
  const exportedAt = new Date("2026-11-24T08:00:00Z");
  const rows: Row[] = [
    { id: "1", code: "A1", name: "Trụ sở, tòa chính", size: "1000.5", state: "open" },
    { id: "2", code: "=cmd", name: "Kho", size: 20, state: "closed" },
  ];
  const table = exportTable(
    config,
    {
      title: config.title,
      source: config.source,
      tenant: "xa-a",
      user: "@user.a",
      exportedAt,
      timeZone: "Asia/Ho_Chi_Minh",
      conditions: "Sắp xếp theo Mã tăng dần",
    },
    rows,
  );
  const csv = buildCsv(table);
  const lines = csv.split("\r\n");

  it("mở đầu bằng BOM, phần đầu ghi nguồn, thời điểm, người xuất và số dòng", () => {
    expect(csv.startsWith("\uFEFFDanh sách,Danh mục ví dụ\r\n")).toBe(true);
    expect(lines).toContain("Nguồn,app_example_items");
    expect(lines).toContain(`Thời điểm xuất,${localTimestamp(exportedAt)}`);
    expect(lines).toContain("Đơn vị,xa-a");
    expect(lines).toContain("Múi giờ,Asia/Ho_Chi_Minh");
    expect(lines).toContain("Số dòng,2");
  });

  it("chặn công thức cả ở phần đầu (tên người xuất) lẫn trong bảng", () => {
    expect(lines).toContain("Người xuất,'@user.a");
    expect(lines).toContain("'=cmd,Kho,20,Ngừng");
  });

  it("bảng có tiêu đề theo nhãn và một dòng mỗi dòng dữ liệu, sau một dòng trống", () => {
    const blank = lines.indexOf("");
    expect(lines[blank + 1]).toBe("Mã,Tên,Cỡ,Tình trạng");
    expect(lines[blank + 2]).toBe('A1,"Trụ sở, tòa chính",1000.5,Đang dùng');
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("readAll", () => {
  it("đọc một lần, xin thừa một dòng so với giới hạn", async () => {
    const asked: number[] = [];
    const rows = await readAll(async (limit) => {
      asked.push(limit);
      return [{ id: 1 }, { id: 2 }];
    });
    expect(rows).toHaveLength(2);
    expect(asked).toEqual([LIMIT + 1]);
  });

  it("đúng bằng giới hạn thì xuất đủ; vượt giới hạn thì báo lỗi, không trả tệp thiếu", async () => {
    const many = (count: number) => async () => Array.from({ length: count }, (_, id) => ({ id }));
    expect(await readAll(many(LIMIT))).toHaveLength(LIMIT);
    await expect(readAll(many(LIMIT + 1))).rejects.toBeInstanceOf(TooManyRows);
  });

  it("lỗi khi đọc dừng lần xuất", async () => {
    await expect(
      readAll(async () => {
        throw new Error("mất kết nối");
      }),
    ).rejects.toThrow("mất kết nối");
  });
});

describe("exportVariables", () => {
  it("cùng điều kiện tìm, lọc và thứ tự với bảng, đọc từ dòng đầu dù bảng đang ở trang nào", () => {
    const state = { ...emptyState, search: "UBND", filters: { state: "open" }, page: 3 };
    const variables = exportVariables(config, state, LIMIT + 1);
    expect(variables.where).toEqual(listVariables(config, state).where);
    expect(variables.order_by).toEqual([{ code: "asc_nulls_last" }, { id: "asc" }]);
    expect(variables.offset).toBe(0);
    expect(variables.limit).toBe(LIMIT + 1);
  });
});

describe("ngày giờ địa phương", () => {
  it("tên tệp bỏ dấu tiêu đề và mang ngày theo giờ của máy, không theo UTC", () => {
    const time = new Date(2026, 10, 24, 1, 30);
    expect(fileName("Cơ sở nhà, đất", time, "xlsx")).toBe("co-so-nha-dat-2026-11-24.xlsx");
    expect(localDate(time)).toBe("2026-11-24");
  });

  it("thời điểm xuất ghi giờ của máy kèm độ lệch múi giờ, đọc lại ra đúng thời điểm", () => {
    const time = new Date(2026, 10, 24, 21, 40, 5);
    const text = localTimestamp(time);
    expect(text).toMatch(/^2026-11-24T21:40:05[+-]\d{2}:\d{2}$/);
    expect(new Date(text).getTime()).toBe(time.getTime());
  });
});

describe("Excel và PDF", () => {
  const table = exportTable(
    config,
    {
      title: config.title,
      source: config.source,
      tenant: "xa-a",
      user: "user.a",
      exportedAt: new Date(2026, 10, 24, 9, 0),
      timeZone: "Asia/Ho_Chi_Minh",
      conditions: "Sắp xếp theo Mã tăng dần",
    },
    [
      { id: "1", code: "A1", name: "=HYPERLINK(1)", size: "1000.5", state: "open" },
      { id: "2", code: "A2", name: "Kho", size: null, state: "closed" },
    ],
  );

  it("Excel: phần đầu, dòng trống, tiêu đề cột, rồi dòng; số là số, chữ khai rõ kiểu chữ kể cả khi bắt đầu bằng =", () => {
    const sheet = sheetData(table);
    expect(sheet[0]).toEqual([
      { value: "Danh sách", type: String, fontWeight: "bold" },
      { value: "Danh mục ví dụ", type: String },
    ]);
    expect(sheet[table.meta.length]).toEqual([]);
    expect(sheet[table.meta.length + 1]?.map((cell) => (cell as { value: unknown }).value)).toEqual([
      "Mã",
      "Tên",
      "Cỡ",
      "Tình trạng",
    ]);
    expect(sheet[table.meta.length + 2]).toEqual([
      { value: "A1", type: String },
      { value: "=HYPERLINK(1)", type: String },
      { value: 1000.5, type: Number },
      { value: "Đang dùng", type: String },
    ]);
    expect(sheet).toHaveLength(table.meta.length + 4);
  });

  it("PDF: bảng dữ liệu có đủ dòng, tiêu đề lặp lại mỗi trang, số căn phải, phần đầu đủ các cặp", () => {
    const document = pdfDocument(table);
    expect(document.info.title).toBe("Danh mục ví dụ");
    expect(document.pageOrientation).toBe("portrait");
    const [, meta, data] = document.content as [
      unknown,
      { table: { body: { text: string }[][] } },
      { table: { headerRows: number; body: { text: string; alignment?: string }[][] } },
    ];
    expect(meta.table.body.map(([label, value]) => [label?.text, value?.text])).toEqual(table.meta);
    expect(data.table.headerRows).toBe(1);
    expect(data.table.body.map((row) => row.map((cell) => cell.text))).toEqual([
      ["Mã", "Tên", "Cỡ", "Tình trạng"],
      ["A1", "=HYPERLINK(1)", "1000.5", "Đang dùng"],
      ["A2", "Kho", "", "Ngừng"],
    ]);
    expect(data.table.body[1]?.[2]?.alignment).toBe("right");
    expect(document.footer(2, 5).text).toBe("Trang 2/5");
  });

  it("bảng nhiều hơn bốn cột thì in ngang", () => {
    const wide = { ...table, columns: [...table.columns, "Thêm"] };
    expect(pdfDocument(wide).pageOrientation).toBe("landscape");
  });
});
