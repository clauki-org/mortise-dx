// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Menu của gói và trang danh mục trên trình duyệt: cán bộ xã A mở mục menu do gói cơ sở vật chất xã khai, thấy cơ
// sở mình được phân công, không thấy cơ sở chưa phân công của chính xã A hay cơ sở của xã B, mở chi tiết và danh
// sách tòa, mở lại thẳng đường dẫn chi tiết. Trang dựng hoàn toàn từ cấu hình của gói; giao diện không có mã riêng
// cho gói. Cần gói đã cài (`make app-install APP=facilities-commune`); bài tự tạo và tự dọn dữ liệu nên không cần
// `make seed-demo`.

import { type APIRequestContext, expect, test } from "@playwright/test";
import { graphql, signIn, subOf, uniqueTitle } from "./support.ts";

const ADMIN = "tenant_admin";
const PREFIX = "app_facilities_commune";

type Created = { id: string };
type Facility = { admin: string; id: string };

/** Quản trị xã tạo một cơ sở; trả id. */
async function facility(request: APIRequestContext, admin: string, code: string, name: string) {
  const data = await graphql<{ row: Created }>(
    request,
    admin,
    `mutation($code: String!, $name: String!) { row: insert_${PREFIX}_facilities_one(object: {code: $code, name: $name}) { id } }`,
    { code, name },
    ADMIN,
  );
  return data.row.id;
}

/**
 * Xóa các cơ sở bài đã tạo: tòa trước, cơ sở sau (RESTRICT); phân công đi theo cơ sở (CASCADE). Mỗi bước tự bắt lỗi
 * để một bước hỏng không chặn các bước sau; trả danh sách lỗi để nơi gọi quyết định có báo hay không.
 */
