<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0033. Thành phần bảng điều hành: số do gói tính sẵn, mỗi số kèm cách tính và câu truy vấn

- Trạng thái: Chấp nhận
- Ngày: 2026-11-23

## Bối cảnh

Lãnh đạo xã và tỉnh cần xem các con số chính của một gói (ví dụ diện tích được phép, đang dùng, phần vượt) trên một
trang, thay vì mở danh mục hay hỏi trợ lý từng câu. Gói chỉ gồm tệp khai báo ([ADR 0022](0022-declarative-packages.md))
nên thành phần dùng chung phải đọc cấu hình của gói ([ADR 0013](0013-component-config-contracts.md)). Một con số
trên bảng điều hành chỉ dùng được khi người xem biết nó tính từ đâu và tự đối chiếu được.

Các lựa chọn đã xét:

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Ai tính con số | Trình duyệt cộng, đếm trên dòng đọc về | Số phụ thuộc vào dòng người xem thấy: cán bộ chỉ thấy cơ sở được phân công sẽ thấy tổng sai; giới hạn số dòng làm tổng thiếu mà không ai biết |
| | Truy vấn `_aggregate` của Hasura | Phải bật `allow_aggregations` trong quyền; tổng vẫn theo dòng người xem thấy; công thức nằm rải trong cấu hình giao diện |
| | View trong migration của gói, mỗi số là một cột | Công thức nằm một chỗ, có chú thích, review như mã; quyền của view quyết định ai thấy số nào |
| Vẽ biểu đồ | Thêm thư viện biểu đồ | Thêm phụ thuộc vào gói giao diện gửi tới người dùng; chỉ cần cột ngang |
| | Thanh vẽ bằng CSS theo biến màu của theme, kèm bảng số liệu | Không thêm thư viện; bảng là bản đọc được cho trình đọc màn hình và để đối chiếu |

## Quyết định

- **Cấu hình riêng** `contracts/dashboard.schema.json`, mục menu `component: dashboard`. Trang gồm các khối; mỗi khối
  có `description` bắt buộc ghi nguồn là gì và số tính thế nào, đúng một nguồn và đúng một cách hiện: `cards` (thẻ
  số) hoặc `chart` (cột ngang, `type: bar`, tối đa bốn cột số chung một thang, `details` là cột chỉ hiện trong bảng).
- **Không tính trên trình duyệt.** Nguồn `graphql` đọc một bảng hay view bằng token của người xem, lọc được theo một
  cột bằng một giá trị. Mọi con số là một cột mà nguồn trả; gói tính sẵn trong view của migration, không dùng
  `_aggregate`. Thẻ số cần đúng một dòng: câu truy vấn xin hai dòng, không dòng thì hiện "Chưa có số liệu", nhiều
  dòng thì báo cấu hình sai thay vì chọn đại một dòng. Biểu đồ xin thừa một dòng so với `limit` (mặc định 50, trần
  200) để báo khi còn dòng chưa hiện.
- **Đối chiếu được.** Mỗi thẻ ghi nhãn, số viết kiểu Việt Nam, đơn vị và "Cách tính". Mỗi khối có mục "Nguồn" mở ra
  được: loại nguồn, bảng, các cột, vai trò đã dùng, nguyên văn câu truy vấn mà client gửi (gồm `__typename` do
  cacheExchange của urql thêm) và biến. Biểu đồ luôn kèm bảng số liệu có chú thích; phần thanh ẩn khỏi trình đọc màn
  hình.
- **Vai trò** như biểu mẫu ([ADR 0030](0030-form-component.md)): `role` của khối, bỏ trống là `user`, luôn gửi kèm
  header `X-Hasura-Role`; token không có vai trò đó thì khối không được truy vấn và không hiện. Truy vấn luôn đọc lại
  từ máy chủ, vì bộ nhớ đệm của urql không phân biệt vai trò.
- **Nguồn `workflow` và `context`** có tên trong schema để gói biết chỗ của chúng, nhưng chưa được hỗ trợ:
  `make check-fast` từ chối, giao diện báo chưa hỗ trợ.
- **Kiểm theo gói lúc `make check-fast`** (`scripts/check-dashboard-config.py`): bảng của nguồn thuộc quyền Hasura
  của gói; vai trò của khối có quyền đọc bảng đó và mọi cột khối nhắc tới (thẻ, trục, cột số, chi tiết, `where`,
  `order_by`); `link.menu` là mục menu khác của gói; không trùng tên khối hay cột số. Thành phần kiểm lại lúc chạy
  mọi tên ghép vào câu GraphQL, vai trò và màu.

## Hệ quả

- Gói có bảng điều hành chỉ bằng khai báo; gói cơ sở vật chất xã có mục "Bảng điều hành": diện tích của xã từ view
  `area_summary`, ba view mới trong migration của gói (số cơ sở theo trạng thái, diện tích theo loại, cơ sở chưa
  được phân công), và tổng hợp của các xã con từ view `area_rollup` cho tỉnh. View có một dòng cho mọi tenant (hay
  mọi cặp tenant và nhóm) để thẻ số luôn có đúng một dòng.
- Số cần thêm thì gói thêm view và quyền trong migration và `hasura/`; thành phần không đổi.
- Số trên trang là số của cả đơn vị theo quyền của view, có thể khác số dòng người xem thấy ở danh mục; khối nên ghi
  điều đó trong `description` hay nhãn của `link`.
- `where.equals` luôn là chữ và check-fast không kiểm nó với kiểu của cột: tệp quyền Hasura không ghi kiểu, cột của
  view không khai kiểu trong migration, nên đoán kiểu sẽ sai với view. Giá trị không hợp kiểu chỉ lộ ra khi mở
  trang; khối đổi lỗi `validation-failed`, `data-exception` của Hasura thành lời báo nêu vai trò, cột của `where` và
  dẫn tới người quản trị. Gói nên chỉ lọc theo cột kiểu chữ.
- Chưa có biểu đồ đường, chuỗi thời gian, chọn kỳ hay lọc cho người xem.
