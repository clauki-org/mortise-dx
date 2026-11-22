// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thành phần biểu mẫu trên trình duyệt (ADR 0030), qua hai biểu mẫu của gói kho vật tư. Cán bộ xã A lập đề nghị cấp
// vật tư: chọn kho thì danh sách vật tư đổi theo kho, bấm đúp nút gửi mà chỉ có một hồ sơ, người duyệt xã A thấy hồ sơ
// kèm các giá trị đã điền, người duyệt xã B không thấy. Quản trị xã A thêm vật tư bằng biểu mẫu thêm dòng: yêu cầu
// không mang tenant_id, dòng thuộc xã A, quản trị xã B không thấy. Cần gói đã cài
// (`make app-install APP=supplies-commune`); bài tự tạo và tự dọn dữ liệu.

import { type APIRequestContext, expect, type Request, test } from "@playwright/test";
import { complete, graphql, signIn, token, uniqueTitle } from "./support.ts";

const ADMIN = "tenant_admin";
const PREFIX = "app_supplies_commune";

type Task = { id: string; process: string; variables: Record<string, unknown> };

/** Đề nghị đang chờ một tài khoản mang đúng tên này; CI chạy smoke trước nên có thể còn đề nghị khác. */
async function requestsOf(request: APIRequestContext, username: string, title: string): Promise<Task[]> {
  const response = await request.get("/v1/workflow/tasks", {
    headers: { Authorization: `Bearer ${await token(request, username)}` },
  });
  expect(response.ok(), `GET /v1/workflow/tasks với ${username}`).toBeTruthy();
  const tasks: Task[] = await response.json();
  return tasks.filter((task) => task.process === "supply-request" && task.variables.title === title);
}

async function addStore(request: APIRequestContext, code: string, name: string) {
  await graphql(
    request,
    "admin.a",
    `mutation($code: String!, $name: String!) { insert_${PREFIX}_stores_one(object: {code: $code, name: $name}) { id } }`,
    { code, name },
    ADMIN,
  );
}

async function addItem(request: APIRequestContext, store: string, code: string, name: string) {
  await graphql(
    request,
    "admin.a",
    `mutation($s: String!, $c: String!, $n: String!) { insert_${PREFIX}_items_one(object: {store_code: $s, code: $c,
      name: $n, unit: "cái", kind: "consumable", quantity: 10}) { id } }`,
    { s: store, c: code, n: name },
    ADMIN,
  );
}

