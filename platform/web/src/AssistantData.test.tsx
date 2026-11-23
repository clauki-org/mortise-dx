// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm cách thành phần trợ lý hỏi dữ liệu hiện kết quả: bảng theo cột của dịch vụ, ô hiện như chữ thường (chữ người
// dùng nhập có thẻ HTML vẫn hiện nguyên văn, không thành thẻ), luôn kèm câu truy vấn; lời từ chối hiện lý do và câu bị
// từ chối. Dựng ra HTML bằng react-dom/server, không cần trình duyệt.

import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataResult } from "./AssistantData";
import type { DataAnswer } from "./assistant";

const QUERY = "{ t(limit: 5) { name area } }";

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
  });

  it("báo không có dòng nào thay vì bảng rỗng", () => {
    const html = render({
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
});
