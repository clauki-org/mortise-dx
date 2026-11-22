// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm cách thành phần trợ lý hiện câu trả lời: mỗi câu trích hiện đúng câu nguyên văn dịch vụ trả về, kèm tên văn
// bản và nhãn vị trí, cùng dòng ghi mô hình đã trả lời và nơi nó chạy; lời từ chối hiện lý do, không ghi mô hình.
// Dựng ra HTML bằng react-dom/server, không cần trình duyệt.

import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Result } from "./Assistant";
import type { Answer, Citation } from "./assistant";

const amendment: Citation = {
  document_id: "example-rules-amendment",
  title: "Quyết định mẫu sửa quy chế đặt phòng họp (hư cấu)",
  passage_id: "art-1",
  label: "Điều 1",
  sentence: "Phòng họp được đặt trước tối đa 14 ngày.",
};

function render(answer: Answer): string {
  return renderToStaticMarkup(
    <MantineProvider>
      <Result answer={answer} />
    </MantineProvider>,
  );
}

describe("Result", () => {
  it("hiện câu trả lời và từng câu trích kèm tên văn bản và nhãn", () => {
    const html = render({
      outcome: "answered",
      answer: "Tối đa 14 ngày.",
      reason: null,
      citations: [amendment],
      model: { name: "model-x", provider: "openai-compatible", location: "api", host: "llm.example.test" },
    });
    expect(html).toContain("Tối đa 14 ngày.");
    expect(html).toContain("Trả lời bởi model-x, qua API llm.example.test");
    expect(html).toContain("<blockquote");
    expect(html).toContain(amendment.sentence);
    expect(html).toContain(`${amendment.title}, ${amendment.label}`);
  });

  it("hiện lý do khi từ chối", () => {
    const html = render({
      outcome: "refused",
      answer: null,
      reason: "Không có đoạn đủ gần câu hỏi.",
      citations: [],
      model: null,
    });
    expect(html).toContain("Không có đoạn đủ gần câu hỏi.");
    expect(html).not.toContain("Trả lời bởi");
    expect(html).not.toContain("<blockquote");
  });
});
