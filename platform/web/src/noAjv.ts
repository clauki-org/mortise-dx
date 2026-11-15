// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// @rjsf/core 6.11.1 xuất getTestRegistry (công cụ kiểm thử của rjsf), hàm này nhập @rjsf/validator-ajv8 dù gói đó chỉ
// là phụ thuộc phát triển của rjsf, nên build báo không tìm thấy. Giao diện không dùng getTestRegistry và không được
// dùng AJV (CSP chặn new Function, xem formValidator.ts); vite.config.ts trỏ tên gói đó về đây để build được và để AJV
// không bao giờ lọt vào bản build. Mã nào lỡ dùng tới thì báo lỗi ngay thay vì chạy sai lặng lẽ.

const unavailable = new Proxy(
  {},
  {
    get() {
      throw new Error("AJV không dùng được trong giao diện vì CSP chặn new Function; dùng formValidator");
    },
  },
);

export default unavailable;
