// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Đi hết kịch bản demo chỉ bằng bàn phím (#194): cán bộ xã A mở mục menu của danh mục cơ sở, mở một cơ sở, mở hộp
// "Lập hồ sơ rà soát", đóng bằng Escape, mở lại rồi gửi. Sau khi đăng nhập bài không bấm chuột và không gọi focus():
// mỗi điều khiển phải tới được bằng Tab trong một số bước có hạn (không tới được là bài hỏng), và lúc đứng trên nó phải
// thấy viền tiêu điểm. Chạy ở cỡ laptop (dự án chromium). Bài tự tạo một cơ sở riêng phân công cho user.a như bài đếm
// số lần bấm (visual.spec.ts), không lập hồ sơ trên trụ sở demo: bước dọn tìm hồ sơ theo cơ sở, trên trụ sở dùng
// chung sẽ trả lại cả hồ sơ của bài khác. Bài thứ hai kiểm menu gập trên màn hình hẹp.

import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";
import { complete, graphql, signIn, subOf, token, uniqueTitle } from "./support.ts";

const PREFIX = "app_facilities_commune";
// Đủ để đi qua thanh trên, cả menu và các ô lọc của danh mục; quá số này thì coi như không tới được.
const MAX_TABS = 80;

/** Có phải phần tử đang giữ tiêu điểm của trang không. */
const isActive = (target: Locator) => target.evaluate((el) => el === el.ownerDocument.activeElement).catch(() => false);

/** Nhấn Tab (hay Shift+Tab) tới khi `target` nhận tiêu điểm, rồi kiểm viền tiêu điểm hiện ra. */
async function tabTo(page: Page, target: Locator, label: string, key = "Tab") {
  for (let step = 0; step < MAX_TABS; step++) {
    await page.keyboard.press(key);
    if (await isActive(target)) {
      await expectFocusRing(target, label);
      return;
    }
  }
  throw new Error(`Nhấn ${key} ${MAX_TABS} lần không tới được ${label}`);
}

/** Tiêu điểm đến từ bàn phím (:focus-visible) và có viền thấy được. */
async function expectFocusRing(target: Locator, label: string) {
  await expect(target, label).toBeFocused();
  const ring = await target.evaluate((el) => {
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    return {
      visible: el.matches(":focus-visible"),
      outline: !!style && style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0,
    };
  });
  expect(ring, `viền tiêu điểm trên ${label}`).toEqual({ visible: true, outline: true });
}

type Task = { id: string; process: string; variables: Record<string, unknown> };

async function reviewsOf(request: APIRequestContext, id: string): Promise<Task[]> {
  const response = await request.get("/v1/workflow/tasks", {
    headers: { Authorization: `Bearer ${await token(request, "manager.a")}` },
  });
  expect(response.ok(), "GET /v1/workflow/tasks với manager.a").toBeTruthy();
  const tasks: Task[] = await response.json();
  return tasks.filter((task) => task.process === "facilities-review" && task.variables.facilityId === id);
}

