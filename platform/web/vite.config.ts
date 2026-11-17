// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Build giao diện ra tệp tĩnh. Khi phát triển, máy chủ Vite chuyển /v1 sang cổng APISIX để trình duyệt gọi API như
// cùng một địa chỉ; bản cài thật không cần vì giao diện và API cùng đứng sau cổng.

import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const gateway = process.env.MORTISE_PUBLIC_URL ?? "http://localhost:9080";

export default defineConfig({
  plugins: [react()],
  // Xem src/noAjv.ts: rjsf nhập bộ kiểm AJV ở một hàm kiểm thử mà giao diện không dùng.
  resolve: { alias: { "@rjsf/validator-ajv8": fileURLToPath(new URL("./src/noAjv.ts", import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/v1": gateway },
  },
  // Kiểm thử đơn vị (Vitest) chỉ lấy tệp trong src/; e2e/ là của Playwright và cần một bản cài đang chạy.
  test: { include: ["src/**/*.test.ts"] },
});
