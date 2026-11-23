// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần không có React của thành phần trợ lý: kiểu cấu hình theo contracts/assistant.schema.json, kiểm cấu hình lúc chạy,
// và lời gọi theo contracts/assistant.openapi.json. Mục menu chọn hỏi văn bản (`documents`, ADR 0021,
// /v1/assistant/questions, Assistant.tsx hiển thị) hay hỏi dữ liệu (`data`, ADR 0027 và ADR 0034: câu mẫu qua
// /v1/assistant/data-queries, câu gõ tự do qua /v1/assistant/data-questions; AssistantData.tsx hiển thị).

import { callApi } from "./api";

export type AssistantConfig = { intro: string; examples?: string[]; documents: string[] };

/** Câu mẫu của mục hỏi dữ liệu: bấm là chạy câu truy vấn viết sẵn, không qua mô hình. */
export type DataExample = { id: string; question: string; query: string };

/** Mục hỏi dữ liệu. Giao diện chỉ cần lời giới thiệu và câu mẫu; bảng, cột được phép do dịch vụ tự đọc từ mục menu. */
export type DataAssistantConfig = { intro: string; data: { examples: DataExample[] } };

export type DataTable = { title: string; columns: { key: string; label: string }[]; rows: Record<string, Cell>[] };
export type Cell = string | number | boolean | null;

export type DataAnswer = {
  outcome: "data" | "refused";
  reason: string | null;
  query: string;
  tables: DataTable[];
  // Ba trường dưới null với câu mẫu (không qua mô hình); có giá trị với câu hỏi gõ tự do.
  model: ModelInfo | null;
  attempts: number | null;
  refused_by: "model" | "guard" | "hasura" | null;
};

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
  const value = (config ?? {}) as Partial<Record<keyof AssistantConfig | "data", unknown>>;
  const problems: string[] = [];
  if (typeof value.intro !== "string" || !value.intro.trim()) problems.push("thiếu lời giới thiệu (intro)");
  if (value.data !== undefined) {
    if (value.documents !== undefined || value.examples !== undefined)
      problems.push("mục hỏi dữ liệu (data) không khai thêm documents hay examples");
    return [...problems, ...dataProblems(value.data)];
  }
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
 * Mô hình chạy ở đâu: qua API thì câu hỏi và phần prompt đi kèm rời máy chủ của bản cài (ADR 0021, ADR 0034), nên
 * ghi cả tên máy của API.
 */
const modelWhere = (model: ModelInfo) =>
  model.location === "local" ? "chạy tại chỗ" : `qua API ${model.host ?? "bên ngoài"}`;

/** Dòng cho người hỏi văn bản biết câu trả lời đến từ mô hình nào và câu hỏi đã đi đâu. */
export function modelLine(model: ModelInfo): string {
  return `Trả lời bởi ${model.name}, ${modelWhere(model)}`;
}

/** Dòng cho người hỏi dữ liệu: mô hình chỉ viết câu truy vấn, dữ liệu trong bảng không qua mô hình. */
export function queryModelLine(model: ModelInfo): string {
  return `Câu truy vấn do ${model.name} viết, ${modelWhere(model)}`;
}

function dataProblems(data: unknown): string[] {
  const examples = (data as { examples?: unknown } | null)?.examples;
  const valid = (example: unknown) => {
    const { id, question, query } = (example ?? {}) as Record<string, unknown>;
    return (
      typeof id === "string" && typeof question === "string" && question.trim() !== "" && typeof query === "string"
    );
  };
  if (!Array.isArray(examples) || examples.length === 0) return ["thiếu câu mẫu của mục hỏi dữ liệu (data.examples)"];
  if (!examples.every(valid)) return ["mỗi câu mẫu trong data.examples cần id, question và query"];
  return [];
}

/** Mục menu hỏi dữ liệu hay hỏi văn bản: có khối `data` là hỏi dữ liệu. */
export const isDataConfig = (config: unknown): config is DataAssistantConfig =>
  typeof config === "object" && config !== null && "data" in config;

/**
 * Chạy câu truy vấn của một câu mẫu. Gửi gói và mục menu, không gửi bảng hay cột được phép: dịch vụ đọc chúng từ mục
 * menu bằng token người hỏi, nên giao diện không mở rộng được danh sách cho phép.
 */
export function runDataQuery(token: string | undefined, app: string, item: string, example: DataExample) {
  return callApi<DataAnswer>("/v1/assistant/data-queries", token, {
    method: "POST",
    body: JSON.stringify({ question: example.question, app, item, query: example.query }),
  });
}

/**
 * Hỏi dữ liệu bằng câu gõ tự do: mô hình viết câu truy vấn, dịch vụ cho câu qua guard rồi chạy bằng token người hỏi.
 * Như câu mẫu, chỉ gửi gói và mục menu; bảng, cột được phép do dịch vụ đọc từ mục menu.
 */
export function askData(token: string | undefined, app: string, item: string, question: string) {
  return callApi<DataAnswer>("/v1/assistant/data-questions", token, {
    method: "POST",
    body: JSON.stringify({ question, app, item }),
  });
}

/** Gửi câu hỏi. `app` là gói của mục menu: văn bản được hỏi thuộc gói đó (hay `core` cho văn bản mẫu của lõi). */
export function ask(token: string | undefined, app: string, config: AssistantConfig, question: string) {
  return callApi<Answer>("/v1/assistant/questions", token, {
    method: "POST",
    body: JSON.stringify({ question, app, documents: config.documents }),
  });
}
