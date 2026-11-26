// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử trên trình duyệt (Playwright) chạy qua cổng của một bản cài đang chạy, đúng đường người dùng đi: giao diện
// do nginx phục vụ kèm CSP thật, đăng nhập qua Keycloak, dữ liệu qua /v1. Gọi bằng `make e2e` sau `make up seed`.

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // Các bài dùng chung tài khoản demo và quy trình của cùng tenant; chạy lần lượt để không giành việc của nhau.
  workers: 1,
  // Không tự chạy lại bài hỏng: bài chập chờn phải lộ ra để sửa, không bị che bằng lần chạy thứ hai.
  retries: 0,
  // Người duyệt đăng nhập kèm mã OTP; khi các mã còn hiệu lực đã dùng hết (smoke chạy ngay trước), scripts/otp.py
  // chờ sang khung 30 giây mới. Giới hạn mặc định 30 giây một bài sẽ hết trong lúc chờ (ADR 0011).
  timeout: 90_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.MORTISE_PUBLIC_URL || "http://localhost:9080",
    locale: "vi-VN",
    // Bài hỏng để lại ảnh chụp và dấu vết từng bước, CI tải lên làm artifact để xem hỏng ở đâu.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Cỡ điện thoại chỉ cho bài chụp giao diện (#188), để các bài khác không chạy hai lần. Pixel 7 chạy trên Chromium
    // nên không cần cài thêm trình duyệt.
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: "visual.spec.ts" },
  ],
});
