// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Tin công khai và đăng ký nhận trên trình duyệt (ADR 0069). Xã A lập hồ sơ vượt ngưỡng, duyệt để công khai và đăng
// tin qua API; trong thời hạn công khai, cán bộ xã B mở tin trên mục "Tin công khai", tải mẫu tin về và đăng ký nhận
// 200 m² làm nhà văn hóa trên web; xã A đăng ký cho một đơn vị thuộc xã qua API. Xã B không thấy đăng ký của đơn vị
// khác, tỉnh khác không thấy tin. Hết hạn, đăng ký thêm bị từ chối; người duyệt xã A mở bước trình, thấy danh sách
// xếp đơn vị thuộc xã A trước xã B, chọn đăng ký đứng đầu và trình; bước quyết định ghi nhận, hồ sơ được niêm phong.
// Cần gói cài với thời hạn công khai ngắn: make app-install APP=facilities-commune SETTINGS=publication_period=PT20S,
// và `make seed-demo` (xã A có cơ sở). Tin và đăng ký của bài không xóa được qua API (đơn đã gửi là hồ sơ), nên còn lại
// trên mục "Tin công khai" ở trạng thái đã hết hạn.

import { type APIRequestContext, expect, test } from "@playwright/test";
import { complete, graphql, openMenuItem, outcome, signIn, taskOf, token, uniqueTitle } from "./support.ts";

const PREFIX = "app_facilities_commune";
const PROCESS = "facilities-review";

type Task = { id: string; processInstanceId: string; step: string };

/** Việc ở một bước của hồ sơ mà tài khoản thấy, hoặc undefined. */
async function stepTask(request: APIRequestContext, username: string, instance: string, step: string) {
  const response = await request.get("/v1/workflow/tasks", {
    headers: { Authorization: `Bearer ${await token(request, username)}` },
  });
  expect(response.ok()).toBeTruthy();
  const tasks: Task[] = await response.json();
  return tasks.find((task) => task.processInstanceId === instance && task.step === step);
}

/** Lệnh thêm đăng ký nhận bằng GraphQL; trả lời báo lỗi đầu tiên hay "ok". */
async function register(request: APIRequestContext, username: string, object: object): Promise<string> {
  const response = await request.post("/v1/graphql", {
    headers: { Authorization: `Bearer ${await token(request, username)}`, "X-Hasura-Role": "user" },
    data: {
      query: `mutation($o: ${PREFIX}_receive_requests_insert_input!) { insert_${PREFIX}_receive_requests(objects: [$o]) { affected_rows } }`,
      variables: { o: object },
    },
  });
  const body: { errors?: { message: string }[] } = await response.json();
  return body.errors?.[0]?.message ?? "ok";
}

