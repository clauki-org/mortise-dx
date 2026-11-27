<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0070. Chế độ Chỉnh sửa trên trang: bản nháp trên trình duyệt, ghi từng thay đổi

- Trạng thái: Chấp nhận
- Ngày: 2026-11-28

## Bối cảnh

Lớp ghi đè cấu hình ([ADR 0060](0060-config-overrides.md)) đã có bảng, trigger kiểm và quyền ghi cho quản trị org,
nhưng chưa có giao diện: muốn đổi nhãn một cột hay kiểu một khối ([ADR 0061](0061-block-composition.md)) phải gọi
GraphQL bằng tay. Quản trị org cần đổi ngay trên trang đang xem, thử vài thay đổi, bỏ bớt, rồi mới lưu cho cả org.

Các câu hỏi đã xét:

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Khi nào ghi | Ghi ngay mỗi lần bấm | Mọi đơn vị trong org thấy ngay từng bước thử; không hoàn tác được trước khi người khác thấy |
| | Bản nháp trên trình duyệt, "Lưu" mới ghi | Chọn: hoàn tác từng bước; thoát thì bỏ |
| Ghi thế nào | Một mutation gộp mọi thay đổi | Một thay đổi bị trigger từ chối làm hỏng cả lần lưu, lời từ chối không chỉ ra thay đổi nào |
| | Từng thay đổi một, theo thứ tự | Chọn: thay đổi qua được thì ghi, thay đổi bị từ chối ở lại bản nháp kèm lý do của trigger |
| Đổi thứ tự | Kéo thả | Cần đường bàn phím riêng; ngoài phạm vi bản hẹp |
| | Nút lên, xuống | Chọn: mỗi nút có tên gồm tên phần tử, dùng được bằng bàn phím |
| Danh sách nút dựng từ đâu | Cấu hình đã trộn | Phần đã ẩn không còn trong đó nên không hiện lại được |
| | Cấu hình gốc của gói cộng phần chỉnh (đã lưu và trong bản nháp) | Chọn |

## Quyết định

- **Nút "Chỉnh sửa"** ở đầu trang của mỗi mục menu, chỉ hiện cho quản trị org (cùng cách xét với trang "Ứng dụng",
  [ADR 0065](0065-package-on-off.md)). Bật lên là một vùng "Chỉnh sửa trang" phía trên thành phần, không đổi phần vẽ
  của thành phần.
- **Nút theo đích của overrideTargets()**, nên giao diện không đưa ra điều trigger sẽ từ chối:
  - chính mục: tên trên menu, ẩn khỏi menu, lên, xuống trên menu, kiểu khi cấu hình gốc khai `variant`;
  - trang khối: kiểu, lên, xuống, ẩn, gỡ từng khối; thêm khối từ mục khác của cùng gói (menu hay `blocks`), trừ trang;
    khối đang hiện cuối cùng không ẩn, không gỡ được;
  - danh mục: nhãn mọi trường, hiện, ẩn, thứ tự cột của danh sách; biểu mẫu: nhãn, ẩn (trừ trường bắt buộc), thứ tự;
  - bảng điều hành: tiêu đề, ẩn, thứ tự khối; nhãn và số của ngưỡng thẻ, giữ phép so và chữ mức độ của gói.
- **Kiểu đưa ra là kiểu vẽ được:** danh mục chỉ có Kanban, Lịch khi cấu hình khai mục của chúng
  ([ADR 0066](0066-catalog-kanban-and-calendar.md)).
- **Bản nháp** (`platform/web/src/editDraft.ts`): thay đổi sau thay thay đổi trước của cùng đích; thay đổi không làm
  khác gì bị bỏ; về đúng giá trị của gói là xóa phần chỉnh. Đổi thứ tự ghi số cho mọi phần tử của danh sách. "Hoàn
  tác" bỏ thao tác sau cùng. "Về mặc định" là một thay đổi trong bản nháp, khi lưu thì xóa mọi phần chỉnh của mục.
- **Trước khi lưu** bản nháp được trộn và kiểm bằng chính hàm `*Problems` của thành phần; có lỗi thì báo ngay.
  Trang khối được thêm vào bước kiểm này lúc đọc: trang hết khối thì dùng cấu hình gốc.
- **Lưu:** xóa trước ghi, thêm khối trước kiểu và thứ tự của khối đó. Thay đổi đã ghi rời bản nháp và không hoàn tác
  được nữa. Truy vấn phần chỉnh đọc lại, trang vẽ lại theo cấu hình đã trộn.

## Hệ quả

- Lưu không nguyên tử: lỗi mạng giữa chừng để lại một phần thay đổi đã ghi. Danh sách chờ lưu nói rõ phần nào còn lại.
- Bản nháp không áp lên trang trước khi lưu; trang chỉ đổi sau khi lưu.
- Trang không có ô chỉnh trường tùy chỉnh, bảng con, biểu mẫu lồng hay thương hiệu.
- Danh mục cơ sở của gói xã không khai `variant` ở cấu hình gốc, nên kiểu của chính mục không đổi được; kiểu của khối
  danh mục trên trang "Tổng quan" thì đổi được.
- Một mục đặt hai lần trên cùng trang chỉ chỉnh được lần đặt đầu, vì đích của khối là tên mục.
- `make web-check` chạy `editDraft.test.ts`, `editModel.test.ts`, `EditMode.test.tsx`; `make e2e` chạy
  `e2e/edit-mode.spec.ts`.
