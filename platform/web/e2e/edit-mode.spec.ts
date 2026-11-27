// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Chế độ Chỉnh sửa trên trang (ADR 0070), qua gói cơ sở vật chất xã. Quản trị tỉnh (tenant gốc của org) bật "Chỉnh
// sửa" trên trang "Tổng quan", đổi khối danh mục cơ sở sang Kanban, rồi trên danh mục cơ sở đổi nhãn cột "Địa chỉ",
// lưu; cán bộ xã A (tenant con) thấy cả hai. "Về mặc định" trên danh mục cơ sở xóa phần chỉnh, cán bộ xã A thấy lại
// nhãn của gói. Cán bộ xã A không có nút "Chỉnh sửa". Axe đo trang khi bảng chỉnh đang mở. Phần chỉnh của hai mục được
// xóa qua API kể cả khi bài hỏng giữa chừng, vì các bài khác đọc nhãn cột của danh mục này. Cần gói đã cài
// và dữ liệu demo (`make app-install APP=facilities-commune`, `make seed-demo`): cán bộ xã A phụ trách cơ sở có sẵn.

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { graphql, openMenuItem, signIn } from "./support.ts";

const APP = "facilities-commune";
const ADMIN = "admin.tinh";
const RENAMED = "Địa chỉ trụ sở";
const RESET = `mutation($app: String!, $items: [String!]!) {
  delete_platform_config_overrides(where: { app: { _eq: $app }, item: { _in: $items } }) { affected_rows } }`;

async function blocking(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  return result.violations
    .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

async function save(page: Page) {
  const panel = page.getByRole("region", { name: "Chỉnh sửa trang" });
  await panel.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText(/^Đã lưu \d+ thay đổi\.$/);
  await expect(panel.getByText("Chưa có thay đổi chờ lưu.")).toBeVisible();
}

test("quản trị org đổi khối sang Kanban và đổi nhãn cột, đơn vị con thấy, Về mặc định trả lại như gói", async ({
  page,
  browser,
  request,
}) => {
  try {
    await page.goto("/");
    await signIn(page, ADMIN);
    await openMenuItem(page, "Tổng quan");
    await page.getByRole("button", { name: "Chỉnh sửa" }).click();
    const panel = page.getByRole("region", { name: "Chỉnh sửa trang" });
    await panel.getByRole("combobox", { name: 'Kiểu của khối "Cơ sở nhà, đất"' }).selectOption("kanban");
    await expect(panel.getByText("1 thay đổi chờ lưu:")).toBeVisible();
    expect(await blocking(page), "lỗi trợ năng khi bảng chỉnh đang mở").toEqual([]);
    await save(page);

    await openMenuItem(page, "Cơ sở nhà, đất");
    await page.getByRole("button", { name: "Chỉnh sửa" }).click();
    const label = panel.getByRole("textbox", { name: 'Nhãn của cột "Địa chỉ"' });
    await label.fill(RENAMED);
    await label.press("Enter");
    await save(page);
    // Tỉnh không đọc được bảng cơ sở của xã nên danh sách của quản trị tỉnh rỗng; nhãn mới kiểm ở ô của bảng chỉnh.
    await expect(label).toHaveValue(RENAMED);

    const context = await browser.newContext();
    const child = await context.newPage();
    await child.goto("/");
    await signIn(child, "user.a");
    await openMenuItem(child, "Tổng quan");
    const block = child.getByRole("region", { name: "Cơ sở nhà, đất" }).first();
    await expect(block.getByRole("radio", { name: "Kanban" })).toBeChecked();
    await expect(child.getByRole("button", { name: "Chỉnh sửa" })).toHaveCount(0);
    await openMenuItem(child, "Cơ sở nhà, đất");
    await expect(child.getByRole("columnheader", { name: RENAMED })).toBeVisible();

    await panel.getByRole("button", { name: "Về mặc định" }).click();
    await save(page);
    await expect(label).toHaveValue("Địa chỉ");
    await child.reload();
    await expect(child.getByRole("columnheader", { name: "Địa chỉ", exact: true })).toBeVisible();
    await expect(child.getByRole("columnheader", { name: RENAMED })).toHaveCount(0);
    await context.close();
  } finally {
    await graphql(request, ADMIN, RESET, { app: APP, items: ["overview", "facilities"] }, "tenant_admin");
  }
});
