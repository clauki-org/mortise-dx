<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0038. Xuất danh sách của danh mục ra CSV, Excel và PDF ngay trong trình duyệt, bằng quyền của người xuất

- Trạng thái: Chấp nhận
- Ngày: 2026-11-25

## Bối cảnh

Người dùng cần tải danh sách của đơn vị mình về thành tệp để lưu hay gửi đi. Ví dụ: cán bộ xã A tải danh sách cơ sở
của xã A. Tệp phải:

- chỉ chứa dữ liệu người tải được phép xem;
- khớp với điều đang thấy trên màn hình;
- ghi rõ nguồn, thời điểm xuất và người xuất.

Cơ quan dùng nhiều nhất là bảng tính Excel; tệp gửi đi hay in ra thì là PDF; CSV để chương trình khác đọc lại.

Các cách đã xét:

- **Dịch vụ báo cáo phía máy chủ:** thêm một dịch vụ phải vận hành. Nó phải đọc bằng token của người xuất mới giữ
  được quyền theo dòng; còn nếu đọc bằng tài khoản dịch vụ thì vượt quyền.
- **Xuất trong trình duyệt bằng chính câu truy vấn của bảng:** không thêm dịch vụ nào. Quyền là quyền Hasura của
  người đang đăng nhập, điều kiện và thứ tự là của bảng đang xem.

## Quyết định

- **Màn hình danh sách của thành phần danh mục có nút "Xuất"** với ba lựa chọn: CSV, Excel (.xlsx), PDF. Gói không
  phải khai gì thêm. Bảng đối tượng con trong màn hình chi tiết không có nút này.
- **Dữ liệu đọc thế nào:**
  - Đọc qua client GraphQL của trang, tức bằng token của người xuất, với đúng câu truy vấn, điều kiện tìm, lọc và thứ
    tự của bảng đang xem.
  - Đọc mọi dòng khớp điều kiện, không chỉ trang đang xem, trong **một** truy vấn. Một truy vấn là một câu SQL, tức
    một ảnh chụp nhất quán; đọc theo lô thì dòng được thêm hay xóa giữa hai lô làm tệp lặp hay sót dòng.
- **Giới hạn 5.000 dòng mỗi tệp.** Đọc thừa một dòng để biết có vượt không; vượt thì không xuất và báo cách thu hẹp
  bằng tìm hay lọc.
- **Đọc hay dựng tệp lỗi thì không tải tệp nào.** Một tệp thiếu dòng trông vẫn như tệp đủ.
- **Một bảng chung cho cả ba định dạng:**
  - Tám cặp nhãn–giá trị ở đầu: tên danh sách, nguồn (trường GraphQL), đơn vị (claim `tenant` của token), thời điểm
    xuất, múi giờ, người xuất, điều kiện đang áp, số dòng.
  - Điều kiện chỉ ghi điều truy vấn thật sự áp: tham số lọc lạ trên đường dẫn không lọc gì thì không được ghi.
  - Tiêu đề cột theo nhãn, đúng thứ tự trên màn hình; rồi các dòng.
  - Choices và ngày giờ ghi như trên màn hình, theo giờ của máy người xuất. Thời điểm xuất ghi cùng giờ đó kèm độ
    lệch (ISO 8601), múi giờ ghi ở đầu tệp, tên tệp mang ngày theo giờ đó.
  - Số ghi dạng máy đọc được, không có dấu ngăn hàng nghìn.
- **CSV:**
  - Không cần thư viện. UTF-8 có BOM; xuống dòng CRLF và cách bọc nháy kép theo RFC 4180; phần đầu, một dòng trống,
    rồi bảng.
  - **Chặn công thức (CSV injection):** ô bắt đầu bằng `=`, `+`, `-`, `@`, tab hay CR, kể cả ở phần đầu tệp, được thêm
    dấu `'` phía trước. Lý do: tên cơ sở do người dùng gõ như `=HYPERLINK(...)` sẽ chạy khi người nhận mở tệp bằng
    bảng tính. Ô chỉ gồm một số (`-21.03`, `+84`) không phải công thức nên giữ nguyên.
- **Excel:** thư viện write-excel-file (MIT), bản `universal` ghi thẳng ra Blob trong trang, không dùng Web Worker.
  Mọi ô chữ khai rõ kiểu chữ, nên chữ bắt đầu bằng `=` là chữ, không thành công thức; ô số là số.
- **PDF:** thư viện pdfmake (MIT) với font Roboto đi kèm (Apache-2.0), có đủ chữ tiếng Việt. Khổ A4, bảng hơn bốn cột
  thì in ngang, dòng tiêu đề lặp lại ở mỗi trang, số trang ở chân trang.
- **Hai thư viện chỉ tải khi người dùng bấm xuất định dạng đó** (nạp động, Vite tách thành tệp riêng), nên không làm
  chậm lần mở trang. Đo bằng `npm run build` ngày 2026-11-25: write-excel-file 70 KB (nén gzip 19 KB); pdfmake 771 KB
  (gzip 289 KB) và font 855 KB (gzip 469 KB).
- **Giấy phép BlueOak-1.0.0 được phép cho thư viện đóng gói vào giao diện** (`WEB_LICENSES_SHIPPED` trong Makefile).
  pdfmake dùng sax (qua xmldoc, để đọc SVG); sax từ bản 1.4.3 mang BlueOak-1.0.0. Giấy phép này được OSI duyệt ngày
  19/01/2024, dễ dãi, chỉ đòi kèm văn bản giấy phép hay đường dẫn tới nó như MIT.

## Hệ quả

- **Không thêm dịch vụ nào.** Số liệu trong tệp là số Hasura trả cho người xuất, cùng nguồn với màn hình.
- **Thêm hai thư viện vào giao diện**, ghi trong bảng giấy phép của README; `make web-check` kiểm giấy phép của mọi
  thư viện đóng gói.
- **Tệp không mang chữ ký hay dấu chống sửa.** Phần đầu tệp ghi nguồn và người xuất, nhưng ai giữ tệp cũng sửa được.
- **Lần xuất không được ghi nhật ký** ở phía máy chủ, vì việc đọc qua Hasura không có nhật ký đọc.
- **Phần đầu tệp CSV và Excel không phải bảng.** Chương trình đọc tệp phải bỏ qua phần đầu tới dòng trống đầu tiên.
- **Một quyền select của Hasura có đặt `limit` nhỏ hơn số dòng thì tệp thiếu mà không báo**, vì Hasura cắt bớt dòng mà
  không trả lỗi. Hiện chưa quyền nào của lõi hay của gói đặt `limit`.
- **Chưa kiểm:**
  - Cách tệp mở trong Excel và LibreOffice: với CSV là BOM, dấu phẩy phân cách khi bảng tính dùng dấu phẩy thập phân
    (vi-VN), ngày dạng ngày/tháng/năm, dấu `'` chặn công thức, ký tự toàn chiều rộng như `＝`; với .xlsx là cách hiện
    ô. Kiểm tự động đọc lại tệp bằng chương trình, không mở bằng ứng dụng.
  - Nội dung chữ trong tệp PDF: kiểm tự động chỉ kiểm tệp tải về là PDF; nội dung bảng PDF kiểm ở mức dữ liệu đưa vào
    pdfmake.
  - Firefox và Safari; kiểm tự động chạy trên Chromium.
- **Việc tiếp theo:** xuất số liệu của bảng điều hành, và báo cáo theo cấu hình của gói. Cả hai chưa có issue.