test("cán bộ xã A lập hồ sơ rà soát từ cơ sở chỉ bằng bàn phím", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const code = uniqueTitle("e2e-phim").replaceAll(" ", "-");
  const name = `Trụ sở bàn phím ${code}`;
  const created = await graphql<{ row: { id: string } }>(
    request,
    "admin.a",
    `mutation($code: String!, $name: String!) { row: insert_${PREFIX}_facilities_one(object: {code: $code, name: $name}) { id } }`,
    { code, name },
    "tenant_admin",
  );
  const id = created.row.id;
  try {
    await graphql(
      request,
      "admin.a",
      `mutation($f: uuid!, $u: String!) { insert_${PREFIX}_facility_assignments_one(object: {facility_id: $f, user_id: $u, duty: "custodian"}) { id } }`,
      { f: id, u: await subOf(request, "user.a") },
      "tenant_admin",
    );

    await page.goto("/");
    await signIn(page, "user.a");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

    // Mục menu nằm trong nhóm của gói; nhóm đang thu gọn thì mở bằng Enter trên nút của nhóm (MenuNav.tsx).
    const nav = page.getByRole("navigation", { name: "Menu chính" });
    const menuLink = nav.getByRole("link", { name: "Cơ sở nhà, đất", exact: true });
    // Tạo từ page chứ không từ nav, như openMenuItem (support.ts): locator trong `has` tìm bên trong từng nhóm.
    const anyLink = page.getByRole("link", { name: "Cơ sở nhà, đất", exact: true, includeHidden: true });
    await nav.locator(anyLink).waitFor({ state: "attached" });
    if (!(await menuLink.isVisible())) {
      const toggle = nav.getByRole("group").filter({ has: anyLink }).getByRole("button", { expanded: false });
      await tabTo(page, toggle, "nút mở nhóm menu");
      await page.keyboard.press("Enter");
    }
    await tabTo(page, menuLink, "mục menu Cơ sở nhà, đất");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/apps\/facilities-commune\/facilities$/);

    const rowLink = page.getByRole("link", { name: code, exact: true });
    await expect(rowLink).toBeVisible();
    await tabTo(page, rowLink, "dòng cơ sở trên danh sách");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

    const trigger = page.getByRole("button", { name: "Lập hồ sơ rà soát" });
    await tabTo(page, trigger, "nút Lập hồ sơ rà soát");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Lập hồ sơ rà soát" });
    await expect(dialog).toBeVisible();
    // Hộp giữ tiêu điểm bên trong; Escape đóng hộp và trả tiêu điểm về nút đã mở nó.
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expectFocusRing(trigger, "nút Lập hồ sơ rà soát sau khi đóng hộp");

    // Mở lại bằng phím cách, đi tới nút Gửi, lùi một bước về Hủy bằng Shift+Tab, rồi gửi bằng Enter.
    await page.keyboard.press("Space");
    await expect(dialog).toBeVisible();
    const send = dialog.getByRole("button", { name: "Gửi" });
    await tabTo(page, send, "nút Gửi trong hộp");
    await tabTo(page, dialog.getByRole("button", { name: "Hủy" }), "nút Hủy trong hộp", "Shift+Tab");
    await tabTo(page, send, "nút Gửi trong hộp");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Đã gửi: Lập hồ sơ rà soát")).toBeVisible();
    await expect.poll(async () => (await reviewsOf(request, id)).length, { message: "hồ sơ vừa lập" }).toBe(1);
  } finally {
    // Như bài đếm số lần bấm: người duyệt trả lại hồ sơ vừa lập rồi xóa cơ sở (phân công đi theo, CASCADE).
    try {
      for (const task of await reviewsOf(request, id)) {
        await complete(request, "manager.a", task.id, { approved: false });
      }
    } catch (error) {
      console.warn(`Trả lại hồ sơ của cơ sở ${id} chưa xong: ${error instanceof Error ? error.message : error}`);
    }
    await graphql(
      request,
      "admin.a",
      `mutation($id: uuid!) { delete_${PREFIX}_facilities_by_pk(id: $id) { id } }`,
      { id },
      "tenant_admin",
    );
  }
});

test("trên màn hình hẹp, menu đang gập không nhận Tab; mở bằng nút menu thì tới được mục menu", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto("/apps/facilities-commune/facilities");
  await signIn(page, "user.a");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

  // Thanh bên gập nằm ngoài màn hình; Tab dừng ở đó thì người dùng mất dấu tiêu điểm.
  // Tám bước đủ đi qua chỗ của thanh bên (nút menu, rồi tới các mục menu nếu chúng nhận Tab).
  for (let step = 0; step < 8; step++) {
    await page.keyboard.press("Tab");
    const box = await page.locator(":focus").boundingBox({ timeout: 1_000 });
    expect(box?.x ?? 0, `phần tử nhận Tab thứ ${step + 1} nằm trong màn hình`).toBeGreaterThanOrEqual(0);
  }

  const burger = page.getByRole("button", { name: "Mở menu" });
  await tabTo(page, burger, "nút mở menu", "Shift+Tab");
  await page.keyboard.press("Enter");
  const nav = page.getByRole("navigation", { name: "Menu chính" });
  await tabTo(page, nav.getByRole("link", { name: "Việc của tôi", exact: true }), "mục menu Việc của tôi");
});
