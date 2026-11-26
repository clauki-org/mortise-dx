// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Giấy tờ đính kèm trên màn hình chi tiết của danh mục (detail.documents, ADR 0041), qua gói cơ sở vật chất xã. Cán bộ
// phụ trách xã A đính kèm biên bản đo diện tích vào một trụ sở rồi tải về đúng nội dung; tệp thử EICAR bị từ chối
// bằng lời báo tiếng Việt và không thêm dòng nối nào. Người duyệt xã A được phân công làm approver mở cơ sở và tải
// được biên bản; cán bộ xã B không thấy dòng nối và nhận 404 với mã tệp. Không trang nào vi phạm CSP. Cần gói đã cài
// (`make app-install APP=facilities-commune`); bài tự tạo và tự dọn cơ sở thử, tệp vẫn còn ở core.files.

import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { graphql, openMenuItem, signIn, subOf, token, uniqueTitle } from "./support.ts";

const ADMIN = "tenant_admin";
const PREFIX = "app_facilities_commune";
const FILE = "bien-ban-do-dien-tich.pdf";

/** Ghi lại vi phạm CSP của trang: tải xuống bằng Blob và <a download> không được cần nới CSP. */
function cspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

async function openFacility(page: Page, username: string, code: string, name: string) {
  await page.goto("/");
  await signIn(page, username);
  await openMenuItem(page, "Cơ sở nhà, đất");
  await page.getByRole("textbox", { name: "Tìm" }).fill(code);
  await page.getByRole("button", { name: "Tìm" }).click();
  await page.getByRole("link", { name: code }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Giấy tờ đính kèm" })).toBeVisible();
}

/** Bấm tên tệp và đọc tệp trình duyệt lưu về: tên khi lưu và nội dung. */
async function download(page: Page) {
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: FILE }).click();
  const file = await saved;
  const chunks: Buffer[] = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk as Buffer);
  return { name: file.suggestedFilename(), body: Buffer.concat(chunks).toString("utf8") };
}

async function linkedFiles(request: APIRequestContext, username: string, facilityId: string, role = "user") {
  const data = await graphql<{ rows: { file_id: string }[] }>(
    request,
    username,
    `query($f: uuid!) { rows: ${PREFIX}_facility_documents(where: {facility_id: {_eq: $f}}) { file_id } }`,
    { f: facilityId },
    role,
  );
  return data.rows.map((row) => row.file_id);
}

test("cán bộ xã A đính kèm biên bản, người duyệt xã A tải về, xã B không thấy, EICAR bị từ chối", async ({
  browser,
  page,
  request,
}) => {
  const code = uniqueTitle("e2e-gt").replaceAll(" ", "-");
  const name = `Trụ sở UBND xã A ${code}`;
  const content = `%PDF-1.4\n% Bien ban do dien tich ${code}\n%%EOF\n`;
  let facilityId: string | undefined;
  try {
    const created = await graphql<{ row: { id: string } }>(
      request,
      "admin.a",
      `mutation($code: String!, $name: String!) { row: insert_${PREFIX}_facilities_one(object: {code: $code, name: $name}) { id } }`,
      { code, name },
      ADMIN,
    );
    facilityId = created.row.id;
    const assign = `mutation($f: uuid!, $u: String!, $d: String!) { insert_${PREFIX}_facility_assignments_one(object: {facility_id: $f, user_id: $u, duty: $d}) { id } }`;
    await graphql(
      request,
      "admin.a",
      assign,
      { f: facilityId, u: await subOf(request, "user.a"), d: "custodian" },
      ADMIN,
    );
    // Danh mục đọc bằng vai trò user (ADR 0023): người duyệt chỉ thấy cơ sở khi được phân công, kể cả có vai trò manager.
    await graphql(
      request,
      "admin.a",
      assign,
      { f: facilityId, u: await subOf(request, "manager.a"), d: "approver" },
      ADMIN,
    );

    const custodianCsp = cspViolations(page);
    await openFacility(page, "user.a", code, name);
    await expect(page.getByText("Chưa có tệp nào.")).toBeVisible();
    const picker = page.locator('input[type="file"]');
    await picker.setInputFiles({ name: FILE, mimeType: "application/pdf", buffer: Buffer.from(content) });
    await page.getByRole("textbox", { name: "Ghi chú" }).fill("Biên bản đo diện tích thông thủy");
    await page.getByRole("button", { name: "Đính kèm tệp" }).click();
    await expect(page.getByText(`Tệp ${FILE} đã được gắn vào dòng này.`)).toBeVisible();
    await expect(page.getByRole("cell", { name: "Biên bản đo diện tích thông thủy" })).toBeVisible();
    expect(await download(page)).toEqual({ name: FILE, body: content });

    const linked = await linkedFiles(request, "admin.a", facilityId, ADMIN);
    expect(linked, "một dòng nối sau khi đính kèm").toHaveLength(1);
    const fileId = linked[0] as string;

    // Chuỗi EICAR ghép từ hai nửa lúc chạy để chính tệp này không bị phần mềm diệt virus nhận là nhiễm.
    const eicar = `X5O!P%@AP[4\\PZX54(P^)7CC)7}$${"EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"}`;
    await picker.setInputFiles({ name: "nhiem.pdf", mimeType: "application/pdf", buffer: Buffer.from(eicar) });
    await page.getByRole("button", { name: "Đính kèm tệp" }).click();
    const refused = page.getByRole("alert").filter({ hasText: "Chưa đính kèm được tệp" });
    await expect(refused).toContainText("Tệp bị từ chối: Tệp chứa mã độc");
    expect(await linkedFiles(request, "admin.a", facilityId, ADMIN), "EICAR không thêm dòng nối").toEqual([fileId]);
    expect(custodianCsp, "vi phạm CSP ở trang của cán bộ").toEqual([]);

    // Phiên trình duyệt riêng cho người duyệt: phiên của cán bộ vẫn còn trong trang cũ.
    const { baseURL, locale } = test.info().project.use;
    const reviewer = await (await browser.newContext({ baseURL, locale })).newPage();
    const reviewerCsp = cspViolations(reviewer);
    await openFacility(reviewer, "manager.a", code, name);
    expect(await download(reviewer)).toEqual({ name: FILE, body: content });
    expect(reviewerCsp, "vi phạm CSP ở trang của người duyệt").toEqual([]);
    await reviewer.context().close();

    expect(await linkedFiles(request, "user.b", facilityId), "xã B không thấy dòng nối").toEqual([]);
    const headers = { Authorization: `Bearer ${await token(request, "user.b")}` };
    expect((await request.get(`/v1/files/${fileId}`, { headers })).status(), "xã B: thông tin tệp").toBe(404);
    expect((await request.get(`/v1/files/${fileId}/content`, { headers })).status(), "xã B: nội dung tệp").toBe(404);
  } finally {
    // Xóa cơ sở thử kéo theo phân công và dòng nối (ON DELETE CASCADE); tệp ở core.files không có lệnh xóa.
    if (facilityId) {
      await graphql(
        request,
        "admin.a",
        `mutation($id: uuid!) { delete_${PREFIX}_facilities_by_pk(id: $id) { id } }`,
        { id: facilityId },
        ADMIN,
      ).catch((error) => console.warn(`Dọn cơ sở thử chưa xong: ${error}`));
    }
  }
});
