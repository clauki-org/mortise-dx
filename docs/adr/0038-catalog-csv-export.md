<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0038. Xuất danh sách của danh mục ra CSV ngay trong trình duyệt, bằng quyền của người xuất

- Trạng thái: Chấp nhận
- Ngày: 2026-11-24

## Bối cảnh

Người dùng cần tải danh sách của đơn vị mình về thành tệp để lưu hay gửi đi. Ví dụ: cán bộ xã A tải danh sách cơ sở
của xã A. Tệp phải:

- chỉ chứa dữ liệu người tải được phép xem;
- khớp với điều đang thấy trên màn hình;
- ghi rõ nguồn, thời điểm xuất và người xuất.

Các cách đã xét:

- **Dịch vụ báo cáo phía máy chủ:** thêm một dịch vụ phải vận hành. Nó phải đọc bằng token của người xuất mới giữ
  được quyền theo dòng; còn nếu đọc bằng tài khoản dịch vụ thì vượt quyền.
- **Xuất trong trình duyệt bằng chính câu truy vấn của bảng:** không thêm thành phần nào. Quyền là quyền Hasura của
  người đang đăng nhập, điều kiện và thứ tự là của bảng đang xem.

Về định dạng:

- **PDF:** cần thư viện dựng trang, khó dùng lại số liệu.
- **Bảng tính (xlsx):** cần thêm một thư viện vào giao diện.
- **CSV:** đọc được bằng mọi bảng tính và mọi ngôn ngữ lập trình, không cần thư viện.

## Quyết định

- **Màn hình danh sách của thành phần danh mục có nút "Xuất CSV".** Gói không phải khai gì thêm.
- **Bảng đối tượng con** trong màn hình chi tiết không có nút này.
- **Dữ liệu đọc thế nào:**
  - Đọc qua client GraphQL của trang, tức bằng token của người xuất, với đúng câu truy vấn, điều kiện tìm, lọc và thứ
    tự của bảng đang xem.
  - Đọc mọi dòng khớp điều kiện, không chỉ trang đang xem, trong **một** truy vấn. Một truy vấn là một câu SQL, tức
    một ảnh chụp nhất quán; đọc theo lô thì dòng được thêm hay xóa giữa hai lô làm tệp lặp hay sót dòng.
- **Giới hạn 5.000 dòng mỗi tệp.** Đọc thừa một dòng để biết có vượt không; vượt thì không xuất và báo cách thu hẹp
  bằng tìm hay lọc.
- **Đọc lỗi thì không tải tệp nào.** Một tệp thiếu dòng trông vẫn như tệp đủ.
- **Nội dung tệp:**
  - Mã hóa UTF-8 có BOM; xuống dòng CRLF và cách bọc nháy kép theo RFC 4180.
  - Tám dòng đầu ghi tên danh sách, nguồn (trường GraphQL), đơn vị (claim `tenant` của token), thời điểm xuất,
    múi giờ, người xuất, điều kiện đang áp và số dòng.
  - Điều kiện chỉ ghi điều truy vấn thật sự áp: tham số lọc lạ trên đường dẫn không lọc gì thì không được ghi.
  - Tiếp theo là một dòng trống, rồi bảng có tiêu đề cột theo nhãn.
- **Cách ghi giá trị:**
  - Choices và ngày giờ ghi như trên màn hình, theo giờ của máy người xuất. Thời điểm xuất ghi cùng giờ đó kèm độ
    lệch (ISO 8601), múi giờ ghi ở đầu tệp, tên tệp mang ngày theo giờ đó.
  - Số ghi dạng máy đọc được, không có dấu ngăn hàng nghìn.
- **Chặn công thức (CSV injection).** Ô bắt đầu bằng `=`, `+`, `-`, `@`, tab hay CR, kể cả ở phần đầu tệp, được thêm
  dấu `'` phía trước. Lý do: tên cơ sở do người dùng gõ như `=HYPERLINK(...)` sẽ chạy khi người nhận mở tệp bằng bảng
  tính. Ô chỉ gồm một số (`-21.03`, `+84`) không phải công thức nên giữ nguyên.

## Hệ quả

- **Không thêm dịch vụ hay thư viện.** Số liệu trong tệp là số Hasura trả cho người xuất, cùng nguồn với màn hình.
- **Tệp CSV không mang chữ ký hay dấu chống sửa.** Phần đầu tệp ghi nguồn và người xuất, nhưng ai giữ tệp cũng sửa
  được.
- **Lần xuất không được ghi nhật ký** ở phía máy chủ, vì việc đọc qua Hasura không có nhật ký đọc.
- **Tám dòng đầu tệp không phải bảng.** Chương trình đọc tệp phải bỏ qua phần đầu tới dòng trống đầu tiên.
- **Một quyền select của Hasura có đặt `limit` nhỏ hơn số dòng thì tệp thiếu mà không báo**, vì Hasura cắt bớt dòng mà
  không trả lỗi. Hiện chưa quyền nào của lõi hay của gói đặt `limit`.
- **Chưa kiểm:**
  - Cách tệp mở trong Excel và LibreOffice: BOM, dấu phẩy phân cách khi bảng tính dùng dấu phẩy thập phân (vi-VN),
    ngày dạng ngày/tháng/năm, dấu `'` chặn công thức, ký tự toàn chiều rộng như `＝`.
  - Firefox và Safari; kiểm tự động chạy trên Chromium.
  - Kiểm tự động chỉ đọc lại nội dung tệp.
- **Việc tiếp theo:** xuất số liệu của bảng điều hành, và báo cáo theo cấu hình của gói. Cả hai chưa có issue.
