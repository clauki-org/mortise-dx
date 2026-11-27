// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thành phần theo dõi hồ sơ trên trình duyệt (ADR 0032), qua trang "Đề nghị đã lập" của gói kho vật tư. Cán bộ xã A
// lập đề nghị bằng biểu mẫu, mở hồ sơ vừa lập và thấy bước duyệt đang chờ vai trò manager; người duyệt xã A duyệt
// kèm ý kiến; cán bộ tải lại và thấy kết quả "Đã duyệt" mà không thấy ý kiến. Quản trị cùng xã và cán bộ xã B mở
// cùng đường dẫn thì không thấy hồ sơ. Cần gói đã cài (`make app-install APP=supplies-commune`); bài tự tạo và tự
// dọn dữ liệu.

import { type APIRequestContext, expect, test } from "@playwright/test";
import { complete, graphql, openMenuItem, signIn, token, uniqueTitle } from "./support.ts";

const PREFIX = "app_supplies_commune";
const COMMENT = "Ý kiến riêng của người duyệt";

async function pendingOf(request: APIRequestContext, title: string): Promise<string[]> {
  const response = await request.get("/v1/workflow/tasks", {
    headers: { Authorization: `Bearer ${await token(request, "manager.a")}` },
  });
  expect(response.ok()).toBeTruthy();
  const tasks: { id: string; process: string; variables: Record<string, unknown> }[] = await response.json();
  return tasks.filter((task) => task.process === "supply-request" && task.variables.title === title).map((t) => t.id);
}

async function stores(request: APIRequestContext, mutation: string, variables: object) {
  await graphql(request, "admin.a", mutation, variables, "tenant_admin");
}

test("cán bộ xã A theo dõi đề nghị vừa lập tới khi được duyệt, không thấy ý kiến; người khác không mở được", async ({
  browser,
  page,
  request,
}) => {
  const code = uniqueTitle("e2e-hs").replaceAll(" ", "-");
  const title = `Đề nghị theo dõi ${code}`;
  try {
    await stores(
      request,
      `mutation($c: String!) { insert_${PREFIX}_stores_one(object: {code: $c, name: $c}) { id }
        insert_${PREFIX}_items_one(object: {store_code: $c, code: $c, name: $c, unit: "cái", kind: "consumable",
        quantity: 5}) { id } }`,
      { c: code },
    );
    await page.goto("/");
    await signIn(page, "user.a");
    await openMenuItem(page, "Lập đề nghị cấp vật tư");
    await page.getByRole("combobox", { name: "Kho" }).click();
    await page.getByRole("option", { name: code }).click();
    await page.getByRole("combobox", { name: "Mặt hàng" }).click();
    await page.getByRole("option", { name: code }).click();
    await page.getByLabel(/Tên đề nghị/).fill(title);
    await page.getByLabel(/Số lượng/).fill("2");
    await page.getByLabel(/Lý do/).fill("Kiểm thử theo dõi hồ sơ");
    await page.getByRole("button", { name: "Gửi" }).click();

    await page.getByRole("link", { name: "Xem hồ sơ vừa lập" }).click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole("row", { name: /Đang ở bước\s*Duyệt đề nghị cấp vật tư/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Số lượng\s*2/ })).toBeVisible();
    await expect(page.getByText("Người xử lý: Vai trò manager")).toBeVisible();
    const url = page.url();

    // Trang danh sách: mặc định lọc hồ sơ đang xử lý, dòng ghi bước đang chờ.
    // Mục menu và đường quay lại danh sách trên màn hình hồ sơ cùng tên, cùng đích.
    await openMenuItem(page, "Đề nghị đã lập");
    await expect(page.getByRole("row", { name: new RegExp(`${title}\\s*Duyệt đề nghị cấp vật tư`) })).toBeVisible();

    const [task] = await pendingOf(request, title);
    expect(task, "người duyệt xã A thấy đề nghị").toBeDefined();
    expect(await complete(request, "manager.a", task ?? "", { approved: true, comment: COMMENT })).toBe(204);
    await page.goto(url);
    await expect(page.getByRole("row", { name: /Kết quả\s*Đã duyệt/ })).toBeVisible();
    await expect(page.getByText(COMMENT)).toHaveCount(0);
    // Hồ sơ đã duyệt rời khỏi bộ lọc đang xử lý và hiện ở bộ lọc đã kết thúc, kèm kết quả.
    await openMenuItem(page, "Đề nghị đã lập");
    await expect(page.getByRole("link", { name: title })).toHaveCount(0);
    await page.getByText("Đã kết thúc", { exact: true }).click();
    await expect(page.getByRole("row", { name: new RegExp(`${title}\\s*Đã duyệt`) })).toBeVisible();

    const { baseURL, locale } = test.info().project.use;
    for (const other of ["admin.a", "user.b"]) {
      const context = await browser.newContext({ baseURL, locale });
      const stranger = await context.newPage();
      // Mở thẳng đường dẫn rồi mới đăng nhập: đăng nhập xong quay lại đúng đường dẫn đó, như một dấu trang.
      await stranger.goto(url);
      await signIn(stranger, other);
      await expect(stranger.getByText("Không tìm thấy hồ sơ"), `${other} không mở được hồ sơ`).toBeVisible();
      await expect(stranger.getByText(title)).toHaveCount(0);
      await context.close();
    }
  } finally {
    for (const task of await pendingOf(request, title)) {
      await complete(request, "manager.a", task, { approved: false });
    }
    await stores(
      request,
      `mutation($c: String!) { delete_${PREFIX}_items(where: {store_code: {_eq: $c}}) { affected_rows }
        delete_${PREFIX}_stores(where: {code: {_eq: $c}}) { affected_rows } }`,
      { c: code },
    );
  }
});
