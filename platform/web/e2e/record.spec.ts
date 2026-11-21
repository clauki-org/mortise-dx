// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Lập hồ sơ từ một dòng danh mục trên trình duyệt (ADR 0026). Cán bộ xã A mở cơ sở được phân công, bấm "Lập hồ sơ
// rà soát", xem phần vượt của xã rồi bấm đúp nút gửi. Người duyệt xã A thấy đúng một hồ sơ cho cơ sở đó trên bảng
// việc; người duyệt xã B không thấy. Nút và biến khai trong cấu hình của gói. Cần gói đã cài
// (`make app-install APP=facilities-commune`); bài tự tạo và tự dọn dữ liệu. Nhánh của hồ sơ (báo cáo hay công khai)
// tùy phần vượt của xã A lúc chạy, nên bài không khẳng định bước nào.

import { type APIRequestContext, expect, test } from "@playwright/test";
import { complete, graphql, signIn, subOf, token, uniqueTitle } from "./support.ts";

const ADMIN = "tenant_admin";
const PREFIX = "app_facilities_commune";

type Task = { id: string; process: string; variables: Record<string, unknown> };

/** Việc đang chờ một tài khoản mà biến facilityId trỏ tới cơ sở đã cho. */
async function reviewsOf(request: APIRequestContext, username: string, facilityId: string): Promise<Task[]> {
  const response = await request.get("/v1/workflow/tasks", {
    headers: { Authorization: `Bearer ${await token(request, username)}` },
  });
  expect(response.ok(), `GET /v1/workflow/tasks với ${username}`).toBeTruthy();
  const tasks: Task[] = await response.json();
  return tasks.filter((task) => task.process === "facilities-review" && task.variables.facilityId === facilityId);
}

test("cán bộ xã A lập hồ sơ rà soát từ cơ sở; người duyệt xã A thấy đúng một hồ sơ, xã B không thấy", async ({
  browser,
  page,
  request,
}) => {
  const code = uniqueTitle("e2e-hs").replaceAll(" ", "-");
  const name = `Trụ sở lập hồ sơ ${code}`;
  let facilityId: string | undefined;
  let passed = false;
  try {
    const created = await graphql<{ row: { id: string } }>(
      request,
      "admin.a",
      `mutation($code: String!, $name: String!) { row: insert_${PREFIX}_facilities_one(object: {code: $code, name: $name}) { id } }`,
      { code, name },
      ADMIN,
    );
    facilityId = created.row.id;
    await graphql(
      request,
      "admin.a",
      `mutation($f: uuid!, $u: String!) { insert_${PREFIX}_facility_assignments_one(object: {facility_id: $f, user_id: $u, duty: "custodian"}) { id } }`,
      { f: facilityId, u: await subOf(request, "user.a") },
      ADMIN,
    );
    // Số mà hồ sơ phải mang: phần vượt của cả xã A như cán bộ đọc được.
    const summary = await graphql<{ rows: { excess_m2: number }[] }>(
      request,
      "user.a",
      `query { rows: ${PREFIX}_area_summary { excess_m2 } }`,
      {},
    );
    const excess = summary.rows[0]?.excess_m2;
    expect(typeof excess, "Hasura trả phần vượt dạng số").toBe("number");

    await page.goto("/");
    await signIn(page, "user.a");
    await page.getByRole("link", { name: "Cơ sở nhà, đất" }).click();
    await page.getByRole("textbox", { name: "Tìm" }).fill(code);
    await page.getByRole("button", { name: "Tìm" }).click();
    await page.getByRole("link", { name: code }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

    await page.getByRole("button", { name: "Lập hồ sơ rà soát" }).click();
    const dialog = page.getByRole("dialog", { name: "Lập hồ sơ rà soát" });
    await expect(dialog.getByRole("row", { name: new RegExp(`Tên cơ sở\\s*${name}`) })).toBeVisible();
    await expect(dialog.getByRole("row", { name: /Phần vượt tiêu chuẩn của xã/ })).toBeVisible();
    // Bấm đúp. Nút khóa khi đang gửi nên lần bấm thứ hai có thể không gửi gì; khẳng định trên mọi yêu cầu đã đi để
    // biết chúng mang Idempotency-Key và cùng một mã, thay vì chỉ dựa vào việc khóa nút.
    const keys: (string | undefined)[] = [];
    page.on("request", (sent) => {
      if (sent.method() === "POST" && sent.url().includes("/v1/workflow/processes/facilities-review/instances")) {
        keys.push(sent.headers()["idempotency-key"]);
      }
    });
    await dialog.getByRole("button", { name: "Gửi" }).dblclick();
    await expect(page.getByText("Đã gửi: Lập hồ sơ rà soát")).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(new Set(keys).size, "mọi lần gửi trong cùng hộp dùng một mã").toBe(1);

    const reviews = await reviewsOf(request, "manager.a", facilityId);
    expect(reviews, "đúng một hồ sơ cho cơ sở sau khi bấm đúp").toHaveLength(1);
    expect(reviews[0]?.variables).toMatchObject({ title: name, facilityId, excessM2: excess });
    expect(await reviewsOf(request, "manager.b", facilityId)).toEqual([]);

    // Người duyệt xã A thấy hồ sơ trên bảng việc theo tên cơ sở và mở được nó. Phiên trình duyệt riêng: phiên đăng
    // nhập của cán bộ vẫn còn trong trang cũ.
    const { baseURL, locale } = test.info().project.use;
    const reviewer = await (await browser.newContext({ baseURL, locale })).newPage();
    await reviewer.goto("/");
    await signIn(reviewer, "manager.a");
    await reviewer.getByRole("link", { name }).click();
    await expect(reviewer.getByRole("heading", { level: 1, name })).toBeVisible();
    await reviewer.context().close();
    passed = true;
  } finally {
    const problems = facilityId ? await cleanUp(request, facilityId) : [];
    // Bài đã hỏng thì lỗi gốc là lỗi cần đọc: ném lỗi dọn ở đây sẽ thay mất nó, nên chỉ in ra.
    if (passed) {
      expect(problems, "dọn dữ liệu kiểm thử").toEqual([]);
    } else if (problems.length > 0) {
      console.warn(`Dọn dữ liệu kiểm thử chưa xong:\n${problems.join("\n")}`);
    }
  }
});

/**
 * Người duyệt trả lại mọi hồ sơ của cơ sở, kể cả khi bài hỏng giữa chừng, để bảng việc demo không tích việc; rồi xóa
 * cơ sở (phân công đi theo, CASCADE). Trả danh sách lỗi thay vì ném, để nơi gọi quyết định có báo hay không.
 */
async function cleanUp(request: APIRequestContext, facilityId: string): Promise<string[]> {
  const problems: string[] = [];
  try {
    for (const task of await reviewsOf(request, "manager.a", facilityId)) {
      const status = await complete(request, "manager.a", task.id, { approved: false });
      if (status !== 204) problems.push(`trả lại hồ sơ ${task.id}: ${status}`);
    }
  } catch (error) {
    problems.push(`tìm hồ sơ của cơ sở ${facilityId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await graphql(
      request,
      "admin.a",
      `mutation($id: uuid!) { delete_${PREFIX}_facilities_by_pk(id: $id) { id } }`,
      { id: facilityId },
      ADMIN,
    );
  } catch (error) {
    problems.push(`xóa cơ sở ${facilityId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return problems;
}
