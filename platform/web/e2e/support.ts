// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần dùng chung của các bài kiểm thử trên trình duyệt: đăng nhập qua trang Keycloak như người dùng, và tạo dữ liệu
// đầu vào qua API bằng client kiểm thử mortise-test (password grant, chỉ dùng cho kiểm thử, ADR 0006).

import { type APIRequestContext, expect, type Page } from "@playwright/test";

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
}

export async function token(request: APIRequestContext, username: string): Promise<string> {
  const response = await request.post("/auth/realms/mortise/protocol/openid-connect/token", {
    form: { grant_type: "password", client_id: "mortise-test", username, password: password() },
  });
  expect(response.ok(), `lấy token cho ${username}`).toBeTruthy();
  return (await response.json()).access_token;
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

export async function outcome(request: APIRequestContext, username: string, instance: string) {
  return workflow(request, username, "GET", `/instances/${instance}`);
}

/** Tên hồ sơ không trùng giữa các lần chạy, để bài kiểm tìm đúng dòng của mình trên bảng việc. */
export const uniqueTitle = (label: string) => `${label} ${Date.now().toString(36)}`;
