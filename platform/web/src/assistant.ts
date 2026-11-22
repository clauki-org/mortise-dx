// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần không có React của thành phần trợ lý hỏi văn bản (ADR 0021): kiểu cấu hình theo contracts/assistant.schema.json,
// kiểm cấu hình lúc chạy, và lời gọi /v1/assistant/questions theo contracts/assistant.openapi.json. Assistant.tsx
// hiển thị.

import { callApi } from "./api";

export type AssistantConfig = { intro: string; examples?: string[]; documents: string[] };

export type Citation = { document_id: string; title: string; passage_id: string; label: string; sentence: string };

export type ModelInfo = {
  name: string;
  provider: "ollama" | "openai-compatible";
  location: "local" | "api";
  host: string | null;
};

export type Answer = {
  outcome: "answered" | "refused";
  answer: string | null;
  reason: string | null;
  citations: Citation[];
  // null khi dịch vụ từ chối mà không gọi mô hình.
  model: ModelInfo | null;
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Giới hạn của contracts: mã văn bản tối đa 64 ký tự (assistant.schema.json), mỗi câu hỏi tối đa 50 văn bản
// (Question trong assistant.openapi.json). Cấu hình vượt thì không câu hỏi nào ở mục đó được trả lời, nên báo ngay;
// assistant.test.ts đối chiếu hai số với contracts/.
export const MAX_DOCUMENT_ID = 64;
export const MAX_DOCUMENTS = 50;

/**
 * Lỗi của cấu hình mà schema đã chặn ở `make check-fast`. Kiểm lại lúc chạy vì cấu hình là dữ liệu đọc từ CSDL: gói
 * cài từ ngoài repo không qua bước kiểm đó, và câu hỏi gửi đi với cấu hình hỏng chỉ nhận lỗi khó hiểu.
 */
export function configProblems(config: unknown): string[] {
  const value = (config ?? {}) as Partial<Record<keyof AssistantConfig, unknown>>;
  const problems: string[] = [];
  if (typeof value.intro !== "string" || !value.intro.trim()) problems.push("thiếu lời giới thiệu (intro)");
  if (!Array.isArray(value.documents) || value.documents.length === 0)
    problems.push("thiếu danh sách văn bản được hỏi (documents)");
  else if (value.documents.length > MAX_DOCUMENTS)
    problems.push(`documents có tối đa ${MAX_DOCUMENTS} văn bản cho mỗi câu hỏi`);
  else if (!value.documents.every((id) => typeof id === "string" && id.length <= MAX_DOCUMENT_ID && SLUG.test(id)))
    problems.push(`mã văn bản trong documents phải là chữ thường, số, gạch ngang, tối đa ${MAX_DOCUMENT_ID} ký tự`);
  if (
    value.examples !== undefined &&
    !(Array.isArray(value.examples) && value.examples.every((e) => typeof e === "string"))
  )
    problems.push("examples phải là danh sách câu hỏi");
  return problems;
}

/**
 * Dòng cho người hỏi biết câu trả lời đến từ mô hình nào và câu hỏi đã đi đâu: qua API thì câu hỏi và các câu đã
 * tìm rời máy chủ của bản cài (ADR 0021), nên ghi cả tên máy của API.
 */
export function modelLine(model: ModelInfo): string {
  const where = model.location === "local" ? "chạy tại chỗ" : `qua API ${model.host ?? "bên ngoài"}`;
  return `Trả lời bởi ${model.name}, ${where}`;
}

/** Gửi câu hỏi. `app` là gói của mục menu: văn bản được hỏi thuộc gói đó (hay `core` cho văn bản mẫu của lõi). */
export function ask(token: string | undefined, app: string, config: AssistantConfig, question: string) {
  return callApi<Answer>("/v1/assistant/questions", token, {
    method: "POST",
    body: JSON.stringify({ question, app, documents: config.documents }),
  });
}
