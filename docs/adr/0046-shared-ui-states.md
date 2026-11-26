<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0046. Trạng thái đang tải, rỗng, lỗi dùng chung; lỗi đổi sang lời tiếng Việt theo mã

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27

## Bối cảnh

Mỗi trang của giao diện Tầng 2 tự vẽ trạng thái đang tải, rỗng và lỗi. Khoảng hai mươi chỗ hiện nguyên văn
`error.message`: với lỗi GraphQL là chữ tiếng Anh của Hasura (`[GraphQL] field 'x' not found in type: 'y'`), với lỗi
của cổng không mang lý do là "Máy chủ trả lỗi 502". Người dùng không biết nên làm gì; mỗi trang lại ghép thêm một câu
"Tải lại trang; nếu vẫn lỗi..." khác nhau, có trang có nút Thử lại, có trang không.

Ngược lại, dịch vụ tự viết của lõi (workflow-api, files-api, context-api, assistant) và cổng (giới hạn tần suất) trả lỗi
dạng `{"error": "..."}` viết sẵn bằng tiếng Việt cho người dùng, ví dụ "Quy tắc bốn mắt: người gửi yêu cầu không được
tự duyệt." hay "Mô hình chưa chạy; người vận hành bật bằng make ai-up.". Đổi những câu này thành câu chung theo mã HTTP
sẽ làm mất đúng thông tin người dùng cần.

## Quyết định

- `platform/web/src/States.tsx` có ba thành phần: `Loading` (nhãn luôn bắt đầu bằng "Đang tải", e2e chờ nhãn này biến
  mất), `Empty` (câu chính, việc nên làm, nút nếu có) và `ErrorNotice` (khối `role="alert"`: tiêu đề do trang đặt, lời
  dễ hiểu, nút "Thử lại" khi trang tải lại được, thông điệp gốc trong phần "Chi tiết kỹ thuật" đóng sẵn bằng thẻ
  `details` của trình duyệt).
- `platform/web/src/errorText.ts` đổi lỗi thành lời:
  - `ApiError` mang cờ `readable`: lý do đọc từ `{"error": "..."}` hay do `api.ts` viết thì giữ nguyên, với mọi mã;
    chỉ lỗi không có lý do (trang lỗi của proxy, thân không phải JSON) mới đổi theo mã 0, 401, 403, 404, 409, 413,
    400/422, 429, 5xx.
  - `CombinedError` của urql: theo `extensions.code` của Hasura (`invalid-jwt`, `access-denied`, `permission-error`,
    `validation-failed`, `constraint-violation`, `data-exception`); lỗi mạng theo mã HTTP của phản hồi nếu có, không
    có phản hồi là mất kết nối.
  - `ReadableError` là lỗi mà nơi ném đã viết lời cho người dùng (lời của `insertError`, `uploadError`, `linkError`);
    giữ nguyên.
  - Lỗi khác (lỗi lập trình, lỗi khi vẽ) thành một câu chung, thông điệp gốc vào phần chi tiết.
- Chữ nghiệp vụ trong trạng thái rỗng đến từ cấu hình: bảng danh mục nhận nhãn của danh sách (tiêu đề danh mục hay
  nhãn đối tượng con) và ghép vào lời gợi ý; thành phần không tự đặt tên đối tượng.

## Hệ quả

- Lỗi trên các trang danh mục, chi tiết, tệp đính kèm, biểu mẫu, bảng việc, hồ sơ, trợ lý và bản đồ cùng một kiểu;
  thông điệp gốc nằm sau "Chi tiết kỹ thuật". Danh sách tìm lọc không ra dòng nào có nút bỏ điều kiện.
- `insertError` và `linkError` vẫn chép thông điệp của Hasura vào lời báo với lỗi ràng buộc hay mã không nhận ra, vì
  người quản trị cần nó để sửa cấu hình; tách phần đó sang "Chi tiết kỹ thuật" là việc sau.
- Lý do của máy chủ đi thẳng lên giao diện, nên dịch vụ của lõi phải tiếp tục viết `error` bằng lời cho người dùng;
  câu chỉ dành cho người vận hành (như "kiểm tra `make ps`") cũng hiện cho người dùng như trước.
- Khung trang (`App.tsx`, `Shell.tsx`, `TenantInfo.tsx`) và bảng điều hành (`Dashboard*.tsx`) chưa dùng các thành phần
  này; chúng chuyển sang ở thay đổi sau.
