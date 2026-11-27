// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Điểm khởi động: đọc thương hiệu của bản cài (/branding.json) rồi mới vẽ, để tên, logo và màu đúng ngay từ khung
// hình đầu; bọc ứng dụng trong MantineProvider để mọi component dùng chung theme.

import "@mantine/core/styles.css";
// Biểu mẫu (rjsf) dùng ô chọn ngày của Mantine khi schema có trường kiểu ngày.
import "@mantine/dates/styles.css";
// Be Vietnam Pro (OFL-1.1, ADR 0048): mỗi độ đậm gồm các tập chữ Việt, Latin và Latin mở rộng; trình duyệt chỉ tải tập
// có ký tự trên trang (unicode-range). Vite xuất tệp phông thành tệp riêng trong assets/, không nhúng data: (CSP).
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/800.css";
// Nạp sau CSS của Mantine để các quy tắc cùng độ ưu tiên trong đó thắng.
import "./theme.css";
import { MantineProvider } from "@mantine/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BrandingContext, loadBranding } from "./branding";
import { createAppTheme, cssVariablesResolver } from "./theme";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Thiếu phần tử #root trong index.html");
}

// loadBranding không bao giờ ném lỗi: tệp thiếu, hỏng hay chậm thì dùng thương hiệu mặc định.
const branding = await loadBranding();
document.title = branding.name;

createRoot(root).render(
  <StrictMode>
    <BrandingContext value={branding}>
      <MantineProvider theme={createAppTheme(branding.color)} cssVariablesResolver={cssVariablesResolver}>
        <App />
      </MantineProvider>
    </BrandingContext>
  </StrictMode>,
);
