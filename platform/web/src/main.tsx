// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Điểm khởi động: bọc ứng dụng trong MantineProvider để mọi component dùng chung theme.

import "@mantine/core/styles.css";
// Biểu mẫu (rjsf) dùng ô chọn ngày của Mantine khi schema có trường kiểu ngày.
import "@mantine/dates/styles.css";
import { MantineProvider } from "@mantine/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { theme } from "./theme";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Thiếu phần tử #root trong index.html");
}

createRoot(root).render(
  <StrictMode>
    <MantineProvider theme={theme}>
      <App />
    </MantineProvider>
  </StrictMode>,
);
