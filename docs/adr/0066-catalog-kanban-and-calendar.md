<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0066. Kiểu Kanban và Lịch của danh mục, chuyển thẻ bằng lệnh sửa có so version

- Trạng thái: Chấp nhận
- Ngày: 2026-11-28

## Bối cảnh

Danh sách của danh mục có hai kiểu, bảng và thẻ ([ADR 0050](0050-catalog-tones-cards-form-help.md),
[ADR 0061](0061-block-composition.md)). Việc có trạng thái (phiếu mới, đang làm, chờ nghiệm thu, xong) đọc nhanh hơn
khi xếp thành cột theo trạng thái; việc có ngày hẹn đọc nhanh hơn trên lịch. Đổi trạng thái hiện phải mở chi tiết, bấm
"Sửa", chọn giá trị, lưu.

Ví dụ: một gói khai phiếu công việc với trường trạng thái bốn giá trị. Người điều phối mở danh sách ở kiểu Kanban, thấy
bốn cột, kéo một phiếu từ "Mới" sang "Đang làm". Cùng lúc người khác đã sửa phiếu đó: lần kéo phải được báo, không ghi
đè. Giá trị "Chờ nghiệm thu" do quy trình đặt khi thợ gửi biên bản: không ai được kéo phiếu vào hay ra khỏi cột đó.

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Kéo thả | Thư viện kéo thả | Thêm phụ thuộc cho một thao tác; vẫn phải tự làm đường bàn phím có nghĩa cho trình đọc màn hình |
| | Sự kiện kéo thả của trình duyệt, kèm nút "Chuyển sang" trên mỗi thẻ | Không thêm thư viện; nút là đường cho bàn phím, trình đọc màn hình và điện thoại (kéo thả của trình duyệt không chạy khi chạm) |
| Lệnh ghi khi chuyển | Mở biểu mẫu sửa của `detail.edit` | Một lần kéo thành một hộp thoại; biểu mẫu sửa có thể không có trường trạng thái |
| | Lệnh update một cột, so cột version như biểu mẫu sửa ([ADR 0054](0054-edit-and-add-child-from-catalog.md)) | Dùng lại câu mutation, điều kiện và lời báo lỗi; `make check-fast` kiểm như biểu mẫu sửa chỉ có một trường |
| Trạng thái do quy trình đặt | Tầng 2 tự đoán từ BPMN | Không biết được biến của quy trình ứng với cột nào |
| | Gói khai: bỏ `move` (bảng chỉ đọc) hay `locked` (cột không nhận, không cho đi) | Gói biết giá trị nào do quy trình đặt |
| Dữ liệu của Kanban | Đọc một trang danh sách rồi chia theo cột | Cột có dòng vẫn trông rỗng khi các dòng đó ở trang sau |
| | Một câu truy vấn, mỗi cột một bí danh, mỗi cột giới hạn riêng | Một yêu cầu; cột nào còn thẻ thì báo |
| Lịch | Thư viện lịch | Thêm phụ thuộc và cách vẽ riêng cho một lưới bảy cột |
| | Tự vẽ: bảng bảy cột theo tháng, danh sách bảy ngày theo tuần | Bảng có tiêu đề cột đọc được; danh sách tuần đọc được trên điện thoại |

## Quyết định

**Hợp đồng** (`contracts/catalog.schema.json`): `variant` thêm `kanban`, `calendar`; danh mục ngoài cùng nhận thêm
`kanban: {field, move?: {role?, version}, locked?}` và `calendar: {field, title?}`. Kiểu `kanban` thiếu mục `kanban`
(cũng vậy với `calendar`) bị schema từ chối; khối của trang chọn kiểu đó trên danh mục thiếu mục thì
`scripts/check-page-config.py` báo. Lúc chạy, kiểu thiếu mục cấu hình về bảng như kiểu lạ (ADR 0061), và
`catalogViews.ts` kiểm lại: `kanban.field` là cột của chính bảng có `choices`, `locked` nằm trong `choices`,
`calendar.field` là cột `date` hay `datetime`. Sửa danh sách kiểu của [ADR 0061](0061-block-composition.md).

**Kanban** (`CatalogKanban.tsx`):

- Mỗi lựa chọn của `kanban.field` là một cột theo thứ tự `choices`, tiêu đề cột mang nhãn màu khi lựa chọn có `tone`.
  Dòng có giá trị trống hay ngoài `choices` vào cột cuối "Chưa xếp cột", cột đó chỉ hiện khi có dòng.
