// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Bảng điều hành của gói cơ sở vật chất xã trên trình duyệt (ADR 0033): sau khi quản trị xã A thêm một phòng có diện
// tích lẻ, cán bộ xã A thấy thẻ số đúng bằng số Hasura trả cho chính tài khoản đó, viết kiểu Việt Nam, mục "Nguồn" ghi
// đúng câu truy vấn trang đã gửi, và trang không truy vấn khối của tỉnh; cán bộ xã B thấy số của xã B, không thấy số
// của xã A; tỉnh thấy dòng của xã A trong bảng số liệu bằng đúng số xã A thấy, truy vấn với vai trò rollup_reader;
// lãnh đạo xã A thấy khối phân công mà cán bộ không thấy.
// Không có vi phạm Content-Security-Policy. Cần gói đã cài (`make app-install APP=facilities-commune`); bài tự tạo và
// tự dọn dữ liệu nên không cần `make seed-demo`.

import { type APIRequestContext, type Browser, expect, type Page, type TestInfo, test } from "@playwright/test";
import { graphql, signIn, uniqueTitle } from "./support.ts";

const ADMIN = "tenant_admin";
const PREFIX = "app_facilities_commune";
const MENU = "Bảng điều hành";
const TITLE = "Bảng điều hành cơ sở vật chất xã";
const AREA = "Diện tích nhà làm việc của xã";
const COMMUNES = "Diện tích của các xã";
const COVERAGE = "Phân công cơ sở";

type Summary = { allowed_m2: unknown; in_use_m2: unknown; surplus_m2: unknown; excess_m2: unknown };
const CARDS: [keyof Summary, string][] = [
  ["allowed_m2", "Diện tích được phép"],
  ["in_use_m2", "Đang dùng"],
  ["excess_m2", "Phần vượt tiêu chuẩn, định mức"],
  ["surplus_m2", "Cơ sở dôi dư"],
];

const vi = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 });
const number = (value: unknown) => vi.format(Number(value));

/** Dòng area_summary mà Hasura trả cho một tài khoản với vai trò user: đúng một dòng, của xã trong token. */
async function summary(request: APIRequestContext, username: string): Promise<Summary> {
  const data = await graphql<{ rows: Summary[] }>(
    request,
    username,
    `{ rows: ${PREFIX}_area_summary { allowed_m2 in_use_m2 surplus_m2 excess_m2 } }`,
  );
  expect(data.rows, `area_summary của ${username}`).toHaveLength(1);
  return data.rows[0] as Summary;
}

