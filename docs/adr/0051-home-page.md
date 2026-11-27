<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0051. Trang chủ: việc đang chờ và một ô lối tắt cho mỗi gói

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27

## Bối cảnh

Đường dẫn `/` chuyển thẳng sang bảng việc (`/tasks`). Người có việc chờ thì vào đúng chỗ, nhưng cán bộ chủ yếu lập hồ
sơ hay tra danh mục thì trang mở đầu là một bảng rỗng, phải mở menu mới tới được trang của gói; trên điện thoại menu
gập sau một nút, nên mỗi lần vào là thêm một lần bấm. Bảng việc cũng là bảng nhiều cột, trên điện thoại phải cuộn
ngang.

Kịch bản demo có hai đường bắt đầu từ `/` sau khi đăng nhập, `platform/web/e2e/visual.spec.ts` đếm số lần bấm của cả
hai: người duyệt bấm thẳng vào việc trên trang mở đầu; cán bộ mở mục "Cơ sở nhà, đất" qua menu. Nhiều bài e2e
(`tasks.spec.ts`, `form.spec.ts`, `record.spec.ts`) tìm việc trên trang mở đầu theo đúng chữ của liên kết.

| Lựa chọn | Đánh giá |
|---|---|
| Giữ `/` chuyển sang `/tasks` | Không đổi gì; cán bộ không có việc chờ vẫn vào bảng rỗng |
| Trang chủ chỉ có ô của gói, việc ở `/tasks` | Người duyệt thêm một lần bấm để tới việc |
| Trang chủ có danh sách việc dạng liên kết (không cắt bớt) rồi ô của gói | Người duyệt giữ một lần bấm; cán bộ tới trang của gói từ ô mà không mở menu |

## Quyết định

- Đường dẫn `/` vẽ trang chủ (`platform/web/src/Home.tsx`) thay vì chuyển sang `/tasks`. Tiêu đề cấp 1 "Trang chủ".
- Khối "Việc đang chờ bạn": mọi việc mà `GET /v1/workflow/tasks` trả cho người đăng nhập, không cắt bớt, xếp theo
  hạn như bảng việc. Mỗi việc là một liên kết tới `/tasks/<mã>` mà chữ chỉ là tên hồ sơ, tính như `TaskList`
  (`recordTitle`); bước, nhãn hạn và người gửi đứng ngoài liên kết. Nhờ vậy liên kết có cùng tên truy cập ở hai trang,
  bài e2e tìm việc theo tên không phải đổi. Dùng chung khóa bộ nhớ đệm `["tasks"]` với bảng việc. Liên kết "Mở Việc của
  tôi" dẫn tới bảng việc, nơi có bộ lọc theo hạn.
- Một ô cho mỗi nhóm menu của gói, theo đúng thứ tự và chữ của thanh bên: tiêu đề cấp 2 là tên nhóm (tên gói),
  mỗi mục là một lối tắt cùng nhãn, địa chỉ và biểu tượng như mục menu. Ô đọc từ menu mà thanh bên đã tải
  (`usePackageMenu`), gom bằng cùng một hàm (`packageGroups` trong `menu.ts`), nên Tầng 2 không có chữ hay biểu tượng
  riêng của gói nào. Nhóm dùng chung và nhóm mẫu của lõi (thu gọn trên thanh bên) không có ô.
- Ô của gói đứng trên khối việc: ô có chiều cao cố định, còn danh sách việc không cắt bớt và có thể dài hàng trăm
  việc; đặt ô dưới thì lối tắt bị đẩy xuống cuối trang. Màn hình rộng: ô xếp hai cột. Màn hình hẹp: các ô xếp chồng.
- Menu: nhóm "Chung" có "Trang chủ" đứng đầu, rồi "Việc của tôi". Sửa [ADR 0044](0044-menu-groups-and-icons.md): danh
  mục ý nghĩa biểu tượng thêm `home` (trang chủ), không có từ của lĩnh vực nào; `contracts/app.schema.json`,
  `MENU_ICONS` và bảng hình (`IconHome` của Tabler Icons) đổi cùng lúc, `menu.test.ts` so danh mục của schema với
  giao diện như trước.
- Màn hình xử lý việc gửi xong vẫn chuyển về `/tasks` kèm thông báo "Đã gửi", như trước.

## Hệ quả

- Người duyệt vẫn bấm thẳng vào việc ngay ở trang mở đầu. Cán bộ mở trang của gói từ lối tắt trên trang chủ; trên điện
  thoại không phải mở menu trước. Bài đếm số lần bấm (`visual.spec.ts`) đi theo lối tắt trên trang chủ và ghi số lần
  bấm của mỗi cỡ màn hình vào kết quả chạy.
- Trên trang chủ, nhãn của mục menu xuất hiện hai lần: trên thanh bên và trong ô. Bài e2e tìm mục menu trong vùng
  điều hướng "Menu chính" (`openMenuItem`) hay trong vùng nội dung (`getByRole("main")`), không tìm trên cả trang.
- Ô chỉ có những gì menu có: gói chưa khai mục menu thì không có ô. Số liệu, mô tả của gói trên ô là kế hoạch, cần
  thêm trường vào `app.yaml` và quyết định riêng.
- Gói khai được `icon: home` cho mục của mình; ý nghĩa vẫn là trang chủ, không thêm hình mới.
