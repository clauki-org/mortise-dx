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
  // MapLibre tạo worker kiểu module (MapCanvas.tsx); bản worker do Vite build ra phải là module ES mới chạy được như vậy.
  worker: { format: "es" },
  // CSP chỉ cho phông cùng origin (default-src 'self', không có data:). Tệp phông nhỏ hơn ngưỡng của Vite sẽ bị nhúng
  // thành data: và trình duyệt chặn, nên phông luôn là tệp riêng; tài nguyên khác theo ngưỡng mặc định.
  build: { assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined) },
  // Xem src/noAjv.ts: rjsf nhập bộ kiểm AJV ở một hàm kiểm thử mà giao diện không dùng.
  resolve: { alias: { "@rjsf/validator-ajv8": fileURLToPath(new URL("./src/noAjv.ts", import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/v1": gateway },
  },
  // Kiểm thử đơn vị (Vitest) chỉ lấy tệp trong src/; e2e/ là của Playwright và cần một bản cài đang chạy. rjsf được
  // biến đổi như mã của giao diện để bí danh @rjsf/validator-ajv8 ở trên cũng áp khi kiểm thử dựng biểu mẫu; để Node
  // nạp thẳng thì nó tìm gói thật và báo không có.
  // theme.test.tsx đọc theme.css (?raw) để kiểm bộ chọn và biến mà nó dùng; Vitest mặc định thay mọi tệp CSS bằng chuỗi
  // rỗng, nên chỉ tệp đó được xử lý thật.
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    server: { deps: { inline: [/@rjsf\//] } },
    css: { include: [/src\/theme\.css/] },
  },
});