- Tìm, lọc, thứ tự của danh sách áp cho mọi cột; mỗi cột tối đa `list.page_size` thẻ, xin thừa một để báo còn thẻ.
- Thẻ như ở dạng thẻ: cột đầu là liên kết tới chi tiết; trường chia cột không lặp trên thẻ.
- Khai `move` và token có vai trò `move.role` (bỏ trống là `user`) thì mỗi thẻ kéo được và có nút "Chuyển sang", tên
  truy cập "Chuyển sang: <thẻ>", mở danh sách cột nhận được. Lệnh gửi
  `update_<bảng>(where: {khóa, version}, _set: {field: giá trị})` với vai trò đó; cột version đọc cùng thẻ và giữ
  nguyên chuỗi Hasura trả. Không khớp dòng nào thì báo "Thẻ này đã có người sửa hoặc bạn không còn quyền sửa" và tải lại
  bảng. Kết quả đọc lên qua một vùng `role="status"`.
- Cột trong `locked` không nhận thẻ và thẻ trong đó không chuyển đi, kèm dòng chữ nói giá trị do quy trình đặt.
  Không khai `move` thì bảng chỉ đọc.
- `scripts/check-form-config.py` kiểm `move` như một biểu mẫu sửa chỉ có trường `field`: vai trò sửa được cột đó, đọc
  được khóa, cột version và cột đó, cột version không nằm trong quyền update.

**Lịch** (`CatalogCalendar.tsx`):

- Mỗi dòng hiện ở ngày của `calendar.field`: cột `date` theo ngày lưu, cột `datetime` theo giờ của trình duyệt, như
  `format.ts` hiện hai loại cột.
- Theo tháng là bảng bảy cột từ thứ hai, đủ tuần; theo tuần là danh sách bảy ngày. Có nút trước, sau, hôm nay; hôm
  nay có `aria-current="date"` và chữ "(hôm nay)".
- Câu truy vấn lấy dòng trong khoảng ngày đang xem cùng tìm, lọc, tối đa 200 dòng; quá thì báo.
- Chữ của dòng là `calendar.title` (bỏ trống là cột đầu), là liên kết tới chi tiết. Dòng có giá trị không có dạng ngày
  ISO hiện ở danh sách "Không xếp được vào lịch".

**Chọn kiểu:** nút "Kiểu hiển thị" có thêm "Kanban", "Lịch" khi cấu hình khai mục của chúng; đường dẫn mang
`view=kanban`, `view=calendar`. Ô "Sắp theo" có ở dạng thẻ và Kanban.

**Gói xã:** danh mục cơ sở khai Kanban theo tình trạng (cán bộ phụ trách chuyển được, cùng quyền update và cột
`updated_at` với nút "Sửa") và lịch theo ngày tạo.

## Hệ quả

- Gói có trường trạng thái hay trường ngày thêm hai kiểu bằng vài dòng cấu hình, không viết giao diện, không thêm thư
  viện.
- Chuyển thẻ không qua quy trình, không ghi lý do; trường do quy trình đặt phải khai `locked` hay bỏ `move`, nếu không
  người có quyền update đổi được giá trị bằng tay. Hasura vẫn là nơi chặn cuối.
- Bảng đọc thẻ và cột version bằng vai trò mặc định của token, như danh sách; `make check-fast` chỉ kiểm vai trò
  `move.role` đọc được cột version. Hai vai trò khác nhau mà vai trò mặc định không đọc được cột đó thì lệnh chuyển
  luôn bị báo trùng. Ở gói xã cả hai là `user`.
- Kanban không phân trang; cột dài thì người xem tìm, lọc để thu hẹp. Lịch chỉ đọc, không có sự kiện nhiều ngày, tháng
  và tuần đang xem không nằm trên đường dẫn.
- Bài kiểm tổ hợp (`blocks.test.tsx`) dựng cả hai kiểu cho mọi danh mục: danh mục có mục cấu hình phải vẽ Kanban, Lịch
  thật, danh mục không có phải về bảng.
- **Chưa kiểm** khi ghi quyết định này: kéo thả và nút "Chuyển sang" trên trình duyệt thật, lần chuyển trùng, lịch
  theo tuần, axe của hai kiểu khi có thẻ (`e2e/catalog-views.spec.ts`), ảnh hai kiểu ở cỡ laptop và điện thoại
  (`e2e/visual.spec.ts`). Kiểm tự động đã chạy:
  `make check-fast` (schema, ví dụ sai, quyền của `move`, kiểu của khối) và `make web-check` (câu truy vấn, cột, khoảng
  ngày, nút theo vai trò, cột khóa, bài tổ hợp).
