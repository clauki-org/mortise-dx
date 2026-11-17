<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0013. Thành phần Tầng 2 chỉ biết cấu hình của nó; schema cấu hình và bản mô tả nằm trong contracts/

- Trạng thái: Chấp nhận
- Ngày: 2026-11-17

## Bối cảnh

Thành phần Tầng 2 là một khối giao diện kèm logic, tự nó không hiển thị gì: gói đưa cấu hình vào thì nó hiện theo
cấu hình đó, không có màn hình viết riêng cho từng bảng ([ADR 0003](0003-three-tier-layout.md),
[ADR 0006](0006-frontend-stack.md)). Thành phần danh mục là thành phần đầu tiên đọc một tệp cấu hình do gói viết.
Ba việc chưa được quyết định:

- Schema của tệp cấu hình nằm ở đâu. ADR 0006 ghi nó nằm cạnh mã của thành phần (`platform/components/<tên>/`);
  [ADR 0008](0008-shared-api-contracts.md) để việc này lại cho lúc viết thành phần. Thực tế mã của các thành phần
  đang nằm trong `platform/web/src/`, và khai báo bước của bảng việc đã nằm ở `contracts/workflow.schema.json`.
- Thành phần được biết những gì ngoài cấu hình của nó: menu, trang chứa nó, các thành phần khác.
- Người viết gói biết thành phần làm được gì bằng cách nào. Schema nói tệp cấu hình có dạng gì, không nói thành phần
  có sửa được dữ liệu không hay có đếm được tổng số dòng không.

Cách khai quan hệ cha–con đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Đối tượng con trỏ tới một mục `menu` khác của gói | Thành phần phải đọc menu; mỗi bảng con buộc thành một mục menu. Đã làm thử và bỏ |
| Dựa vào quan hệ khai trong Hasura | `scripts/hasura-metadata.py` chưa quản lý quan hệ; gói chưa khai được |
| Đối tượng con khai lồng trong cấu hình của đối tượng cha | Một tệp mô tả cả cây; thành phần không cần gì ngoài tệp đó |

## Quyết định

**Thành phần chỉ biết cấu hình của nó.** Nơi gọi đưa cho thành phần cấu hình và địa chỉ gốc của trang chứa nó.
Thành phần không đọc menu, không tự tìm cấu hình, không biết nó nằm ở trang nào. Nó hiện ở đâu và mở bằng cách nào
là việc của nơi gọi.

**Schema cấu hình là hợp đồng.** Schema của tệp cấu hình mà gói viết cho một thành phần nằm ở
`contracts/<tên>.schema.json`, có ví dụ hợp lệ và ví dụ sai, và được kiểm như mọi hợp đồng khác theo ADR 0008. Quyết
định này thay câu "schema cấu hình nằm cạnh mã của nó" trong ADR 0006. `make check-fast` kiểm thêm tệp cấu hình của
mọi mục `menu` có `component: catalog` trong `apps/*/app.yaml`.

**Cấu hình danh mục** (`contracts/catalog.schema.json`):

- Một tệp mô tả một loại đối tượng: bảng đọc, trường, cột của danh sách, ô tìm, ô lọc, thứ tự, cỡ trang.
- Loại đối tượng con khai lồng trong `detail.children` của đối tượng cha, cùng dạng với cha, thêm tên ngắn và cột
  chứa khóa của cha. Con lại có thể có con.
- Mọi thứ có thứ tự là mảng (`fields`, `choices`, `list.columns`), không phải bảng tra theo khóa: cấu hình có thể
  được lưu trong cột `jsonb`, mà `jsonb` không giữ thứ tự khóa.
- Mọi tên được ghép vào câu truy vấn (`source`, `key`, tên trường, `via`) phải là tên GraphQL. Thành phần kiểm lại
  luật này lúc chạy, vì cấu hình là dữ liệu chứ không phải mã. Chữ người dùng gõ chỉ đi qua biến của câu truy vấn.
