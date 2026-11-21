// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Đường demo của bảng việc trên trình duyệt: người ở đơn vị A gửi hồ sơ, người duyệt của đơn vị A duyệt trên web,
// người gửi không tự duyệt được, đơn vị B không thấy gì của đơn vị A. Chạy trên quy trình mẫu core-approval của
// lõi; danh mục của gói ở catalog.spec.ts.

import { expect, test } from "@playwright/test";
import { complete, outcome, signIn, submitApproval, taskOf, uniqueTitle, visibleTenants } from "./support.ts";

test("người duyệt của đơn vị A mở hồ sơ từ đường dẫn, duyệt trên web, quy trình kết thúc ở nhánh đã duyệt", async ({
  page,
  request,
}) => {
  const title = uniqueTitle("Đề nghị kiểm thử");
  const instance = await submitApproval(request, "user.a", title);
  const task = await taskOf(request, "manager.a", instance);

  // Mở thẳng đường dẫn tới việc khi chưa đăng nhập: đăng nhập xong phải quay lại đúng việc đó.
  await page.goto(`/tasks/${task}`);
  await signIn(page, "manager.a");
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/tasks/${task}$`));

  // Ý kiến là trường bắt buộc: bấm Duyệt khi để trống thì báo lỗi, không gửi.
  await page.getByRole("button", { name: "Duyệt" }).click();
  await expect(page.getByText("Bắt buộc nhập")).toBeVisible();

  await page.getByLabel(/Ý kiến/).fill("Đồng ý");
  await page.getByRole("button", { name: "Duyệt" }).click();
  await expect(page.getByText("Đã gửi")).toBeVisible();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);

  expect(await outcome(request, "user.a", instance)).toMatchObject({ ended: true, outcome: "approved" });
});

test("người gửi không tự duyệt hồ sơ của mình (quy tắc bốn mắt)", async ({ page, request }) => {
  const title = uniqueTitle("Tự gửi tự duyệt");
  const instance = await submitApproval(request, "manager.a", title);

  await page.goto("/");
  await signIn(page, "manager.a");
  await page.getByRole("link", { name: title }).click();
  await page.getByLabel(/Ý kiến/).fill("Tự duyệt");
  await page.getByRole("button", { name: "Duyệt" }).click();

  await expect(page.getByRole("alert")).toContainText("Quy tắc bốn mắt");
  expect(await outcome(request, "manager.a", instance)).toMatchObject({ ended: false });
});

test("người duyệt của đơn vị B không thấy, không mở, không duyệt được việc của đơn vị A", async ({ page, request }) => {
  const title = uniqueTitle("Hồ sơ của đơn vị A");
  const task = await taskOf(request, "manager.a", await submitApproval(request, "user.a", title));

  // Quyền Hasura: kiểm trên toàn kết quả, không dựa vào việc giao diện chỉ hiện đơn vị đầu tiên.
  expect(await visibleTenants(request, "manager.b")).toEqual(["xa-b"]);

  // manager.b có cùng vai trò duyệt với manager.a, nên không thấy việc của A chỉ có thể do cách ly đơn vị.
  const tasksLoaded = page.waitForResponse((response) => response.url().endsWith("/v1/workflow/tasks"));
  await page.goto("/");
  await signIn(page, "manager.b");
  await tasksLoaded;
  await expect(page.getByRole("heading", { name: "Việc của tôi" })).toBeVisible();
  await expect(page.getByText("Xã B (Tỉnh Mẫu)")).toBeVisible();
  await expect(page.getByRole("link", { name: title })).toHaveCount(0);

  await page.goto(`/tasks/${task}`);
  await expect(page.getByRole("heading", { name: "Việc này không còn chờ bạn" })).toBeVisible();
  // Gọi thẳng API như người cố tình: việc của đơn vị khác trả 404, không lộ là có tồn tại.
  expect(await complete(request, "manager.b", task, { approved: true })).toBe(404);

  // Dọn: người duyệt của A xử lý hồ sơ, để bảng việc demo không tích việc do bài kiểm để lại.
  expect(await complete(request, "manager.a", task, { approved: false })).toBe(204);
});
