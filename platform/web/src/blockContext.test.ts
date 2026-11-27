// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử điều kiện mà khối trong chi tiết một dòng thêm vào truy vấn (blockContext.ts, ADR 0068): chỉ khi có dòng
// đang xem, có attach và attach trỏ đúng nguồn; còn lại khối chạy như đứng riêng.

import { describe, expect, it } from "vitest";
import { type BlockPlace, recordVariable, recordWhere } from "./blockContext";

const record = { app: "a", item: "records", source: "app_records", key: "id", id: "r/1", row: { id: "r/1" } };
const inRecord: BlockPlace = { app: "a", item: "map", record, attach: { source: "app_points", column: "record_id" } };

describe("recordWhere", () => {
  it("cột của attach bằng khóa của dòng đang xem, chỉ với nguồn được gắn", () => {
    expect(recordWhere(inRecord, "app_points")).toEqual({ record_id: { _eq: "r/1" } });
    expect(recordWhere(inRecord, "app_other")).toBeUndefined();
  });

  it("không có dòng hay không có attach thì không lọc", () => {
    expect(recordWhere(null, "app_points")).toBeUndefined();
    expect(recordWhere({ app: "a", item: "map" }, "app_points")).toBeUndefined();
    expect(recordWhere({ ...inRecord, attach: undefined }, "app_points")).toBeUndefined();
  });
});

describe("recordVariable", () => {
  it("biến của quy trình được gắn mang khóa của dòng dạng chuỗi", () => {
    const block = { ...inRecord, record: { ...record, id: 5 }, attach: { source: "review", column: "recordId" } };
    expect(recordVariable(block, ["review", "other"])).toEqual({ name: "recordId", value: "5" });
    expect(recordVariable(block, ["other"])).toBeUndefined();
    expect(recordVariable(null, ["review"])).toBeUndefined();
  });
});
