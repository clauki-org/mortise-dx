// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Trợ lý hỏi văn bản trên trình duyệt (ADR 0021): cán bộ mở mục menu mẫu của lõi, hỏi một câu không có trong văn bản
// mẫu và thấy lời từ chối kèm lý do. Câu này bị từ chối ở bước tìm, trước khi gọi mô hình, nên bài chạy được cả khi
// chưa bật Ollama (CI không có mô hình). Cần `make seed` (văn bản và mục menu mẫu của lõi).

import { expect, test } from "@playwright/test";
import { openMenuItem, signIn } from "./support.ts";

test("câu hỏi ngoài văn bản bị từ chối kèm lý do, không có câu trích nào", async ({ page }) => {
  await page.goto("/");
  await signIn(page, "user.a");
  await openMenuItem(page, "Hỏi văn bản mẫu");
  await expect(page.getByRole("heading", { level: 1, name: "Hỏi văn bản" })).toBeVisible();

  await page.getByRole("textbox", { name: "Câu hỏi" }).fill("Lương cơ sở hiện nay là bao nhiêu?");
  await page.getByRole("button", { name: "Hỏi", exact: true }).click();

  const refusal = page.getByRole("alert").filter({ hasText: "Trợ lý không trả lời" });
  await expect(refusal).toContainText("Không tìm thấy đoạn nào");
  await expect(page.getByRole("heading", { name: "Căn cứ" })).toHaveCount(0);
});
