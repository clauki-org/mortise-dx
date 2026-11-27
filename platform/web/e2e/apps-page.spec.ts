// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Trang "Ứng dụng" trên trình duyệt (ADR 0065): quản trị tỉnh (tenant gốc) mở trang từ nhóm "Chung", tắt một gói thì
// nhóm của gói mất khỏi menu và trang chủ của chính mình, cán bộ xã A (tenant con) không còn đọc được mục menu của gói
// qua GraphQL; bật lại thì nhóm hiện như cũ. Quản trị xã A không thấy mục "Ứng dụng". Bài chọn gói từ API (gói đang bật
// mà không gói đang bật nào cần, có mục quản trị tỉnh thấy), nên không biết tên gói nào; trạng thái được trả về như cũ
// kể cả khi bài hỏng giữa chừng, vì mọi bài sau đọc menu của gói. Cần ít nhất một gói có mục menu đã cài.

import { expect, test } from "@playwright/test";
import { graphql, openMenuItem, signIn } from "./support.ts";

type PackageRow = { app: string; name: string; requires: string[]; enabled: boolean };
type MenuRow = { app: string; roles: string[] | null };

const ADMIN = "admin.tinh";
const CHILD_ADMIN = "admin.a";
const USER = "user.a";

const PACKAGES = "{ platform_apps_by_tenant(order_by: { name: asc }) { app name requires enabled } }";
const SET = `mutation($app: String!, $enabled: Boolean!) { insert_platform_app_states_one(
  object: { app: $app, enabled: $enabled },
  on_conflict: { constraint: app_states_pkey, update_columns: [enabled] }) { enabled } }`;
const MENU = "query($app: String!) { platform_menu_items(where: { app: { _eq: $app } }) { app roles } }";

/** Gói thử: đang bật, không gói đang bật nào cần, có ít nhất một mục mà quản trị tỉnh thấy trên menu. */
async function pickPackage(request: Parameters<typeof graphql>[0]): Promise<PackageRow> {
  const { platform_apps_by_tenant: rows } = await graphql<{ platform_apps_by_tenant: PackageRow[] }>(
    request,
    ADMIN,
    PACKAGES,
    {},
    "tenant_admin",
  );
  for (const row of rows) {
    if (!row.enabled || rows.some((other) => other.enabled && other.requires.includes(row.app))) continue;
    const { platform_menu_items: items } = await graphql<{ platform_menu_items: MenuRow[] }>(request, ADMIN, MENU, {
      app: row.app,
    });
    if (items.some((item) => !item.roles?.length || item.roles.some((role) => ["user", "tenant_admin"].includes(role))))
      return row;
  }
  throw new Error("cần một gói đang bật có mục menu đã cài (make app-install APP=<gói>)");
}

const menuCount = async (request: Parameters<typeof graphql>[0], app: string) =>
  (await graphql<{ platform_menu_items: MenuRow[] }>(request, USER, MENU, { app })).platform_menu_items.length;

test("quản trị org tắt một gói thì menu và trang chủ của gói mất ở mọi đơn vị, bật lại thì hiện như cũ", async ({
  page,
  request,
}) => {
  const target = await pickPackage(request);
  expect(await menuCount(request, target.app), "cán bộ xã A đọc được mục của gói trước khi tắt").toBeGreaterThan(0);
  try {
    await page.goto("/");
    await signIn(page, ADMIN);
    const nav = page.getByRole("navigation", { name: "Menu chính" });
    const group = nav.getByText(target.name, { exact: true });
    await expect(group).toBeAttached();
    await openMenuItem(page, "Ứng dụng");
    await expect(page).toHaveURL(/\/packages$/);
    await expect(page.getByRole("heading", { level: 1, name: "Ứng dụng" })).toBeVisible();

    const toggle = page.getByRole("switch", { name: `Bật gói ${target.name}` });
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeEnabled();
    // Ô input của Mantine Switch không có kích thước; bấm vào nhãn bọc nó như người dùng bấm vào nút gạt.
    await toggle.locator("xpath=ancestor::label[1]").click();
    await expect(toggle).not.toBeChecked();
    await expect(group).toHaveCount(0);
    expect(await menuCount(request, target.app), "tenant con không còn đọc được mục của gói tắt").toBe(0);

    // Mở trang chủ bằng menu, không tải lại trang: trang chủ dựng từ đúng menu vừa kiểm ở trên.
    await openMenuItem(page, "Trang chủ");
    await expect(page.getByRole("heading", { level: 2, name: "Việc đang chờ bạn" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: target.name })).toHaveCount(0);

    await openMenuItem(page, "Ứng dụng");
    await toggle.locator("xpath=ancestor::label[1]").click();
    await expect(toggle).toBeChecked();
    await expect(group).toBeAttached();
    expect(await menuCount(request, target.app), "bật lại thì tenant con đọc lại được").toBeGreaterThan(0);
  } finally {
    await graphql(request, ADMIN, SET, { app: target.app, enabled: true }, "tenant_admin");
  }
});

test("quản trị đơn vị con không thấy mục Ứng dụng, mở thẳng đường dẫn thì được báo không có quyền", async ({
  page,
}) => {
  await page.goto("/packages");
  await signIn(page, CHILD_ADMIN);
  // Lời báo hiện khi đã đọc xong tenant, nên sau đó menu đã quyết định có mục "Ứng dụng" hay không.
  await expect(page.getByText("Chỉ quản trị org mở được trang này")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Menu chính" });
  await expect(nav.getByRole("link", { name: "Việc của tôi", includeHidden: true })).toBeAttached();
  await expect(nav.getByRole("link", { name: "Ứng dụng", includeHidden: true })).toHaveCount(0);
});
