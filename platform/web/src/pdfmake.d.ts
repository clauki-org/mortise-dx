// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Khai báo kiểu tối thiểu cho bản trình duyệt của pdfmake 0.3, vốn không kèm kiểu TypeScript: chỉ những gì
// catalogExportOffice.ts dùng (nạp font vào hệ tệp ảo, dựng tài liệu, lấy Blob).

declare module "pdfmake/build/pdfmake" {
  const pdfMake: {
    addVirtualFileSystem(files: Record<string, string>): void;
    createPdf(document: object): { getBlob(): Promise<Blob> };
  };
  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts" {
  const files: Record<string, string>;
  export default files;
}
