// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử phần không có React của thành phần tài liệu đính kèm (documents.ts): câu GraphQL và biến sinh từ cấu hình,
// dòng nối gửi đi không mang tenant, lỗi cấu hình, lời báo khi tải lên hay gắn tệp hỏng. Cấu hình mẫu cùng dạng với
// contracts/examples/documents.example.yaml.

import { describe, expect, it } from "vitest";
import { configProblems } from "./catalog";
import {
  type DocumentsConfig,
  documentsProblems,
  formatSize,
  insertMutation,
  linkError,
  linkObject,
  listQuery,
  listVariables,
  uploadError,
  uploadRole,
} from "./documents";

const config: DocumentsConfig = {
  title: "Giấy tờ đính kèm",
  source: "app_example_item_documents",
  via: "item_id",
  file: "file_id",
  fields: [
    { name: "note", label: "Ghi chú" },
    { name: "created_at", label: "Ngày đính kèm", type: "datetime" },
  ],
  sort: { field: "created_at", direction: "desc" },
  limit: 5,
  upload: { note: "note" },
};

describe("câu truy vấn và dòng nối", () => {
  it("đọc cột file và các cột khai, lọc theo khóa của dòng đang xem, xin thừa một dòng", () => {
    expect(listQuery(config)).toBe(
      "query($where: app_example_item_documents_bool_exp!, $order_by: [app_example_item_documents_order_by!], " +
        "$limit: Int!) { rows: app_example_item_documents(where: $where, order_by: $order_by, limit: $limit) " +
        "{ file_id note created_at } }",
    );
    expect(listVariables(config, "k-1")).toEqual({
      where: { item_id: { _eq: "k-1" } },
      order_by: [{ created_at: "desc" }],
      limit: 6,
    });
  });

  it("không khai sort, limit thì xếp theo cột file tăng dần, 20 tệp", () => {
    const bare: DocumentsConfig = { title: "T", source: "s", via: "v", file: "f" };
    expect(listVariables(bare, 7)).toEqual({ where: { v: { _eq: 7 } }, order_by: [{ f: "asc" }], limit: 21 });
    expect(uploadRole(bare)).toBe("user");
  });

  it("dòng nối chỉ mang khóa, mã tệp và ghi chú; không có tenant hay người đính kèm", () => {
    expect(insertMutation(config)).toBe(
      "mutation($object: app_example_item_documents_insert_input!) " +
        "{ row: insert_app_example_item_documents_one(object: $object) { file_id } }",
    );
    expect(linkObject(config, "k-1", "f-1", "  Bản gốc ")).toEqual({ item_id: "k-1", file_id: "f-1", note: "Bản gốc" });
    expect(linkObject(config, "k-1", "f-1", "   ")).toEqual({ item_id: "k-1", file_id: "f-1" });
    expect(linkObject({ ...config, upload: {} }, "k-1", "f-1", "x")).toEqual({ item_id: "k-1", file_id: "f-1" });
  });
});

describe("lỗi cấu hình", () => {
  it("cấu hình mẫu không có lỗi", () => {
    expect(documentsProblems(config)).toEqual([]);
  });

  it("tên không phải tên GraphQL, via trùng file, trường khai hai lần", () => {
    const bad: DocumentsConfig = {
      ...config,
      via: "file_id",
      fields: [
        { name: "note", label: "A" },
        { name: "note", label: "B" },
      ],
      upload: { note: "note) { x" },
    };
    expect(documentsProblems(bad)).toEqual([
      'phần tài liệu: "note) { x" không phải tên hợp lệ (chỉ chữ không dấu, số, gạch dưới)',
      "phần tài liệu: via và file phải là hai cột khác nhau của bảng nối",
      'phần tài liệu: trường "note" được khai hai lần trong fields',
    ]);
  });

  it("danh mục báo lỗi của phần tài liệu ở cả đối tượng con", () => {
    const catalog = {
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
            fields: [{ name: "name", label: "Tên" }],
            list: { columns: ["name"] },
            detail: { documents: { ...config, source: "bad name" } },
          },
        ],
      },
    };
    expect(configProblems(catalog)).toEqual([
      'Thành phần: phần tài liệu: "bad name" không phải tên hợp lệ (chỉ chữ không dấu, số, gạch dưới)',
    ]);
  });
});

describe("lời báo", () => {
  it("tệp nhiễm mã độc bị từ chối kèm lý do của files-api", () => {
    const text = uploadError(422, "Tệp chứa mã độc (Eicar-Test-Signature); tệp không được lưu.");
    expect(text).toBe(
      "Tệp bị từ chối: Tệp chứa mã độc (Eicar-Test-Signature); tệp không được lưu. Kiểm tra lại tệp hoặc chọn " +
        "tệp khác.",
    );
  });

  it("quá cỡ, dịch vụ quét chưa sẵn sàng, mất mạng, quá tần suất", () => {
    expect(uploadError(413, "Tệp lớn quá giới hạn 20 MB.")).toMatch(/^Tệp bị từ chối vì quá cỡ cho phép \(Tệp lớn/);
    expect(uploadError(503, "Không quét được")).toMatch(/^Chưa lưu được tệp vì dịch vụ quét mã độc/);
    expect(uploadError(0, "")).toMatch(/^Không kết nối được máy chủ, tệp chưa được gửi/);
    expect(uploadError(429, "Máy chủ trả lỗi 429")).toMatch(/^Đã gửi quá nhiều yêu cầu/);
  });

  it("gắn tệp hỏng nói rõ tệp đã lưu mà chưa gắn", () => {
    const denied = { graphQLErrors: [{ message: "check constraint", extensions: { code: "permission-error" } }] };
    expect(linkError(denied)).toBe(
      "Tệp đã được lưu nhưng chưa gắn vào dòng này. Tài khoản không được đính kèm tệp vào dòng này; báo người quản " +
        "trị nếu cần quyền.",
    );
    expect(linkError({ networkError: new Error("x"), graphQLErrors: [] })).toMatch(/^Tệp đã được lưu nhưng chưa gắn/);
    const twice = {
      graphQLErrors: [{ message: "Uniqueness violation", extensions: { code: "constraint-violation" } }],
    };
    expect(linkError(twice)).toBe("Tệp này đã được đính kèm vào dòng này.");
  });

  it("cỡ tệp theo bội 1024", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("1,5 KB");
    expect(formatSize(20 * 1024 * 1024)).toBe("20 MB");
  });
});
