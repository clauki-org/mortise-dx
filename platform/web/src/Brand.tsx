// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Tên và logo của bản cài (branding.ts), dùng ở màn hình chờ đăng nhập (App.tsx) và thanh trên (Shell.tsx). Chỉ gồm
// phần tử inline, để đặt được trong tiêu đề hay đoạn chữ của nơi gọi; ngữ nghĩa (tiêu đề cấp 1 hay không) do nơi gọi
// quyết định.

import { Box } from "@mantine/core";
import { useBranding } from "./branding";

// compact: trên màn hình hẹp chỉ hiện tên ngắn, để thanh trên không đẩy nút đăng xuất ra ngoài.
export function Brand({ compact = false }: { compact?: boolean }) {
  const { name, shortName, logo } = useBranding();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--mantine-spacing-xs)" }}>
      {/* Logo đứng cạnh tên nên là ảnh trang trí: alt rỗng để trình đọc màn hình không đọc tên hai lần. */}
      {logo && <img src={logo} alt="" style={{ height: "1.5em", width: "auto" }} />}
      {compact && shortName !== name ? (
        <>
          <Box component="span" visibleFrom="sm">
            {name}
          </Box>
          <Box component="span" hiddenFrom="sm">
            {shortName}
          </Box>
        </>
      ) : (
        <span>{name}</span>
      )}
    </span>
  );
}
