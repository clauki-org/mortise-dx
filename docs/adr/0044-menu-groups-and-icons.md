<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0044. Menu chia nhóm theo gói, biểu tượng theo ý nghĩa, tên gói lưu cùng mục menu

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27

## Bối cảnh

Menu bên của khung giao diện là một danh sách phẳng: màn hình dùng chung, rồi mọi mục của mọi gói đã cài, rồi mục
mẫu của lõi, cùng một kiểu, không có biểu tượng ([ADR 0023](0023-package-pages-in-the-web-shell.md)). Cài hai gói
thì người dùng không thấy mục nào thuộc việc nào, và mục mẫu để thử nằm lẫn với việc thật. Trên điện thoại, thanh
trên giấu đơn vị và tên người dùng.

Trình duyệt chỉ đọc được bảng `platform.menu_items` qua GraphQL, không đọc được `app.yaml`; bảng chỉ có mã gói
(`app`). Tầng 2 không được chứa tên gói hay từ của lĩnh vực nào, nên tên nhóm phải đến từ dữ liệu.

| Lựa chọn cho tên nhóm | Đánh giá |
|---|---|
| Hiện mã gói (`facilities-commune`) | Không cần đổi gì, nhưng là mã kỹ thuật, không phải lời của người dùng |
| Bảng gói riêng (`platform.apps`) để giao diện nối vào | Đúng hơn về mô hình, nhưng thêm một bảng, một quan hệ Hasura và một bước nạp chỉ để lấy một chuỗi |
| Lưu tên gói (`app_name`) trên từng dòng menu | Một cột, bộ cài gói ghi cùng câu lệnh đang có; tên lặp lại trên mỗi mục của cùng gói |

| Lựa chọn cho biểu tượng | Đánh giá |
|---|---|
| Gói khai tên hình của thư viện (`IconMapPin`) | Gói phụ thuộc vào thư viện hình; giao diện phải tra hình theo tên lúc chạy, nên bản build chứa cả bộ hình |
| Gói khai ý nghĩa trong một danh mục nhỏ, Tầng 2 chọn hình | Hình đồng bộ ở mọi gói, đổi thư viện hình không phải sửa gói; gói chỉ chọn được trong danh mục |

## Quyết định

- Mục menu trong `app.yaml` có `icon` tùy chọn, là một ý nghĩa trong danh mục của `contracts/app.schema.json`:
  `list` (danh sách), `form` (biểu mẫu), `map` (bản đồ), `chart` (biểu đồ, số liệu), `chat` (hỏi đáp), `inbox`
  (hộp việc), `document` (giấy tờ), `folder` (hồ sơ), `settings` (cài đặt). Danh mục không có từ của lĩnh vực nào.
  Được sửa theo [ADR 0051](0051-home-page.md): thêm `home` (trang chủ) vào đầu danh mục.
  `platform/web/src/menuIcons.tsx` gán mỗi ý nghĩa một hình của Tabler Icons (`@tabler/icons-react`, MIT), nhập tĩnh
  từng hình; không tra hình theo tên lúc chạy. Hình chỉ để nhìn nhanh, có `aria-hidden`, tên của liên kết vẫn là
  nhãn. Giá trị lạ đọc từ CSDL thì mục chỉ có nhãn.
- Migration `platform/schema/migrations/20261127100000_menu_item_groups.sql` thêm hai cột cho phép null vào
  `platform.menu_items`: `app_name` (`name` của gói) và `icon`. Quyền đọc của `user` trong
  `platform/schema/hasura/tables.yaml` liệt kê thêm hai cột. `scripts/app-deploy.py` ghi cả hai khi cài gói và khi
  nạp menu của lõi, và cập nhật dòng khi một trong hai đổi.
- Mục mẫu của lõi (`scripts/core-menu.yaml`, lõi không có `app.yaml`) lấy tên nhóm từ `name` của chính tệp đó
  ("Mẫu thử"); bộ nạp từ chối tệp thiếu `name`.
- Thanh bên gom mục theo gói (`menuGroups` trong `menu.ts`), giữ thứ tự gói và thứ tự mục của câu truy vấn. Nhóm
  đầu là màn hình dùng chung ("Chung": "Việc của tôi"; được sửa theo [ADR 0051](0051-home-page.md): "Trang chủ" rồi
  "Việc của tôi"); nhóm của chủ sở hữu `core` (mục mẫu) đứng cuối, thu gọn sau
  một nút có `aria-expanded`, mở sẵn khi trang đang mở thuộc nhóm đó. Dòng chưa có `app_name` dùng mã gói làm tên
  nhóm.
- Thanh trên ghi đơn vị và tên đăng nhập ở mọi bề rộng, chữ màu đạt tương phản WCAG AA trên nền trắng. Vùng nội dung
  giới hạn bề rộng (`Container` cỡ `xl` của Mantine). Dưới cỡ `sm` thanh bên thu vào nút mở menu; "Thêm Passkey" và
  "Đăng xuất" chuyển xuống cuối thanh bên.

## Hệ quả

- Gói chọn biểu tượng bằng ý nghĩa, không cần biết thư viện hình; thêm ý nghĩa mới là sửa schema, `MENU_ICONS` và
  bảng hình trong cùng pull request (`menu.test.ts` so danh mục của schema với giao diện, tsc báo ý nghĩa thiếu hình).
- Bản cài đang chạy cần `make seed` (menu của lõi) và `make app-install APP=<gói>` cho từng gói đã cài sau khi áp
  migration, để điền `app_name` và `icon`; trước đó nhóm hiện mã gói và mục không có biểu tượng, menu vẫn dùng được.
- Tên gói lặp trên mỗi dòng menu của gói; đổi `name` trong `app.yaml` thì cài lại gói để menu nhận tên mới.
- Mục mẫu nhận diện bằng chủ sở hữu `core`, giá trị mà `make seed` dùng khi nạp; mục do lõi nạp theo cách khác cũng
  rơi vào nhóm mẫu.
- Bài kiểm trên trình duyệt mở mục menu qua `openMenuItem` (`platform/web/e2e/support.ts`), hàm tự mở nút menu và
  nhóm thu gọn khi cần.
