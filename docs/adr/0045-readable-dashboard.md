<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0045. Bảng điều hành dễ đọc: số chính nổi bật, cách tính và nguồn thu gọn, biểu đồ có nhãn số

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27
- Sửa đổi: [ADR 0033](0033-dashboard-component.md)

## Bối cảnh

ADR 0033 cho mỗi con số đi kèm cách tính và nguồn để người xem đối chiếu được. Cách làm đó đặt mọi thứ ngay trên
trang: `description` của khối vừa là lời giới thiệu vừa là ghi chú kỹ thuật ("View area_summary…", "dòng có status
in_use"), mỗi thẻ có dòng "Cách tính" dưới số, biểu đồ có thanh không ghi số và bảng số liệu luôn mở. Trên bảng điều
hành của gói cơ sở vật chất xã, người xem gặp tên view, tên cột và giá trị mã trước khi gặp con số; mọi khối cùng cỡ
nên không có điểm nhìn chính; thanh có giá trị 0 không vẽ gì, trông như thiếu dòng (loại "Chuyên dùng" của khối diện
tích theo loại có đang dùng bằng 0).

Điều cần giữ từ ADR 0033: số không tính trên trình duyệt; vẫn đối chiếu được từng số với nguyên văn câu truy vấn; biểu
đồ có bản đọc được cho trình đọc màn hình; thành phần không chứa chữ của lĩnh vực nào. Các ví dụ sai của hợp đồng so
thông điệp lỗi đúng từng ký tự, và thông điệp có cả khối cấu hình, nên đổi tên `description` sẽ phải viết lại các dòng
đó mà không vì lý do gì.

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Chỗ của ghi chú kỹ thuật | Giữ trong `description`, thu gọn cả đoạn | Người xem mất luôn câu giới thiệu khối |
| | Trường mới `method`, chỉ hiện khi mở | `description` thành một câu cho người xem; không đổi tên trường nào |
| Giữ lời người dùng | Chỉ ghi luật trong schema | Không ai biết khi gói viết lại tên view vào mô tả |
| | `make check-fast` từ chối tên kỹ thuật trong chữ người xem thấy | Luật kiểm được: tên lấy từ chính cấu hình và quyền Hasura của gói |
| Bảng số liệu của biểu đồ | Luôn mở như ADR 0033 | Lặp lại số đã ghi trên thanh, chiếm chỗ của khối khác |
| | Luôn có trong trang, thu gọn | Trình đọc màn hình đọc được sau một lần mở; người nhìn đọc số trên thanh |

## Quyết định

- **`description` là lời của người xem**: khối cho biết điều gì, một hai câu, hiện dưới tiêu đề khối. Trường mới
  `method` của khối ghi cách tính và ghi chú kỹ thuật (view nào, lọc theo giá trị nào, giới hạn của số).
  `description` của thẻ vẫn bắt buộc và vẫn là cách tính của số đó, nhưng không hiện trên thẻ nữa.
- **Một mục "Xem cách tính" cho mỗi khối**, đóng sẵn, mở bằng chuột hay bàn phím (phần tử `details`): `method`, cách
  tính của từng thẻ kèm nhãn thẻ, rồi phần "Nguồn" giữ nguyên nội dung của ADR 0033 (loại nguồn, bảng, cột, vai trò,
  nguyên văn câu truy vấn trong `<pre>` và biến, hay đường dẫn REST). Mục "Nguồn" không còn là mục mở riêng.
- **Thẻ số** chỉ gồm nhãn, số và đơn vị; số và đơn vị nằm trong một phần tử.
- **Khối chính và lưới**: `primary: true` cho tối đa một khối (schema dùng `maxContains`), phải là thẻ số và không
  khai `size: half`. Khối chính hiện đầu tiên, rộng cả hàng, số cỡ `h1` của theme. Các khối xếp theo lưới hai cột trên
  màn hình rộng; `size: half` chiếm nửa hàng, bỏ trống là cả hàng; màn hình hẹp mọi khối rộng cả hàng. Thành phần kiểm
  lại hai luật của khối chính lúc chạy.
- **Biểu đồ**: mỗi thanh ghi số của nó bên phải; ô có số, kể cả 0, luôn có vạch tối thiểu 2px; ô trống không vẽ, chỉ
  ghi "Chưa có số liệu". Dưới các thanh có thang chung từ 0 tới số lớn nhất. Hai cột số trở lên thì có chú giải màu;
  một cột số thì ghi nhãn cột số thay cho chú giải. Thanh vẫn vẽ bằng CSS, không thêm thư viện.
- **Bảng số liệu** của biểu đồ luôn có trong trang, trong mục "Xem bảng số liệu" đóng sẵn. Phần thanh vẫn ẩn khỏi trình
  đọc màn hình; người dùng trình đọc màn hình mở mục đó để đọc bảng có chú thích như ADR 0033. Bảng rộng hơn màn hình
  thì cuộn ngang trong một khung nhận focus và có tên, để người dùng bàn phím cuộn được.
- **Mã máy trên trục**: với nguồn `context`, giá trị trục là mã entity. Thanh ghi nhãn trong `chart.x.choices` nếu gói
  khai; không có thì ghi nhãn trục kèm số thứ tự ("Thiết bị 1"), mã gốc chỉ còn trong bảng số liệu thu gọn.
- Chữ trên thẻ, thang và lời báo rỗng dùng màu chữ thường của theme, không dùng màu `dimmed`, vì màu đó ở cỡ chữ nhỏ
  không đạt tương phản WCAG AA.
- **`make check-fast` từ chối** tiêu đề, mô tả của trang và của khối, nhãn của thẻ, nhãn trục, cột số, cột chi tiết,
  nhãn của `choices` và của `link` khi chứa tên kỹ thuật của khối: trường GraphQL và tên bảng ngắn theo quyền Hasura
  của gói, cột, giá trị của `where`, vai trò, khóa quy trình, loại và tên số đo của `context`; hay bất kỳ tên dạng
  snake_case nào. So nguyên từ, phân biệt hoa thường. `method` và `description` của thẻ không bị kiểm vì chỉ hiện
  trong "Xem cách tính".

## Hệ quả

- Gói cơ sở vật chất xã viết lại mô tả các khối bằng lời của người xem; tên view, giá trị `in_use`, vai trò
  `rollup_reader`, khóa quy trình, "UTC" chuyển vào `method`. Khối diện tích nhà làm việc là khối chính, hai khối cơ sở
  đang dùng và dôi dư nửa hàng.
- Luật chỉ bắt tên có trong cấu hình hay dạng snake_case. Chữ kỹ thuật khác (tên dịch vụ như workflow-api, từ tiếng
  Anh trong ngoặc như "(custodian)") người viết gói phải tự chuyển; các ghi chú đó trong gói cơ sở vật chất xã nay nằm
  ở `method` hay ở cách tính của thẻ.
- Gói cơ sở vật chất xã khai nhãn cho thiết bị demo của kho lưu trữ; thiết bị thêm sau mà không khai nhãn hiện theo số
  thứ tự, nên thứ tự đổi khi có thiết bị mới. Nhãn thiết bị lấy từ nguồn (thuộc tính tên của entity) là việc sau.
- e2e bảng điều hành mở "Xem cách tính" và "Xem bảng số liệu" trước khi đọc câu truy vấn hay dòng của bảng, và so cả
  chữ của thẻ thay vì một đoạn.
