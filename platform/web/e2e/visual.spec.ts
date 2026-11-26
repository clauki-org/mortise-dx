// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Chụp và đo các trang của kịch bản demo để so trước và sau khi làm lại giao diện (#188). Mỗi trang mở thẳng bằng
// đường dẫn, không bấm menu, để cùng bài này chụp được cả khi menu đã đổi. Ảnh toàn trang và báo cáo trợ năng (axe)
// gắn vào kết quả của Playwright (thư mục test-results), không commit làm ảnh mẫu; báo cáo trợ năng chỉ để đọc, không
// làm bài hỏng. Chạy ở cỡ laptop 1440×900 (dự án chromium) và cỡ điện thoại (dự án mobile, Pixel 7). Bài cuối đếm
// số lần bấm để cán bộ xã A lập một hồ sơ rà soát từ cơ sở, đi qua menu như người dùng; bài tự tạo và tự dọn dữ liệu.

import { writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { complete, graphql, signIn, subOf, token, uniqueTitle } from "./support.ts";

const PREFIX = "app_facilities_commune";
const MOBILE = "mobile";

// Tên tệp kết quả mang cỡ màn hình đứng trước, để chép ra một thư mục phẳng vẫn đọc được.
const sizeOf = (testInfo: TestInfo) => (testInfo.project.name === MOBILE ? "mobile" : "desktop");

test.beforeEach(async ({ page }, testInfo) => {
  // Dự án chromium dùng chung với các bài khác nên không đổi cỡ trong cấu hình; chỉ bài này đặt cỡ laptop. Dự án
  // mobile giữ nguyên cỡ của thiết bị.
  if (testInfo.project.name !== MOBILE) await page.setViewportSize({ width: 1440, height: 900 });
});

/** Chờ trang vẽ xong: có tiêu đề trang, hết vòng "Đang tải", mạng lặng (bản đồ có thể không bao giờ lặng hẳn). */
async function settle(page: Page) {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.locator('[aria-label^="Đang tải"]')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}

type Impacts = Record<string, number>;

/** Ghi JSON thành tệp trong thư mục kết quả rồi gắn vào: gắn bằng body thì chỉ báo cáo HTML giữ, không có tệp để chép. */
async function attachJson(testInfo: TestInfo, name: string, data: object) {
  const path = testInfo.outputPath(name);
  await writeFile(path, JSON.stringify(data, null, 2));
  await testInfo.attach(name, { path, contentType: "application/json" });
}

/** Ảnh toàn trang và báo cáo axe của trang đang mở, gắn vào kết quả dưới tên `<cỡ>-<tên>`. */
async function capture(page: Page, testInfo: TestInfo, name: string) {
  const file = `${sizeOf(testInfo)}-${name}`;
  const shot = testInfo.outputPath(`${file}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  await testInfo.attach(`${file}.png`, { path: shot, contentType: "image/png" });

  // Lỗi khi chạy axe (CSP chặn, trang đổi giữa chừng) chỉ ghi lại: báo cáo trợ năng chưa chặn bài nào (#188).
  let report: object;
  try {
    const result = await new AxeBuilder({ page }).analyze();
    const impacts: Impacts = {};
    for (const violation of result.violations) {
      const impact = violation.impact ?? "unknown";
      impacts[impact] = (impacts[impact] ?? 0) + 1;
    }
    report = {
      url: page.url(),
      impacts,
      violations: result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        targets: violation.nodes.map((node) => node.target.join(" ")),
      })),
    };
  } catch (error) {
    report = { url: page.url(), error: error instanceof Error ? error.message : String(error) };
  }
  await attachJson(testInfo, `${file}.axe.json`, report);
}

async function facilityId(request: APIRequestContext, code: string): Promise<string> {
  const data = await graphql<{ rows: { id: string }[] }>(
    request,
    "user.a",
    `query($code: String!) { rows: ${PREFIX}_facilities(where: {code: {_eq: $code}}) { id } }`,
    { code },
  );
  const id = data.rows[0]?.id;
  if (!id) throw new Error(`user.a không thấy cơ sở ${code}: chạy \`make seed-demo\``);
  return id;
}

// Các trang cán bộ xã A (user.a) mở trong kịch bản demo; đường dẫn là /apps/<gói>/<mục menu> (menu.ts).
const PAGES: { name: string; path: (request: APIRequestContext) => Promise<string> | string }[] = [
  { name: "dashboard", path: () => "/apps/facilities-commune/dashboard" },
  { name: "facilities", path: () => "/apps/facilities-commune/facilities" },
  {
    name: "facility-detail",
    path: async (request) => `/apps/facilities-commune/facilities/${await facilityId(request, "TS-A1")}`,
  },
  { name: "form-supply-request", path: () => "/apps/supplies-commune/supply-request" },
  { name: "cases-reviews", path: () => "/apps/facilities-commune/reviews" },
  { name: "cases-supply-requests", path: () => "/apps/supplies-commune/my-requests" },
  { name: "map", path: () => "/apps/facilities-commune/map" },
  { name: "assistant-data", path: () => "/apps/facilities-commune/ask-data" },
];

for (const { name, path } of PAGES) {
  test(`chụp trang ${name} của cán bộ xã A`, async ({ page, request }, testInfo) => {
    // Mở thẳng đường dẫn rồi đăng nhập: đăng nhập xong quay lại đúng trang đó.
    await page.goto(await path(request));
    await signIn(page, "user.a");
    await settle(page);
    await capture(page, testInfo, name);
  });
}

// Một bài cho người duyệt: mỗi lần đăng nhập tốn một mã OTP.
test("chụp trang Việc của tôi của người duyệt xã A", async ({ page }, testInfo) => {
  await page.goto("/tasks");
  await signIn(page, "manager.a");
  await settle(page);
  await capture(page, testInfo, "tasks");
});

type Task = { id: string; process: string; variables: Record<string, unknown> };

async function reviewsOf(request: APIRequestContext, id: string): Promise<Task[]> {
  const response = await request.get("/v1/workflow/tasks", {
    headers: { Authorization: `Bearer ${await token(request, "manager.a")}` },
  });
  expect(response.ok(), "GET /v1/workflow/tasks với manager.a").toBeTruthy();
  const tasks: Task[] = await response.json();
  return tasks.filter((task) => task.process === "facilities-review" && task.variables.facilityId === id);
}

test("đếm số lần bấm để cán bộ xã A lập một hồ sơ rà soát từ cơ sở", async ({ page, request }, testInfo) => {
  // Cơ sở riêng của bài, phân công cho user.a, để không để lại hồ sơ trên trụ sở demo.
  const code = uniqueTitle("e2e-bam").replaceAll(" ", "-");
  const name = `Trụ sở đếm bấm ${code}`;
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

    // Đếm từ trang chủ sau khi đăng nhập; hai lần bấm của đăng nhập ghi riêng vì không thuộc giao diện của nền tảng.
    await page.goto("/");
    await signIn(page, "user.a");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

    const steps: string[] = [];
    const click = async (target: Locator, label: string) => {
      steps.push(label);
      await target.click();
    };
    // Trên điện thoại menu gập lại sau nút mở menu; nút đó cũng là một lần bấm.
    const burger = page.getByRole("button", { name: /^Mở menu/ });
    if (await burger.isVisible()) await click(burger, "Mở menu");
    await click(page.getByRole("link", { name: "Cơ sở nhà, đất", exact: true }), "Menu: Cơ sở nhà, đất");
    await click(page.getByRole("link", { name: code, exact: true }), "Dòng cơ sở trên danh sách");
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await click(page.getByRole("button", { name: "Lập hồ sơ rà soát" }), "Nút Lập hồ sơ rà soát");
    const dialog = page.getByRole("dialog", { name: "Lập hồ sơ rà soát" });
    await expect(dialog).toBeVisible();
    // Hộp hiện dần (Mantine Transition); chụp ngay khi mới hiện thì ảnh chưa có hộp.
    await expect(dialog).toHaveCSS("opacity", "1");
    await capture(page, testInfo, "review-dialog");
    await click(dialog.getByRole("button", { name: "Gửi" }), "Nút Gửi trong hộp xác nhận");
    await expect(page.getByText("Đã gửi: Lập hồ sơ rà soát")).toBeVisible();

    await attachJson(testInfo, `${sizeOf(testInfo)}-click-count.json`, {
      scenario: "cán bộ xã A lập một hồ sơ rà soát từ cơ sở",
      clicks: steps.length,
      steps,
      // Không gõ phím nào; hai lần bấm của trang đăng nhập Keycloak không tính vào clicks.
      typing: 0,
      login: 2,
    });
  } finally {
    // Người duyệt trả lại hồ sơ vừa lập rồi xóa cơ sở (phân công đi theo, CASCADE), như record.spec.ts.
    // Lỗi khi trả hồ sơ không được bỏ qua bước xóa cơ sở, kẻo cơ sở thử nằm lại trên danh mục demo.
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