- Đường dẫn bên dưới địa chỉ gốc có dạng `<khóa>/<con>/<khóa>/...`. Màn hình chi tiết đọc mọi chặng trong một câu
  truy vấn, mỗi chặng phải thuộc đúng dòng ở chặng trước; một chặng không khớp thì báo không tìm thấy.
- Luật so nhiều trường với nhau (cột trỏ tới trường chưa khai, ô lọc trên trường không có `choices`) không viết được
  trong schema. Thành phần kiểm khi hiển thị và hiện lý do; bộ cài gói kiểm khi cài (kế hoạch, theo ADR 0008).
- Cấu hình không khai quyền. Người dùng thấy dòng nào do quyền Hasura của bảng quyết định.

**Bản mô tả của thành phần.** Mỗi thành phần có tệp `contracts/<tên>.component.yaml` theo
`contracts/component.schema.json`: một câu tóm tắt, schema cấu hình, ví dụ, danh sách việc làm được và danh sách giới
hạn. Tệp chỉ ghi điều đã chạy thật và được sửa trong cùng pull request với thay đổi hành vi của thành phần.
`make check-fast` kiểm tệp theo schema, tên tệp khớp tên thành phần, và schema cùng ví dụ mà tệp trỏ tới có tồn tại.

Đã kiểm ngày 2026-11-17 trên bản cài ở máy phát triển, qua cổng và với Content-Security-Policy của nginx, bằng một
trang thử gọi thành phần với năm tệp cấu hình đọc từ các bảng thử của bốn lĩnh vực (động vật học, hạ tầng máy chủ,
thư viện, cơ sở vật chất):

- cùng một thành phần hiển thị cả năm mà không sửa mã: cây ba cấp, cây hai cấp, một bảng phẳng với cấu hình tối
  thiểu; khóa là chữ có dấu `/` và khoảng trắng, khóa là số, khóa là uuid; cột ngày, số lẻ, đúng/sai;
- sửa tay đường dẫn để gắn một dòng vào đối tượng cha hay cấp trên nữa không chứa nó thì thành phần báo không tìm
  thấy;
- lượt thử lộ ra hai lỗi đã sửa: năm hiện hai chữ số, và dòng chưa có giá trị đứng đầu khi xếp giảm dần;
- phép đếm (`<bảng>_aggregate`) không có cho vai trò `user` khi quyền đọc không bật `allow_aggregations`, nên phân
  trang xin thừa một dòng thay vì đếm;
- `scripts/contracts.sh check` báo lỗi khi bỏ trần `page_size` khỏi schema, khi bản mô tả trỏ tới tệp không có, và
  khi tên thành phần trong bản mô tả lệch tên tệp.

Trang thử và các bảng thử không nằm trong repo.

## Hệ quả

- Thêm một thành phần Tầng 2 thì thêm `contracts/<tên>.schema.json`, ví dụ, ví dụ sai và
  `contracts/<tên>.component.yaml` trong cùng pull request với mã của nó.
- Đổi cột, nhãn, ô lọc hay thêm một cấp đối tượng con là sửa tệp cấu hình, không sửa mã.
- Chưa có trang nào gọi thành phần danh mục. Việc đưa cấu hình của gói tới giao diện và chọn chỗ mở thành phần thuộc
  về bước ráp gói vào khung giao diện, quyết định khi làm bước đó.
- Thành phần phải chịu được cấu hình sai: báo lý do trên màn hình thay vì gửi câu truy vấn hỏng.
- Giới hạn hiện tại của thành phần danh mục ghi trong `contracts/catalog.component.yaml`: chỉ đọc, mỗi danh sách một
  bảng, không hiện tổng số dòng, quan hệ cha–con theo một cột.
- Mã của thành phần ở trong `platform/web/src/` cho tới khi có lý do tách thành `platform/components/<tên>/`.