/** Ghi lại vi phạm CSP, và vai trò cùng câu truy vấn của từng yêu cầu GraphQL mà trang gửi. */
function watch(page: Page) {
  const violations: string[] = [];
  const sent: { role: string; query: string }[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  page.on("request", (request) => {
    if (!request.url().endsWith("/v1/graphql")) return;
    sent.push({ role: request.headers()["x-hasura-role"] ?? "", query: request.postDataJSON()?.query ?? "" });
  });
  return { violations, sent };
}

/** Trang mới trong ngữ cảnh riêng: cùng ngữ cảnh thì cookie đăng nhập của Keycloak đưa thẳng vào phiên trước. */
async function open(browser: Browser, testInfo: TestInfo, username: string) {
  const { baseURL, locale } = testInfo.project.use;
  const context = await browser.newContext({ baseURL, locale });
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto("/");
  await signIn(page, username);
  await page.getByRole("link", { name: MENU, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  return { context, page, seen };
}

// Nhãn, số, đơn vị rồi "Cách tính" liền nhau trong chữ của thẻ: so cả cụm để "0 m²" không khớp nhầm "1.000 m²".
async function expectCards(page: Page, numbers: Summary) {
  const area = page.getByRole("region", { name: AREA });
  for (const [column, label] of CARDS) {
    await expect(area.getByRole("group", { name: label, exact: true })).toContainText(
      `${label}${number(numbers[column])} m²Cách tính`,
    );
  }
}

test("số trên bảng điều hành bằng số Hasura trả cho người xem; xã B không thấy số của xã A; tỉnh thấy tổng hợp", async ({
  browser,
  request,
}, testInfo) => {
  // Bốn lần đăng nhập, hai mã OTP của manager.a: scripts/otp.py có thể phải chờ khung 30 giây mới hai lần.
  test.slow();
  const code = uniqueTitle("e2e").replaceAll(" ", "-");
  const pages: { close: () => Promise<void> }[] = [];
  let facilityId: string | undefined;
  let buildingId: string | undefined;
  let passed = false;
  try {
    const created = await graphql<{ row: { id: string } }>(
      request,
      "admin.a",
      `mutation($code: String!) { row: insert_${PREFIX}_facilities_one(object: {code: $code, name: $code}) { id } }`,
      { code },
      ADMIN,
    );
    facilityId = created.row.id;
    const building = await graphql<{ row: { id: string } }>(
      request,
      "admin.a",
      `mutation($f: uuid!) { row: insert_${PREFIX}_buildings_one(object: {facility_id: $f, code: "T1", name: "Tòa"}) { id } }`,
      { f: facilityId },
      ADMIN,
    );
    buildingId = building.row.id;
    // Diện tích lẻ để số của xã A có phần thập phân: thấy được dấu phẩy thập phân, và khác số của xã B.
    await graphql(
      request,
      "admin.a",
      `mutation($b: uuid!) { insert_${PREFIX}_rooms_one(object: {building_id: $b, code: "P1", name: "Phòng",
        area_type: "working", clear_area_m2: 12.34}) { id } }`,
      { b: buildingId },
      ADMIN,
    );

    const numbersA = await summary(request, "user.a");
    const commune = await open(browser, testInfo, "user.a");
    pages.push(commune.context);
    await expectCards(commune.page, numbersA);
    await expect(commune.page.getByRole("region", { name: COMMUNES })).toHaveCount(0);
    await expect(commune.page.getByRole("region", { name: COVERAGE })).toHaveCount(0);
    // Mục "Nguồn" ghi nguyên văn câu mà trang đã gửi, với vai trò user.
    const area = commune.page.getByRole("region", { name: AREA });
    await area.getByText("Nguồn", { exact: true }).click();
    const shown = (await area.locator("pre").first().textContent()) ?? "";
    expect(shown).toContain(`${PREFIX}_area_summary`);
    expect(commune.seen.sent).toContainEqual({ role: "user", query: shown });
    expect(
      commune.seen.sent.map((sent) => sent.role),
      "user.a không gửi vai trò rollup_reader",
    ).not.toContain("rollup_reader");
    expect(commune.seen.violations, "vi phạm CSP").toEqual([]);

    const numbersB = await summary(request, "user.b");
    expect(number(numbersB.in_use_m2), "phòng lẻ chỉ thêm vào xã A").not.toBe(number(numbersA.in_use_m2));
    const other = await open(browser, testInfo, "user.b");
    pages.push(other.context);
    await expectCards(other.page, numbersB);
    await expect(other.page.getByText(`${number(numbersA.in_use_m2)} m²`)).toHaveCount(0);
    expect(other.seen.violations, "vi phạm CSP").toEqual([]);

    const rollup = await graphql<{ rows: { tenant_name: string }[] }>(
      request,
      "leader.tinh",
      `{ rows: ${PREFIX}_area_rollup(where: {tenant_id: {_eq: "xa-a"}}) { tenant_name } }`,
      {},
      "rollup_reader",
    );
    const nameA = rollup.rows[0]?.tenant_name ?? "";
    const province = await open(browser, testInfo, "leader.tinh");
    pages.push(province.context);
    const row = province.page.getByRole("region", { name: COMMUNES }).getByRole("row", { name: nameA });
    await expect(row.getByRole("cell")).toHaveText([
      number(numbersA.allowed_m2),
      number(numbersA.in_use_m2),
      number(numbersA.excess_m2),
    ]);
    expect(province.seen.sent.map((sent) => sent.role)).toContain("rollup_reader");
    expect(province.seen.violations, "vi phạm CSP").toEqual([]);

    // Lãnh đạo xã (manager, đăng nhập kèm OTP) thấy khối phân công với đúng số Hasura trả cho vai trò manager.
    const coverage = await graphql<{ rows: Record<string, number>[] }>(
      request,
      "manager.a",
      `{ rows: ${PREFIX}_facility_coverage { facility_count without_custodian without_approver } }`,
      {},
      "manager",
    );
    const head = await open(browser, testInfo, "manager.a");
    pages.push(head.context);
    const region = head.page.getByRole("region", { name: COVERAGE });
    for (const [column, label] of [
      ["facility_count", "Số cơ sở"],
      ["without_custodian", "Chưa có người phụ trách"],
      ["without_approver", "Chưa có người duyệt"],
    ] as const) {
      await expect(region.getByRole("group", { name: label, exact: true })).toContainText(
        `${label}${number(coverage.rows[0]?.[column])}Cách tính`,
      );
    }
    expect(head.seen.sent.map((sent) => sent.role)).toContain("manager");
    expect(head.seen.violations, "vi phạm CSP").toEqual([]);
    passed = true;
  } finally {
    for (const page of pages) await page.close();
    const problems: string[] = [];
    const steps: [string, string, string | undefined][] = [
      ["rooms", `delete_${PREFIX}_rooms(where: {building_id: {_eq: $id}}) { affected_rows }`, buildingId],
      ["buildings", `delete_${PREFIX}_buildings_by_pk(id: $id) { id }`, buildingId],
      ["facilities", `delete_${PREFIX}_facilities_by_pk(id: $id) { id }`, facilityId],
    ];
    for (const [table, mutation, id] of steps) {
      if (!id) continue;
      try {
        await graphql(request, "admin.a", `mutation($id: uuid!) { ${mutation} }`, { id }, ADMIN);
      } catch (error) {
        problems.push(`xóa ${table} ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Bài đã hỏng thì lỗi gốc là lỗi cần đọc: ném lỗi dọn ở đây sẽ thay mất nó, nên chỉ in ra.
    if (passed) expect(problems, "dọn dữ liệu kiểm thử").toEqual([]);
    else if (problems.length > 0) console.warn(`Dọn dữ liệu kiểm thử chưa xong:\n${problems.join("\n")}`);
  }
});