/** Xóa vật tư rồi kho mang mã bắt đầu bằng `code` (RESTRICT); trả lỗi thay vì ném để lỗi gốc của bài không bị che. */
async function removeStores(request: APIRequestContext, code: string): Promise<string[]> {
  try {
    await graphql(
      request,
      "admin.a",
      `mutation($c: String!) { delete_${PREFIX}_items(where: {store_code: {_like: $c}}) { affected_rows }
        delete_${PREFIX}_stores(where: {code: {_like: $c}}) { affected_rows } }`,
      { c: `${code}%` },
      ADMIN,
    );
    return [];
  } catch (error) {
    return [`xóa kho ${code}: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function report(passed: boolean, problems: string[]) {
  // Bài đã hỏng thì lỗi gốc là lỗi cần đọc: ném lỗi dọn ở đây sẽ thay mất nó, nên chỉ in ra.
  if (passed) expect(problems, "dọn dữ liệu kiểm thử").toEqual([]);
  else if (problems.length > 0) console.warn(`Dọn dữ liệu kiểm thử chưa xong:\n${problems.join("\n")}`);
}

test("cán bộ xã A lập đề nghị trên web; người duyệt xã A thấy đúng một hồ sơ kèm giá trị đã điền, xã B không thấy", async ({
  browser,
  page,
  request,
}) => {
  const code = uniqueTitle("e2e-bm").replaceAll(" ", "-");
  const title = `Đề nghị kiểm thử ${code}`;
  const stores = { a: `${code}-a`, b: `${code}-b` };
  let passed = false;
  try {
    await addStore(request, stores.a, `Kho thử A ${code}`);
    await addStore(request, stores.b, `Kho thử B ${code}`);
    await addItem(request, stores.a, `${code}-va`, `Vật tư A ${code}`);
    await addItem(request, stores.b, `${code}-vb`, `Vật tư B ${code}`);

    await page.goto("/");
    await signIn(page, "user.a");
    await page.getByRole("link", { name: "Lập đề nghị cấp vật tư", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Lập đề nghị cấp vật tư" })).toBeVisible();

    const store = page.getByRole("combobox", { name: "Kho" });
    const item = page.getByRole("combobox", { name: "Vật tư" });
    await expect(item, "chưa chọn kho thì chưa chọn được vật tư").toBeDisabled();
    // Chọn kho B trước rồi đổi sang kho A: danh sách vật tư phải đổi theo kho và vật tư đã chọn bị xóa.
    await store.click();
    await page.getByRole("option", { name: `Kho thử B ${code}` }).click();
    await item.click();
    await page.getByRole("option", { name: `Vật tư B ${code}` }).click();
    await store.click();
    await page.getByRole("option", { name: `Kho thử A ${code}` }).click();
    await expect(item, "đổi kho thì vật tư đã chọn bị xóa").toHaveValue("");
    await item.click();
    await expect(page.getByRole("option", { name: `Vật tư B ${code}` })).toHaveCount(0);
    await page.getByRole("option", { name: `Vật tư A ${code}` }).click();

    await page.getByLabel(/Tên đề nghị/).fill(title);
    await page.getByLabel(/Số lượng/).fill("3");
    await page.getByLabel(/Lý do/).fill("Kiểm thử trên trình duyệt");

    // Bấm đúp; mọi yêu cầu đã đi phải mang cùng một Idempotency-Key.
    const sent: Request[] = [];
    page.on("request", (call) => {
      if (call.method() === "POST" && call.url().includes("/v1/workflow/processes/supply-request/instances")) {
        sent.push(call);
      }
    });
    await page.getByRole("button", { name: "Gửi" }).dblclick();
    await expect(page.getByText("Đã gửi đề nghị")).toBeVisible();
    expect(sent.length).toBeGreaterThan(0);
    const keys = sent.map((call) => call.headers()["idempotency-key"]);
    expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    expect(new Set(keys).size, "mọi lần gửi cùng dữ liệu dùng một mã").toBe(1);

    const found = await requestsOf(request, "manager.a", title);
    expect(found, "đúng một hồ sơ sau khi bấm đúp").toHaveLength(1);
    expect(found[0]?.variables).toMatchObject({
      title,
      storeCode: stores.a,
      itemCode: `${code}-va`,
      quantity: 3,
      reason: "Kiểm thử trên trình duyệt",
    });
    expect(typeof found[0]?.variables.quantity, "số lượng gửi dạng số").toBe("number");
    expect(found[0]?.variables).not.toHaveProperty("approved");
    expect(await requestsOf(request, "manager.b", title)).toEqual([]);

    // Người duyệt xã A mở hồ sơ trên bảng việc và thấy các giá trị người lập điền. Phiên trình duyệt riêng: phiên
    // đăng nhập của cán bộ vẫn còn trong trang cũ.
    const { baseURL, locale } = test.info().project.use;
    const reviewer = await (await browser.newContext({ baseURL, locale })).newPage();
    await reviewer.goto("/");
    await signIn(reviewer, "manager.a");
    await reviewer.getByRole("link", { name: title }).click();
    await expect(reviewer.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(reviewer.getByRole("row", { name: new RegExp(`Mã kho\\s*${stores.a}`) })).toBeVisible();
    await expect(reviewer.getByRole("row", { name: /Số lượng\s*3/ })).toBeVisible();
    await expect(reviewer.getByRole("row", { name: /Lý do\s*Kiểm thử trên trình duyệt/ })).toBeVisible();
    await reviewer.context().close();
    passed = true;
  } finally {
    const problems: string[] = [];
    try {
      for (const task of await requestsOf(request, "manager.a", title)) {
        const status = await complete(request, "manager.a", task.id, { approved: false });
        if (status !== 204) problems.push(`trả lại đề nghị ${task.id}: ${status}`);
      }
    } catch (error) {
      problems.push(`tìm đề nghị ${title}: ${error instanceof Error ? error.message : String(error)}`);
    }
    report(passed, [...problems, ...(await removeStores(request, code))]);
  }
});

test("quản trị xã A thêm vật tư bằng biểu mẫu; dòng thuộc xã A dù yêu cầu không mang tenant_id, xã B không thấy", async ({
  page,
  request,
}) => {
  const code = uniqueTitle("e2e-them").replaceAll(" ", "-");
  const storeName = `Kho thử ${code}`;
  let passed = false;
  try {
    await addStore(request, code, storeName);
    await page.goto("/");
    await signIn(page, "admin.a");
    await page.getByRole("link", { name: "Thêm vật tư vào kho", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Thêm vật tư vào kho" })).toBeVisible();

    await page.getByRole("combobox", { name: "Kho" }).click();
    await page.getByRole("option", { name: storeName }).click();
    await page.getByLabel(/Mã vật tư/).fill(`${code}-v`);
    await page.getByLabel(/Tên vật tư/).fill(`Vật tư thêm ${code}`);
    await page.getByLabel(/Đơn vị tính/).fill("bộ");
    await page.getByRole("combobox", { name: "Loại" }).click();
    await page.getByRole("option", { name: "Thiết bị" }).click();
    await page.getByLabel(/Số lượng đang có/).fill("4");

    const insert = page.waitForRequest(
      (call) => call.method() === "POST" && call.url().includes("/v1/graphql") && /insert_/.test(call.postData() ?? ""),
    );
    await page.getByRole("button", { name: "Thêm" }).click();
    const sent = await insert;
    await expect(page.getByText("Đã thêm vật tư vào kho.")).toBeVisible();
    expect(sent.headers()["x-hasura-role"]).toBe(ADMIN);
    expect(sent.postDataJSON().variables.object, "trình duyệt không gửi tenant_id").toEqual({
      store_code: code,
      code: `${code}-v`,
      name: `Vật tư thêm ${code}`,
      unit: "bộ",
      kind: "equipment",
      quantity: 4,
    });

    const query = `query($c: String!) { rows: ${PREFIX}_items(where: {code: {_eq: $c}}) { tenant_id store_code } }`;
    const own = await graphql<{ rows: { tenant_id: string }[] }>(request, "admin.a", query, { c: `${code}-v` }, ADMIN);
    expect(own.rows).toEqual([{ tenant_id: "xa-a", store_code: code }]);
    const other = await graphql<{ rows: unknown[] }>(request, "admin.b", query, { c: `${code}-v` }, ADMIN);
    expect(other.rows, "quản trị xã B không thấy vật tư của xã A").toEqual([]);
    passed = true;
  } finally {
    report(passed, await removeStores(request, code));
  }
});