async function cleanUp(request: APIRequestContext, created: Facility[]): Promise<string[]> {
  const problems: string[] = [];
  const attempt = async (label: string, admin: string, query: string, id: string) => {
    try {
      await graphql(request, admin, query, { id }, ADMIN);
    } catch (error) {
      problems.push(`${label} ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  for (const { admin, id } of created) {
    await attempt(
      "xóa tòa của cơ sở",
      admin,
      `mutation($id: uuid!) { delete_${PREFIX}_buildings(where: {facility_id: {_eq: $id}}) { affected_rows } }`,
      id,
    );
    await attempt("xóa cơ sở", admin, `mutation($id: uuid!) { delete_${PREFIX}_facilities_by_pk(id: $id) { id } }`, id);
  }
  return problems;
}

test("cán bộ xã A mở danh mục cơ sở từ menu của gói, chỉ thấy cơ sở được phân công của xã mình", async ({
  page,
  request,
}) => {
  const code = uniqueTitle("e2e").replaceAll(" ", "-");
  const ownName = `Trụ sở kiểm thử ${code}`;
  const created: Facility[] = [];
  let passed = false;
  try {
    const ownId = await facility(request, "admin.a", `${code}-a`, ownName);
    created.push({ admin: "admin.a", id: ownId });
    // Cùng xã A nhưng không phân công cho user.a: phải bị quyền theo phân công chặn, không chỉ quyền theo tenant.
    created.push({
      admin: "admin.a",
      id: await facility(request, "admin.a", `${code}-c`, `Trụ sở chưa phân công ${code}`),
    });
    created.push({ admin: "admin.b", id: await facility(request, "admin.b", `${code}-b`, `Trụ sở xã khác ${code}`) });

    await graphql(
      request,
      "admin.a",
      `mutation($f: uuid!) { insert_${PREFIX}_buildings_one(object: {facility_id: $f, code: "T1", name: "Tòa kiểm thử"}) { id } }`,
      { f: ownId },
      ADMIN,
    );
    // Phân công so với sub trong token của cán bộ (ADR 0015).
    const sub = await subOf(request, "user.a");
    await graphql(
      request,
      "admin.a",
      `mutation($f: uuid!, $u: String!) { insert_${PREFIX}_facility_assignments_one(object: {facility_id: $f, user_id: $u, duty: "custodian"}) { id } }`,
      { f: ownId, u: sub },
      ADMIN,
    );

    await page.goto("/");
    await signIn(page, "user.a");
    await page.getByRole("link", { name: "Cơ sở nhà, đất" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Cơ sở nhà, đất" })).toBeVisible();

    await page.getByRole("textbox", { name: "Tìm" }).fill(code);
    await page.getByRole("button", { name: "Tìm" }).click();
    // Khẳng định phủ định chỉ có nghĩa sau khi kết quả tìm đã hiện.
    await expect(page.getByRole("link", { name: `${code}-a` })).toBeVisible();
    await expect(page.getByText(`${code}-c`)).toHaveCount(0);
    await expect(page.getByText(`${code}-b`)).toHaveCount(0);

    await page.getByRole("link", { name: `${code}-a` }).click();
    await expect(page.getByRole("heading", { level: 1, name: ownName })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Tòa nhà" })).toBeVisible();
    await expect(page.getByRole("link", { name: "T1" })).toBeVisible();

    // Mở lại thẳng đường dẫn chi tiết (dấu trang, tin nhắn): trang phải chờ menu tải xong rồi mới vẽ, không báo
    // "không có trang".
    const detail = page.url();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: ownName })).toBeVisible();
    expect(page.url()).toBe(detail);
    passed = true;
  } finally {
    const problems = await cleanUp(request, created);
    // Bài đã hỏng thì lỗi gốc là lỗi cần đọc: ném lỗi dọn ở đây sẽ thay mất nó, nên chỉ in ra.
    if (passed) {
      expect(problems, "dọn dữ liệu kiểm thử").toEqual([]);
    } else if (problems.length > 0) {
      console.warn(`Dọn dữ liệu kiểm thử chưa xong:\n${problems.join("\n")}`);
    }
  }
});

/** Đọc CSV theo RFC 4180 (nháy kép bọc ô, "" là một dấu nháy, CRLF giữa các dòng) thành các dòng ô. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && text[index + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      index += 1;
    } else cell += char;
  }
  return rows;
}

test("cán bộ xã A xuất danh mục cơ sở ra CSV: mọi dòng đang lọc, khớp màn hình và API, chặn công thức", async ({
  page,
  request,
}) => {
  const code = uniqueTitle("xuat").replaceAll(" ", "-");
  // Hơn một trang (cỡ trang mặc định 20): tệp phải có mọi dòng khớp tìm, không chỉ trang đang xem. Một tên bắt đầu
  // bằng "=" và có dấu phẩy: tệp phải bọc nháy kép và thêm ' để bảng tính không chạy như công thức.
  const count = 22;
  const created: Facility[] = [];
  let passed = false;
  try {
    const sub = await subOf(request, "user.a");
    for (let index = 1; index <= count; index += 1) {
      const suffix = String(index).padStart(2, "0");
      const name = index === 2 ? `=Trụ sở kiểm thử, ${code}` : `Trụ sở kiểm thử ${suffix}`;
      const id = await facility(request, "admin.a", `${code}-a${suffix}`, name);
      created.push({ admin: "admin.a", id });
      await graphql(
        request,
        "admin.a",
        `mutation($f: uuid!, $u: String!) { insert_${PREFIX}_facility_assignments_one(object: {facility_id: $f, user_id: $u, duty: "custodian"}) { id } }`,
        { f: id, u: sub },
        ADMIN,
      );
    }
    created.push({
      admin: "admin.a",
      id: await facility(request, "admin.a", `${code}-c`, `Trụ sở chưa phân công ${code}`),
    });
    created.push({ admin: "admin.b", id: await facility(request, "admin.b", `${code}-b`, `Trụ sở xã khác ${code}`) });

    await page.goto("/");
    await signIn(page, "user.a");
    await page.getByRole("link", { name: "Cơ sở nhà, đất" }).click();
    await page.getByRole("textbox", { name: "Tìm" }).fill(code);
    await page.getByRole("button", { name: "Tìm" }).click();
    await expect(page.getByRole("link", { name: `${code}-a01` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Trang sau" })).toBeEnabled();
    const screen = await page
      .locator("table tbody tr")
      .evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent ?? "")));

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Xuất CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^co-so-nha-dat-\d{4}-\d{2}-\d{2}\.csv$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    expect(raw.startsWith("\uFEFF"), "tệp bắt đầu bằng BOM UTF-8").toBe(true);
    const lines = parseCsv(raw.slice(1));
    const blank = lines.findIndex((line) => line.length === 1 && line[0] === "");
    const meta = new Map(lines.slice(0, blank).map(([key = "", value = ""]) => [key, value]));
    const [columns, ...data] = lines.slice(blank + 1);

    expect(meta.get("Người xuất")).toBe("user.a");
    expect(meta.get("Đơn vị")).toBe("xa-a");
    expect(meta.get("Nguồn")).toBe(`${PREFIX}_facilities`);
    expect(meta.get("Điều kiện")).toContain(`Tìm "${code}"`);
    expect(meta.get("Số dòng")).toBe(String(count));
    expect(columns).toEqual(["Mã", "Tên cơ sở", "Địa chỉ", "Tình trạng"]);

    // Cùng thứ tự và cùng các dòng API trả cho user.a; cơ sở chưa phân công và cơ sở xã B không có.
    const { rows } = await graphql<{ rows: { code: string }[] }>(
      request,
      "user.a",
      `query($code: String!) { rows: ${PREFIX}_facilities(where: {code: {_like: $code}}, order_by: [{code: asc}, {id: asc}]) { code } }`,
      { code: `${code}%` },
    );
    expect(data.map((line) => line[0])).toEqual(rows.map((row) => row.code));
    expect(data).toHaveLength(count);

    // Trang đầu trên màn hình khớp từng ô với 20 dòng đầu của tệp; riêng tên bắt đầu bằng "=" có thêm dấu '.
    expect(screen).toHaveLength(20);
    const shown = screen.map((cells) => cells.map((cell) => (/^[=+\-@]/.test(cell) ? `'${cell}` : cell)));
    expect(data.slice(0, 20)).toEqual(shown);
    expect(data.some((line) => line[1]?.startsWith("'=Trụ sở kiểm thử, "))).toBe(true);
    passed = true;
  } finally {
    const problems = await cleanUp(request, created);
    if (passed) {
      expect(problems, "dọn dữ liệu kiểm thử").toEqual([]);
    } else if (problems.length > 0) {
      console.warn(`Dọn dữ liệu kiểm thử chưa xong:\n${problems.join("\n")}`);
    }
  }
});