test("xã B đăng ký nhận trong thời hạn công khai; người trình chọn từ danh sách đã xếp theo thứ tự ưu tiên", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const { baseURL, locale } = test.info().project.use;

  // Cán bộ xã B đăng nhập trước khi hồ sơ vào bước công khai, để thời hạn ngắn chỉ phải đủ cho việc điền đăng ký.
  await page.goto("/");
  await signIn(page, "user.b");
  await expect(page.getByRole("heading", { level: 1, name: "Trang chủ" })).toBeVisible();

  const facilities = await graphql<{ rows: { id: string; name: string }[] }>(
    request,
    "manager.a",
    `query { rows: ${PREFIX}_facilities(limit: 1, order_by: {code: asc}) { id name } }`,
    {},
    "manager",
  );
  const facility = facilities.rows[0];
  expect(facility, "xã A cần ít nhất một cơ sở: make seed-demo").toBeDefined();
  if (!facility) return;
  const started = await request.post(`/v1/workflow/processes/${PROCESS}/instances`, {
    headers: { Authorization: `Bearer ${await token(request, "user.a")}` },
    data: { variables: { title: uniqueTitle("Tin công khai e2e"), facilityId: facility.id, excessM2: 420 } },
  });
  expect(started.ok()).toBeTruthy();
  const instance: string = (await started.json()).id;
  expect(await complete(request, "manager.a", await taskOf(request, "manager.a", instance), { approved: true })).toBe(
    204,
  );
  await graphql(
    request,
    "manager.a",
    `mutation($c: String!, $f: uuid!) { insert_${PREFIX}_notices(objects: {case_id: $c, facility_id: $f,
      usage: "Làm việc", offered_m2: 420, layout: "Sơ đồ tầng 2 ở giấy tờ của cơ sở"}) { affected_rows } }`,
    { c: instance, f: facility.id },
    "manager",
  );

  // Xã B mở tin từ menu, tải mẫu tin, đăng ký nhận trên web.
  await openMenuItem(page, "Tin công khai");
  await page.goto(`/apps/facilities-commune/notices/${encodeURIComponent(instance)}`);
  await expect(page.getByRole("heading", { level: 1, name: facility.name })).toBeVisible();
  const notice = page.getByRole("region", { name: "Mẫu tin công khai" });
  await expect(notice).toContainText("3. Phần diện tích dự kiến bố trí cho đơn vị có nhu cầu tiếp nhận: 420,00 m²");
  const saved = page.waitForEvent("download");
  await notice.getByRole("button", { name: "Tải về tệp văn bản" }).click();
  const file = await saved;
  expect(file.suggestedFilename()).toMatch(/^tin-cong-khai-.+\.txt$/);
  const chunks: Buffer[] = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).toString("utf8")).toContain("2. Công năng sử dụng: Làm việc");

  await page.getByRole("button", { name: "Đăng ký nhận" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Mục đích sử dụng/).fill("Nhà văn hóa");
  await dialog.getByLabel(/^Diện tích đề nghị tiếp nhận/).fill("200");
  await dialog
    .getByLabel(/^Thuyết minh sự phù hợp/)
    .fill("Xã B chưa có nhà văn hóa; 200 m² nằm trong phần dự kiến bố trí.");
  await dialog.getByRole("button", { name: "Gửi đăng ký" }).click();
  await expect(page.getByText("Đã gửi đăng ký.")).toBeVisible();

  expect(
    await register(request, "user.a", {
      case_id: instance,
      unit_name: "Trường mầm non xã A",
      purpose: "Lớp học",
      requested_m2: 100,
      explanation: "Thiếu phòng học",
    }),
  ).toBe("ok");

  // Xã B chỉ thấy đăng ký của mình, không thấy thứ tự; tỉnh khác không thấy tin.
  const own = await graphql<{ rows: { tenant_id: string; rank: number | null }[] }>(
    request,
    "user.b",
    `query($c: String!) { rows: ${PREFIX}_request_board(where: {case_id: {_eq: $c}}) { tenant_id rank } }`,
    { c: instance },
  );
  expect(own.rows).toEqual([{ tenant_id: "xa-b", rank: null }]);
  const other = await graphql<{ rows: unknown[] }>(
    request,
    "user.k",
    `query($c: String!) { rows: ${PREFIX}_notice_board(where: {case_id: {_eq: $c}}) { case_id } }`,
    { c: instance },
  );
  expect(other.rows).toEqual([]);

  // Hết hạn công khai: Flowable chuyển hồ sơ sang bước trình; đăng ký thêm bị CSDL từ chối.
  await expect
    .poll(async () => (await stepTask(request, "manager.a", instance, "submit"))?.id, { timeout: 120_000 })
    .toBeTruthy();
  expect(
    await register(request, "user.b", { case_id: instance, purpose: "Kho", requested_m2: 20, explanation: "Muộn" }),
  ).toContain("Đã hết thời hạn công khai");

  const submit = await stepTask(request, "manager.a", instance, "submit");
  const reviewer = await (await browser.newContext({ baseURL, locale })).newPage();
  await reviewer.goto(`/tasks/${submit?.id}`);
  await signIn(reviewer, "manager.a");
  await reviewer.getByLabel(/^Đơn vị đề nghị nhận/).click();
  const options = reviewer.getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText("1. Trường mầm non xã A");
  await expect(options.nth(1)).toContainText(
    "2. Xã B (Tỉnh Mẫu): Nhà văn hóa; đề nghị 200,00 m², dự kiến bố trí 420,00 m²",
  );
  await options.nth(0).click();
  await reviewer.getByRole("button", { name: "Trình" }).click();
  await expect(reviewer).toHaveURL(/\/tasks$/);
  await reviewer.context().close();

  const decide = await stepTask(request, "manager.a", instance, "decide");
  expect(
    await complete(request, "manager.a", decide?.id ?? "", {
      decision: "Điều chuyển cho trường mầm non",
      decided: true,
    }),
  ).toBe(204);
  const done = await outcome(request, "manager.a", instance);
  expect(done).toMatchObject({ ended: true, outcome: "decided" });
  expect(done.seal?.hash).toMatch(/^[0-9a-f]{64}$/);
});
