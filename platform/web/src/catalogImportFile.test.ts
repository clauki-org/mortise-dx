// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử đọc tệp của hộp "nạp từ tệp" (catalogImportFile.ts, ADR 0064): CSV có hay không BOM, dấu phẩy hay chấm
// phẩy, nháy kép, CRLF, bảng mã sai; tệp .xlsx ghi bằng write-excel-file đọc lại đúng kiểu ô; tệp lớn bị chặn trước
// khi read-excel-file phải dùng Web Worker; tệp mẫu sinh từ biểu mẫu có đúng tiêu đề cột.

import { readSheet } from "read-excel-file/universal";
import { describe, expect, it } from "vitest";
import writeExcelFile from "write-excel-file/universal";
import { checkSheet } from "./catalogImport";
import { FILE_LIMIT_BYTES, FileProblem, type Grid, needsWorker, parseCsv, readGrid } from "./catalogImportFile";
import { templateSheets } from "./catalogImportTemplate";
import type { FormConfig } from "./formConfig";

const form: FormConfig = {
  title: "Nạp",
  fields: [
    { name: "code", label: "Mã", type: "string", required: true },
    { name: "area", label: "Diện tích", type: "number", required: true },
  ],
  submit: { label: "Nạp", insert: "app_example_parts" },
  done: { message: "Đã nạp." },
};

const fileOf = (parts: BlobPart[], name: string) => new File(parts, name);

describe("CSV", () => {
  it("đọc tệp Excel tiếng Việt lưu ra: BOM, dấu chấm phẩy, dấu phẩy thập phân, CRLF", () => {
    expect(parseCsv("﻿Mã;Diện tích\r\nP1;12,5\r\n")).toEqual([
      ["Mã", "Diện tích"],
      ["P1", "12,5"],
    ]);
  });

  it("đọc dấu phẩy, không BOM, ô trong nháy kép chứa dấu phân cách, xuống dòng và nháy kép", () => {
    expect(parseCsv('Mã,Ghi chú\n"P,1","dòng 1\ndòng ""2"""')).toEqual([
      ["Mã", "Ghi chú"],
      ["P,1", 'dòng 1\ndòng "2"'],
    ]);
  });

  it("dấu phân cách đoán từ dòng tiêu đề, không từ dữ liệu", () => {
    expect(parseCsv("Mã;Tên\nP1;a,b,c")[1]).toEqual(["P1", "a,b,c"]);
  });

  it("nháy kép không đóng thì báo cách sửa", () => {
    expect(() => parseCsv('Mã\n"P1')).toThrow(FileProblem);
  });

  it("tệp không phải UTF-8 bị từ chối thay vì vỡ dấu", async () => {
    // "Mã" theo Windows-1258: byte 0xE3 đứng một mình không hợp lệ trong UTF-8.
    const file = fileOf([new Uint8Array([0x4d, 0xe3, 0x0a, 0x50, 0x31])], "phong.csv");
    await expect(readGrid(file)).rejects.toThrow(/không phải UTF-8/);
  });

  it("loại tệp khác và tệp quá lớn bị từ chối", async () => {
    await expect(readGrid(fileOf(["x"], "phong.xls"))).rejects.toThrow(/\.xlsx/);
    const big = fileOf([new Uint8Array(FILE_LIMIT_BYTES + 1)], "phong.csv");
    await expect(readGrid(big)).rejects.toThrow(/5 MB/);
  });
});

describe("Excel", () => {
  it("ô số, ô ngày giữ kiểu Excel; mã gõ là số đọc lại thành chữ", async () => {
    const blob = await writeExcelFile([
      [
        { value: "Mã", type: String },
        { value: "Diện tích", type: String },
      ],
      [
        { value: 101, type: Number },
        { value: 12.5, type: Number },
      ],
    ]).toBlob();
    const grid = await readGrid(fileOf([blob], "phong.xlsx"));
    expect(grid[1]).toEqual([101, 12.5]);
    expect(checkSheet(form, grid, 10).rows[0]?.values).toEqual({ code: "101", area: 12.5 });
  });

  it("tệp 1.000 dòng (trần của max_rows) dưới trần cỡ tệp và không cần Web Worker", async () => {
    const rows = Array.from({ length: 1000 }, (_, index) => [
      { value: `P-${index}`, type: String },
      { value: `Phòng làm việc số ${index}`, type: String },
      { value: index % 10, type: Number },
      { value: "Làm việc", type: String },
      { value: 12.5 + index, type: Number },
    ]);
    const buffer = await (await writeExcelFile(rows).toBlob()).arrayBuffer();
    expect(buffer.byteLength).toBeLessThan(FILE_LIMIT_BYTES);
    expect(needsWorker(buffer)).toBe(false);
  });

  it("phần nén giải ra từ 512 KB thì bị chặn trước khi đọc", async () => {
    const rows = Array.from({ length: 20000 }, (_, index) => [{ value: `Dòng lặp lại ${index}`, type: String }]);
    const buffer = await (await writeExcelFile(rows).toBlob()).arrayBuffer();
    expect(needsWorker(buffer)).toBe(true);
    await expect(readGrid(fileOf([buffer], "lon.xlsx"))).rejects.toThrow(/quá lớn/);
  });

  it("tệp không phải zip báo lỗi đọc, không treo", async () => {
    await expect(readGrid(fileOf(["không phải excel"], "hong.xlsx"))).rejects.toThrow(FileProblem);
  });

  it("tệp mẫu có tiêu đề là nhãn của trường, đọc lại khớp mọi cột và trang hướng dẫn đứng sau", async () => {
    const blob = await writeExcelFile(templateSheets(form)).toBlob();
    const buffer = await blob.arrayBuffer();
    expect(await readSheet(buffer)).toEqual([["Mã", "Diện tích"]]);
    expect((await readSheet(buffer, "Hướng dẫn"))[1]).toEqual(["Mã", "Có", "Chữ", null, null]);
    expect(checkSheet(form, (await readSheet(buffer)) as Grid, 10).problems).toEqual([
      "Tệp không có dòng dữ liệu nào dưới dòng tiêu đề.",
    ]);
  });
});
