// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểu cho biến môi trường Vite mà giao diện đọc lúc build.

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OIDC_AUTHORITY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
