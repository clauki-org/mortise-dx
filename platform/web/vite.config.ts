// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Build giao diện ra tệp tĩnh. Khi phát triển, máy chủ Vite chuyển /v1 sang cổng APISIX để trình duyệt gọi API như
// cùng một địa chỉ; bản cài thật không cần vì giao diện và API cùng đứng sau cổng.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const gateway = process.env.MORTISE_PUBLIC_URL ?? "http://localhost:9080";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/v1": gateway },
  },
});
