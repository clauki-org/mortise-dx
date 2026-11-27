// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm bảng đổi lỗi sang lời tiếng Việt (errorText.ts): lý do máy chủ viết cho người dùng giữ nguyên, lỗi chỉ có mã
// HTTP hay mã GraphQL đổi thành lời nói cách sửa, thông điệp gốc chỉ nằm ở phần chi tiết kỹ thuật.

import { CombinedError } from "urql";
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { errorText, ReadableError, statusText } from "./errorText";

const graphql = (code: string) =>
  new CombinedError({ graphQLErrors: [{ message: "field 'x' not found in type: 'y'", extensions: { code } }] });

describe("errorText", () => {
  it("giữ nguyên lý do máy chủ viết cho người dùng, mã HTTP vào phần chi tiết", () => {
    const view = errorText(new ApiError(403, "Quy tắc bốn mắt: người gửi yêu cầu không được tự duyệt."));
    expect(view.text).toBe("Quy tắc bốn mắt: người gửi yêu cầu không được tự duyệt.");
    expect(view.detail).toBe("HTTP 403");
  });

  it("giữ nguyên lý do 503 chỉ cách bật dịch vụ", () => {
    expect(errorText(new ApiError(503, "Mô hình chưa chạy; người vận hành bật bằng make ai-up.")).text).toContain(
      "make ai-up",
    );
  });

  it("lỗi mạng của api.ts không có phần chi tiết", () => {
    expect(errorText(new ApiError(0, "Không kết nối được máy chủ")).detail).toBeUndefined();
  });

  it.each([
    [401, /^Phiên đăng nhập đã hết hạn/],
    [403, /^Tài khoản không được làm việc này/],
    [404, /^Không tìm thấy dữ liệu/],
    [409, /thay đổi ở nơi khác/],
    [413, /lớn quá giới hạn/],
    [422, /Kiểm tra lại các ô đã nhập/],
    [429, /Chờ một phút/],
    [502, /^Máy chủ đang gặp sự cố/],
    [503, /^Máy chủ đang gặp sự cố/],
  ])("mã %i không kèm lý do thành lời theo mã", (status, expected) => {
    const view = errorText(new ApiError(status, `Máy chủ trả lỗi ${status}`, false));
    expect(view.text).toMatch(expected);
    expect(view.detail).toBe(`Máy chủ trả lỗi ${status}`);
  });

  it("mã lạ vẫn có lời chung", () => {
    expect(statusText(418)).toMatch(/^Đã có lỗi không mong muốn/);
  });

  it.each([
    ["invalid-jwt", /^Phiên đăng nhập đã hết hạn/],
    ["access-denied", /^Tài khoản không được/],
    ["permission-error", /^Tài khoản không được/],
    ["validation-failed", /báo người quản trị kiểm cấu hình và quyền/i],
    ["constraint-violation", /ràng buộc/],
    ["data-exception", /sai định dạng/],
    ["unexpected", /^Máy chủ dữ liệu từ chối/],
  ])("lỗi GraphQL %s không hiện nguyên văn", (code, expected) => {
    const view = errorText(graphql(code));
    expect(view.text).toMatch(expected);
    expect(view.text).not.toContain("not found");
    expect(view.detail).toContain("[GraphQL] field 'x' not found");
  });

  it("lỗi mạng của urql không có phản hồi là mất kết nối", () => {
    const view = errorText(new CombinedError({ networkError: new Error("Failed to fetch") }));
    expect(view.text).toMatch(/^Không kết nối được máy chủ/);
    expect(view.detail).toContain("Failed to fetch");
  });

  it("lỗi mạng của urql có phản hồi đổi theo mã HTTP", () => {
    const error = new CombinedError({ networkError: new Error("Unauthorized"), response: { status: 401 } });
    expect(errorText(error).text).toMatch(/^Phiên đăng nhập đã hết hạn/);
  });

  it("ReadableError giữ nguyên, không có phần chi tiết", () => {
    expect(errorText(new ReadableError("Tệp bị từ chối: Tệp chứa mã độc."))).toEqual({
      text: "Tệp bị từ chối: Tệp chứa mã độc.",
    });
  });

  it("lỗi khác thành lời chung, thông điệp gốc vào chi tiết", () => {
    const view = errorText(new TypeError("Cannot read properties of undefined"));
    expect(view.text).toMatch(/^Đã có lỗi không mong muốn/);
    expect(view.detail).toBe("Cannot read properties of undefined");
    expect(errorText("hỏng").detail).toBe("hỏng");
  });
});
