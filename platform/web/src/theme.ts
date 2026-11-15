// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Theme mặc định của giao diện. Thương hiệu theo bản cài (tên, logo, màu) sẽ đọc từ cấu hình lúc khởi động và ghi
// đè các giá trị này (ADR 0006).

import { createTheme } from "@mantine/core";

export const theme = createTheme({
  primaryColor: "teal",
  defaultRadius: "md",
});
