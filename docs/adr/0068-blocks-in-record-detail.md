<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0068. Khối trong chi tiết một dòng của danh mục, lọc theo dòng đang xem, và liên kết chung tới chi tiết dòng

- Trạng thái: Chấp nhận
- Ngày: 2026-11-28

## Bối cảnh

Trang gồm khối ([ADR 0061](0061-block-composition.md)) đặt được nhiều thành phần trên một trang, nhưng màn hình chi
tiết một dòng của danh mục chỉ có trường, bảng con, nút và tài liệu. Một tổ chức muốn thấy, ngay trong chi tiết một cơ
sở, vị trí của cơ sở đó trên bản đồ và các hồ sơ đã lập cho nó, thì phải mở mục khác và tự tìm. Theo chiều ngược lại,
một chấm trên bản đồ hay một dòng của bảng điều hành không dẫn tới dòng của danh mục.

Các lựa chọn đã xét:

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Khối khai ở đâu | Danh sách khối trong cấu hình của danh mục (`detail.blocks`), mỗi khối trỏ tới một mục của gói | Chọn: cùng dạng với khối của trang, đi qua cùng mục, bước kiểm và quyền đọc; mỗi cấp cha–con có khối riêng |
| | Mục của gói tự khai nó hiện trong chi tiết của danh mục nào | Một mục hiện ở nhiều nơi thì phải biết hết các nơi đó; thứ tự khối trong một chi tiết không nằm ở một chỗ |
| Lọc theo dòng | Gói khai `attach: {source, column}` cho từng khối | Chọn: rõ cột nào mang khóa, kiểm được với quyền Hasura; cùng một mục đặt ở chi tiết khác gắn theo cột khác |
| | Thành phần tự đoán cột nối (tên bảng + `_id`) | Đoán sai thì lặng lẽ hiện mọi dòng hay không dòng nào |
| Ai thêm điều kiện | Ngữ cảnh khối mang dòng đang xem và attach; thành phần hỏi điều kiện cho nguồn của mình | Chọn: thành phần không đọc attach, không biết danh mục; thiếu ngữ cảnh thì chạy như đứng riêng |
| Hồ sơ của một dòng | Lọc trên trình duyệt sau khi tải một trang hồ sơ | Tổng số và phân trang sai |
| | workflow-api lọc theo một biến của quy trình | Chọn: Flowable lọc, tổng và trang đúng; chỉ nhận biến người lập được thấy |

## Quyết định

**Khối trong chi tiết.** Cấu hình danh mục có `detail.blocks: [{item, variant, attach}]` ở mọi cấp cha–con
(contracts/catalog.schema.json). Mỗi khối là một mục menu hay khối của chính gói, vẽ bằng `Block.tsx` như trên trang
(ranh giới lỗi riêng, tiêu đề thành h2), dưới lưới trường, trên bảng đối tượng con. Mục dành cho vai trò khác không có
trong menu của người xem nên khối của nó không hiện.

**Ngữ cảnh và điều kiện.** Khối trong chi tiết nhận qua React context (`platform/web/src/blockContext.ts`) dòng đang
xem `{app, item, source, key, id, row}` (mục danh mục, bảng, cột khóa, giá trị khóa, các trường đã đọc) và attach của
gói. `recordWhere(block, source)` trả `{column: {_eq: id}}` khi có dòng, có attach và `attach.source` đúng nguồn được
hỏi; còn lại trả rỗng và thành phần chạy như đứng riêng. Điều kiện cộng vào điều kiện sẵn có bằng `_and`, không thay:

- danh mục: danh sách trong khối, `attach.source` là bảng của danh mục;
- bản đồ: mỗi lớp đọc `attach.source`; lớp đọc bảng khác chạy như đứng riêng;
- bảng điều hành: mỗi khối nguồn graphql đọc `attach.source`; điều kiện nằm trong biến gửi đi nên "Xem cách tính" hiện
  đúng nó; khối nguồn khác chạy như đứng riêng;
- theo dõi hồ sơ: `attach.source` là một quy trình của `processes`, `attach.column` là tên biến;
  `GET /v1/workflow/cases` nhận `variable_name`, `variable_value` (cần `process`). workflow-api từ chối biến lõi đặt,
  biến bắt đầu bằng `authority_` và trường của bước theo phiên bản mới nhất của quy trình, vì số hồ sơ khớp sẽ cho người
  lập đoán giá trị họ không được xem.

**Bước kiểm.** `scripts/check-record-blocks.py` (gọi từ `make check-fast` cho mọi gói và cho ví dụ của hợp đồng) chặn
item không có hay là một trang, kiểu không có trong schema của thành phần, attach ở thành phần không lọc được,
`attach.source` không phải nguồn của khối, và `attach.column` mà vai trò đọc nguồn đó (user với danh mục, role của lớp
hay khối) không đọc được trong quyền Hasura của gói, hay với theo dõi hồ sơ là biến lõi đặt hoặc trường của bước theo
BPMN của gói; với liên kết, `record.item` không phải mục danh mục và cột khóa
không đọc được.

**Liên kết chung tới chi tiết dòng.** `recordPath(app, item, key)` và `rowPath(listPath, key)` trong `menu.ts` dựng
địa chỉ chi tiết dòng, mã hóa khóa; danh mục dùng chung hàm này. Lớp bản đồ khai `record: {item, column}` thì tên điểm
trong danh sách điểm và dòng "Điểm đang chọn" dưới khung bản đồ là liên kết; bấm chấm trên khung vẫn chỉ chọn điểm.
Biểu đồ nguồn graphql khai `chart.record` thì tên nhóm ở bảng số liệu là liên kết. `record.item` là một mục danh mục
của gói; liên kết chỉ tới dòng ngoài cùng, vì dòng con cần khóa của mọi cấp cha.

## Hệ quả

- Gói `facilities-commune`: chi tiết cơ sở có khối "Vị trí cơ sở" (bản đồ một lớp, chỉ cơ sở đang xem) và hồ sơ rà soát
  mà người xem đã lập cho cơ sở đó; tên trụ sở trên bản đồ dẫn tới chi tiết cơ sở. Bản đồ khai riêng một lớp để điều
  kiện áp lên mọi điểm của khối.
- Bài kiểm tổ hợp (`blocks.test.tsx`) thêm vị trí "trong chi tiết dòng", có và không có attach, cùng chi tiết dòng của
  danh mục thật với khối gói khai; với danh mục, bản đồ, bảng điều hành có attach, bài đòi điều kiện của dòng có trong
  biến đã gửi. 1264 bài của `blocks.test.tsx` khi chạy ngày 2026-11-28. Theo dõi hồ sơ đọc REST nên điều kiện của nó kiểm ở `cases.test.ts`
  và kiểm thử của workflow-api.
- workflow-api gửi điều kiện biến cho Flowable với kiểu chuỗi; biến lưu dạng số chưa kiểm là có khớp hay không, nên gói
  gắn theo biến chuỗi (khóa uuid hay mã). Lọc theo biến đọc trường của bước từ phiên bản mới nhất; hồ sơ lập trên phiên bản cũ có trường khác vẫn lọc được theo
  tên đó. Danh mục trong khối chưa có nút thêm dòng gắn sẵn khóa của dòng đang xem.
