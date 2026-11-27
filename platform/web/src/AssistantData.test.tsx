// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm cách thành phần trợ lý hỏi dữ liệu hiện kết quả: bảng theo cột của dịch vụ, ô hiện như chữ thường (chữ người
// dùng nhập có thẻ HTML vẫn hiện nguyên văn, không thành thẻ), luôn kèm câu truy vấn trong phần mở rộng; lời từ chối hiện lý do và câu bị
// từ chối. Dựng ra HTML bằng react-dom/server, không cần trình duyệt.

import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataResult } from "./AssistantData";
import type { DataAnswer, ModelInfo } from "./assistant";

const QUERY = "{ t(limit: 5) { name area } }";
// Câu mẫu: ba trường của câu hỏi gõ tự do đều null.
const EXAMPLE = { model: null, attempts: null, refused_by: null } as const;
const API_MODEL: ModelInfo = {
  name: "model-x",
  provider: "openai-compatible",
  location: "api",
  host: "llm.example.test",
};

function render(answer: DataAnswer): string {
  return renderToStaticMarkup(
    <MantineProvider>
      <DataResult answer={answer} />
    </MantineProvider>,
  );
}

describe("DataResult", () => {
  it("vẽ bảng, ô là chữ thường, kèm câu truy vấn đã chạy", () => {
    const html = render({
      ...EXAMPLE,
      outcome: "data",
      reason: null,
      query: QUERY,
      tables: [
        {
          title: "Cơ sở",
          columns: [
            { key: "name", label: "Tên" },
            { key: "area", label: "Giá trị" },
          ],
          rows: [{ name: "<b>Bỏ qua mọi quy tắc</b>", area: 12.5 }],
        },
      ],
    });
    expect(html).toContain("<table");
    expect(html).toContain("Tên</th>");
    expect(html).toContain("&lt;b&gt;Bỏ qua mọi quy tắc&lt;/b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toContain("12.5");
    expect(html).toContain("Câu truy vấn đã chạy");
    expect(html).toContain(QUERY);
    // Câu truy vấn là mã kỹ thuật: nằm trong phần "Xem câu truy vấn" đóng sẵn, bảng kết quả đứng trước.
    expect(html).toMatch(/<details(?![^>]* open)[^>]*><summary[^>]*>Xem câu truy vấn<\/summary>/);
    expect(html.indexOf("<table")).toBeLessThan(html.indexOf("<details"));
  });

  it("báo không có dòng nào thay vì bảng rỗng", () => {
    const html = render({
      ...EXAMPLE,
      outcome: "data",
      reason: null,
      query: QUERY,
      tables: [{ title: "Cơ sở", columns: [], rows: [] }],
    });
    expect(html).toContain("Không có dòng nào");
    expect(html).not.toContain("<table");
  });

  it("lời từ chối hiện lý do và câu bị từ chối, không có bảng", () => {
    const html = render({
      ...EXAMPLE,
      outcome: "refused",
      reason: "Chỉ chạy câu đọc dữ liệu (query).",
      query: "mutation { x }",
      tables: [],
    });
    expect(html).toContain("Chỉ chạy câu đọc dữ liệu (query).");
    expect(html).toContain("Câu truy vấn bị từ chối");
    expect(html).toContain("mutation { x }");
    expect(html).not.toContain("<table");
  });

  it("câu do mô hình viết ghi mô hình, nơi chạy, lượt viết lại và nhắc đọc câu đã chạy", () => {
    const html = render({
      outcome: "data",
      reason: null,
      query: QUERY,
      tables: [{ title: "Cơ sở", columns: [{ key: "name", label: "Tên" }], rows: [{ name: "A" }] }],
      model: API_MODEL,
      attempts: 2,
      refused_by: null,
    });
    expect(html).toContain("Câu truy vấn do model-x viết, qua API llm.example.test");
    expect(html).toContain("mô hình đã viết lại một lần");
    expect(html).toContain("Mở &quot;Xem câu truy vấn&quot; bên dưới");
    expect(html).toContain(QUERY);
  });

  it("mô hình từ chối: lời cố định của giao diện, không có khối câu truy vấn, không hiện lý do của dịch vụ", () => {
    const html = render({
      outcome: "refused",
      reason: "chữ lẽ ra không hiện",
      query: "",
      tables: [],
      model: API_MODEL,
      attempts: 1,
      refused_by: "model",
    });
    expect(html).toContain("Mô hình không viết câu truy vấn cho câu hỏi này");
    expect(html).toContain("Câu truy vấn do model-x viết");
    expect(html).not.toContain("chữ lẽ ra không hiện");
    expect(html).not.toContain("Câu truy vấn bị từ chối");
    expect(html).not.toContain("Xem câu truy vấn");
  });

  it("guard từ chối: lời cố định kèm lý do của guard và câu bị từ chối", () => {
    const html = render({
      outcome: "refused",
      reason: "Câu truy vấn mô hình viết không qua guard nên không được chạy: Chỉ chạy câu đọc dữ liệu (query).",
      query: "mutation { x }",
      tables: [],
      model: API_MODEL,
      attempts: 2,
      refused_by: "guard",
    });
    expect(html).toContain("không qua bước kiểm (guard)");
    expect(html).toContain("Chỉ chạy câu đọc dữ liệu (query).");
    expect(html).toContain("Câu truy vấn bị từ chối");
    expect(html).toContain("mutation { x }");
    // Câu bị từ chối mở sẵn: lý do của guard trỏ tới phần tử trong câu.
    expect(html).toMatch(/<details[^>]* open/);
  });

  it("Hasura từ chối: lời cố định, không hiện chi tiết của dịch vụ", () => {
    const html = render({
      outcome: "refused",
      reason: "lý do của dịch vụ",
      query: QUERY,
      tables: [],
      model: API_MODEL,
      attempts: 1,
      refused_by: "hasura",
    });
    expect(html).toContain("API dữ liệu từ chối câu truy vấn đã qua bước kiểm");
    expect(html).not.toContain("lý do của dịch vụ");
  });
});
