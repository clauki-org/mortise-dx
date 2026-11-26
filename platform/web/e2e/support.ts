// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần dùng chung của các bài kiểm thử trên trình duyệt: đăng nhập qua trang Keycloak như người dùng, và tạo dữ liệu
// đầu vào qua API bằng client kiểm thử mortise-test (password grant, chỉ dùng cho kiểm thử, ADR 0006).

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, expect, type Page } from "@playwright/test";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

// Tài khoản người duyệt demo (vai trò manager) phải nhập mã OTP khi đăng nhập (ADR 0011).
const isApprover = (username: string) => username.startsWith("manager.");

/** Mã OTP chưa dùng: Keycloak từ chối mã đã dùng, nên scripts/otp.py nhớ mã đã cấp và chờ khung mới khi cần. */
export function otp(username: string): string {
  return execFileSync("uv", ["run", "--quiet", "--no-project", "python", "scripts/otp.py", "next", username], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function password(): string {
  const value = process.env.DEMO_USER_PASSWORD;
  if (!value) throw new Error("Thiếu DEMO_USER_PASSWORD: chạy qua `make e2e`, lệnh này nạp .env");
  return value;
}

export async function signIn(page: Page, username: string) {
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password());
  await page.locator("#kc-login").click();
  if (isApprover(username)) {
    // Không thấy ô nhập mã thì báo rõ, thay vì chờ hết giờ: thường là chưa chạy `make seed` sau khi đổi realm.
    await expect(page.locator("#otp"), `${username} phải được hỏi mã OTP (ADR 0011)`).toBeVisible();
    await page.locator("#otp").fill(otp(username));
    await page.locator("#kc-login").click();
  }
}

// Mỗi lần lấy token của người duyệt tốn một mã OTP, mà mỗi khung 30 giây chỉ có ba mã Keycloak còn nhận; giữ token
// của từng tài khoản tới gần lúc hết hạn để bài kiểm không phải chờ mã mới.
const tokens = new Map<string, { value: string; expiresAt: number }>();

export async function token(request: APIRequestContext, username: string): Promise<string> {
  const cached = tokens.get(username);
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.value;
  const form: Record<string, string> = {
    grant_type: "password",
    client_id: "mortise-test",
    username,
    password: password(),
  };
  if (isApprover(username)) form.totp = otp(username);
  const response = await request.post("/auth/realms/mortise/protocol/openid-connect/token", { form });
  expect(response.ok(), `lấy token cho ${username}`).toBeTruthy();
  const body: { access_token: string; expires_in: number } = await response.json();
  tokens.set(username, { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 });
  return body.access_token;
}

/** sub trong token của một tài khoản: Hasura đặt vào X-Hasura-User-Id, phân công cán bộ so với giá trị này. */
export async function subOf(request: APIRequestContext, username: string): Promise<string> {
  const payload = (await token(request, username)).split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).sub;
}

async function workflow(
  request: APIRequestContext,
  username: string,
  method: "GET" | "POST",
  path: string,
  data?: object,
) {
  const response = await request.fetch(`/v1/workflow${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token(request, username)}` },
    data,
  });
  expect(response.ok(), `${method} /v1/workflow${path} với ${username}`).toBeTruthy();
  return response.json();
}

/** Mở một hồ sơ trên quy trình mẫu core-approval; trả mã quy trình. */
export async function submitApproval(request: APIRequestContext, username: string, title: string): Promise<string> {
  const started = await workflow(request, username, "POST", "/processes/core-approval/instances", {
    variables: { title },
  });
  return started.id;
}

/** Mã task đang chờ của một quy trình, theo cách người duyệt thấy. */
export async function taskOf(request: APIRequestContext, username: string, instance: string): Promise<string> {
  const tasks: { id: string; processInstanceId: string }[] = await workflow(request, username, "GET", "/tasks");
  const task = tasks.find((candidate) => candidate.processInstanceId === instance);
  if (!task) throw new Error(`${username} không thấy task của quy trình ${instance}`);
  return task.id;
}

/** Hoàn thành task qua API; trả mã HTTP để bài kiểm khẳng định cả trường hợp bị từ chối. */
export async function complete(request: APIRequestContext, username: string, task: string, variables: object) {
  const response = await request.post(`/v1/workflow/tasks/${task}/complete`, {
    headers: { Authorization: `Bearer ${await token(request, username)}` },
    data: { variables },
  });
  return response.status();
}

/** Các đơn vị người dùng đọc được qua GraphQL; quyền Hasura đúng thì chỉ có đơn vị của họ. */
export async function visibleTenants(request: APIRequestContext, username: string): Promise<string[]> {
  const response = await request.post("/v1/graphql", {
    headers: { Authorization: `Bearer ${await token(request, username)}` },
    data: { query: "{ core_tenants { id } }" },
  });
  expect(response.ok(), `GraphQL với ${username}`).toBeTruthy();
  const body: { data: { core_tenants: { id: string }[] } } = await response.json();
  return body.data.core_tenants.map((tenant) => tenant.id);
}

/**
 * Gọi GraphQL bằng token của một tài khoản, với vai trò chọn bằng header X-Hasura-Role (mặc định user); trả phần
 * data. Lỗi GraphQL làm bài kiểm dừng ngay với nguyên văn lỗi, không để lỗi lộ ra muộn ở bước sau.
 */
export async function graphql<T>(
  request: APIRequestContext,
  username: string,
  query: string,
  variables: object = {},
  role = "user",
): Promise<T> {
  const response = await request.post("/v1/graphql", {
    headers: { Authorization: `Bearer ${await token(request, username)}`, "X-Hasura-Role": role },
    data: { query, variables },
  });
  expect(response.ok(), `GraphQL với ${username}`).toBeTruthy();
  const body: { data?: T; errors?: { message: string }[] } = await response.json();
  expect(body.errors, `GraphQL với ${username} (${role})`).toBeUndefined();
  return body.data as T;
}

export async function outcome(request: APIRequestContext, username: string, instance: string) {
  return workflow(request, username, "GET", `/instances/${instance}`);
}

/** Tên hồ sơ không trùng giữa các lần chạy, để bài kiểm tìm đúng dòng của mình trên bảng việc. */
export const uniqueTitle = (label: string) => `${label} ${Date.now().toString(36)}`;
