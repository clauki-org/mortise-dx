// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm cấu hình của thành phần trợ lý lúc chạy: cấu hình đọc từ CSDL, nên sai dạng thì báo lý do thay vì gửi câu hỏi.
// Kiểu Answer, Citation, ModelInfo và các giới hạn viết tay theo contracts/; ở đây đối chiếu với chính tệp hợp đồng để
// sửa hợp đồng mà quên sửa giao diện thì kiểm thử báo. Dòng ghi mô hình (modelLine) kiểm cả hai nơi chạy.

import { describe, expect, it } from "vitest";
// ?raw: TypeScript chỉ thấy một chuỗi, không đọc tệp, nên `npm run build` trong Dockerfile (chỉ có platform/web) vẫn
// chạy; Vitest đọc tệp thật trong repo.
import openapiText from "../../../contracts/assistant.openapi.json?raw";
import configText from "../../../contracts/assistant.schema.json?raw";
import {
  type Answer,
  type Citation,
  configProblems,
  MAX_DOCUMENT_ID,
  MAX_DOCUMENTS,
  type ModelInfo,
  modelLine,
} from "./assistant";

describe("configProblems", () => {
  it("nhận cấu hình đúng hợp đồng", () => {
    expect(configProblems({ intro: "Hỏi", examples: ["Câu mẫu?"], documents: ["doc-a", "doc-b"] })).toEqual([]);
  });

  it("báo thiếu intro và documents", () => {
    expect(configProblems({})).toEqual([
      "thiếu lời giới thiệu (intro)",
      "thiếu danh sách văn bản được hỏi (documents)",
    ]);
  });

  it("báo mã văn bản không đúng dạng và examples không phải danh sách", () => {
    expect(configProblems({ intro: "Hỏi", documents: ["Doc A"], examples: "Câu mẫu?" })).toEqual([
      "mã văn bản trong documents phải là chữ thường, số, gạch ngang, tối đa 64 ký tự",
      "examples phải là danh sách câu hỏi",
    ]);
  });

  it("báo vượt giới hạn số văn bản và độ dài mã văn bản", () => {
    const many = Array.from({ length: MAX_DOCUMENTS + 1 }, (_, i) => `doc-${i}`);
    expect(configProblems({ intro: "Hỏi", documents: many })).toEqual([
      "documents có tối đa 50 văn bản cho mỗi câu hỏi",
    ]);
    expect(configProblems({ intro: "Hỏi", documents: many.slice(0, MAX_DOCUMENTS) })).toEqual([]);
    expect(configProblems({ intro: "Hỏi", documents: ["a".repeat(MAX_DOCUMENT_ID + 1)] })).toEqual([
      "mã văn bản trong documents phải là chữ thường, số, gạch ngang, tối đa 64 ký tự",
    ]);
    expect(configProblems({ intro: "Hỏi", documents: ["a".repeat(MAX_DOCUMENT_ID)] })).toEqual([]);
  });
});

describe("modelLine", () => {
  it("ghi tên mô hình và chạy tại chỗ khi dùng Ollama", () => {
    expect(modelLine({ name: "qwen3.5:4b", provider: "ollama", location: "local", host: null })).toBe(
      "Trả lời bởi qwen3.5:4b, chạy tại chỗ",
    );
  });

  it("ghi tên máy của API khi câu hỏi đi qua API", () => {
    const model: ModelInfo = {
      name: "model-x",
      provider: "openai-compatible",
      location: "api",
      host: "llm.example.test",
    };
    expect(modelLine(model)).toBe("Trả lời bởi model-x, qua API llm.example.test");
  });
});

type Shape = { required: string[]; properties: Record<string, { enum?: string[]; maxItems?: number }> };

describe("hợp đồng", () => {
  const schemas: Record<"Answer" | "Citation" | "ModelInfo" | "Question", Shape> =
    JSON.parse(openapiText).components.schemas;
  const configSchema = JSON.parse(configText);
  // Đối tượng mang đúng kiểu: TypeScript buộc đủ mọi trường và không cho trường thừa, nên khóa của nó là các trường
  // của kiểu.
  const citation: Citation = { document_id: "d", title: "t", passage_id: "p", label: "l", sentence: "s" };
  const model: ModelInfo = { name: "m", provider: "ollama", location: "local", host: null };
  const answer: Answer = { outcome: "answered", answer: "a", reason: null, citations: [citation], model };
  const outcomes = { answered: true, refused: true } satisfies Record<Answer["outcome"], true>;
  const providers = { ollama: true, "openai-compatible": true } satisfies Record<ModelInfo["provider"], true>;
  const locations = { local: true, api: true } satisfies Record<ModelInfo["location"], true>;

  it("Citation và Answer có đúng các trường của OpenAPI", () => {
    expect(Object.keys(citation).sort()).toEqual(Object.keys(schemas.Citation.properties).sort());
    expect(Object.keys(citation).sort()).toEqual([...schemas.Citation.required].sort());
    expect(Object.keys(answer).sort()).toEqual(Object.keys(schemas.Answer.properties).sort());
    expect(Object.keys(answer).sort()).toEqual([...schemas.Answer.required].sort());
    expect(Object.keys(outcomes).sort()).toEqual([...(schemas.Answer.properties.outcome?.enum ?? [])].sort());
  });

  it("ModelInfo có đúng các trường và giá trị của OpenAPI", () => {
    expect(Object.keys(model).sort()).toEqual(Object.keys(schemas.ModelInfo.properties).sort());
    expect(Object.keys(model).sort()).toEqual([...schemas.ModelInfo.required].sort());
    expect(Object.keys(providers).sort()).toEqual([...(schemas.ModelInfo.properties.provider?.enum ?? [])].sort());
    expect(Object.keys(locations).sort()).toEqual([...(schemas.ModelInfo.properties.location?.enum ?? [])].sort());
  });

  it("giới hạn của configProblems khớp hợp đồng", () => {
    expect(MAX_DOCUMENTS).toBe(schemas.Question.properties.documents?.maxItems);
    expect(MAX_DOCUMENT_ID).toBe(configSchema.properties.documents.items.maxLength);
  });
});
