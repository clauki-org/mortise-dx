<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0030. Thành phần biểu mẫu: cấu hình riêng dịch sang rjsf, hai đích gửi, kiểm theo gói lúc check-fast

- Trạng thái: Chấp nhận
- Ngày: 2026-11-22

## Bối cảnh

Người dùng cần lập hồ sơ hay thêm một dòng mà không có dòng danh mục nào để bấm nút
([ADR 0026](0026-start-process-from-catalog-row.md)), ví dụ đề nghị cấp vật tư. Trước quyết định này, việc đó chỉ
làm được bằng cách gọi thẳng API. Gói chỉ gồm tệp khai báo ([ADR 0022](0022-declarative-packages.md)) nên không tự
viết được màn hình; thành phần dùng chung phải đọc cấu hình của gói ([ADR 0013](0013-component-config-contracts.md)).

Các lựa chọn đã xét:

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Gói khai trường thế nào | JSON Schema và uiSchema của rjsf nguyên văn | uiSchema có tùy chọn hiện chữ dạng HTML và chọn ô nhập tùy ý; tên trường không được kiểm với quy trình hay bảng |
| | Cấu hình riêng gồm ít khóa, thành phần dịch sang JSON Schema và uiSchema | Chỉ những gì thành phần hỗ trợ; check-fast kiểm được từng tên |
| Mã Idempotency-Key | Một mã cho mỗi lần mở trang | Gửi lỗi, sửa dữ liệu rồi gửi lại thì workflow-api trả hồ sơ cũ, nội dung mới mất |
| | Mã đổi khi dữ liệu gửi khác dữ liệu lần trước dùng mã đó | Bấm đúp, gửi lại cùng dữ liệu chỉ một hồ sơ; dữ liệu khác là hồ sơ khác |
| Thêm dòng | Qua một quy trình của lõi | Thêm một vòng qua Flowable cho việc không cần duyệt |
| | Mutation GraphQL bằng token người dùng | Hasura đã lọc theo tenant và vai trò; không có Idempotency-Key |

## Quyết định

- **Cấu hình riêng** `contracts/form.schema.json`, mục menu `component: form`. Trường có tên, nhãn, kiểu (string,
  number, integer, boolean, date, choice), bắt buộc, giới hạn theo kiểu. Trường choice lấy mục từ `choices` cố định
  hoặc từ một bảng của gói (`source`), lọc được theo một trường đứng trước; đổi trường đó thì trường con bị xóa. Tên
  trường không trùng biến dành riêng của lõi và không bắt đầu bằng `authority_`, tiền tố lõi dành riêng cho biến chọn
  nhóm xử lý của bước theo bảng phân cấp thẩm quyền. Thành phần dựng JSON Schema, uiSchema từ các khóa đã biết, vẽ
  bằng rjsf với bộ kiểm `formValidator` như bảng việc ([ADR 0006](0006-frontend-stack.md)); không có đường truyền
  uiSchema của gói.
- **Hai đích gửi, đúng một.** `submit.process` khởi tạo quy trình của gói với biến là các trường đã điền, trường
  trống không gửi. Mã Idempotency-Key mới khi mở trang và sau mỗi lần gửi được; trước mỗi lần gửi, dữ liệu được so
  với dữ liệu lần cuối dùng mã đó, khác thì lấy mã mới. `submit.insert` thêm một dòng bằng
  `insert_<bảng>(objects: [$object])`, tên trường là tên cột; `tenant_id` do quyền thêm dòng của gói đặt từ token
  (`set`), trình duyệt không gửi. Nút bị khóa khi đang gửi; lỗi ràng buộc và quyền của Hasura được báo bằng tiếng
  Việt kèm cách sửa. Thiếu cột bắt buộc mà biểu mẫu không có ô thì người gửi không tự sửa được, nên lời báo nêu tên
  cột và dẫn tới người quản trị.
- **Vai trò.** `role` được gửi kèm header `X-Hasura-Role` với danh sách chọn và lệnh thêm dòng, như lớp của bản đồ
  ([ADR 0024](0024-map-component.md)). Không khai thì header vẫn gửi `user`, vai trò check-fast kiểm; bỏ header thì
  Hasura dùng vai trò mặc định của token, có thể khác vai trò đã kiểm. Token không có vai trò đó thì biểu mẫu không
  hiện. Biểu mẫu khai `role` khác `user` thì mục menu phải khai `roles: [<role>]`, để người không dùng được biểu mẫu
  không thấy mục.
- **Kiểm theo gói lúc `make check-fast`** (`scripts/check-form-config.py`): quy trình có trong BPMN của gói; không
  trường nào là biến quyết định ([ADR 0025](0025-decision-variables.md), dùng chung hàm của workflow-api) hay trùng
  biến mà một bước của quy trình ghi (trường biểu mẫu, biến của nút), vì bảng việc sẽ hiện giá trị người lập điền
  dưới nhãn của người xử lý; bước lấy tên hồ sơ từ một biến mà không bước nào ghi thì biểu mẫu phải có trường đó;
  bảng, cột của lệnh thêm dòng và của danh sách chọn có trong quyền Hasura của gói cho vai trò đó, không trường nào
  là `tenant_id`, cột thuộc `set` hay cột mà `check` so với tenant của token; `done.menu` là mục menu của gói. Thành
  phần kiểm lại lúc chạy mọi tên nó ghép vào câu GraphQL.
- **Người xử lý thấy giá trị đã điền.** Khai báo bước có thêm `details: [{variable, label}]`
  (`contracts/workflow.schema.json`); màn hình xử lý hiện các biến đó chỉ đọc trong thông tin hồ sơ.

## Hệ quả

- Gói lập hồ sơ và thêm dòng từ menu chỉ bằng khai báo; gói kho vật tư có hai biểu mẫu. Bản mô tả
  `contracts/form.component.yaml` ghi năng lực và giới hạn.
- Thêm dòng không có Idempotency-Key: mất phản hồi rồi gửi lại có thể báo trùng mã dù dòng đã có. Lời báo nhắc xem
  lại danh sách trước khi gửi lần nữa.
- Ràng buộc NOT NULL và CHECK của bảng không được check-fast kiểm vì quyền Hasura không mang thông tin đó; cột bắt
  buộc mà biểu mẫu thiếu chỉ lộ ra khi gửi, thành lời báo nêu tên cột.
- Giá trị lấy từ danh sách chọn luôn là chữ; cột đích kiểu số nguyên của Hasura không nhận được.
- Như ADR 0026, giá trị do trình duyệt gửi; người gọi thẳng API vẫn gửi được giá trị khác, người duyệt đối chiếu
  với dữ liệu.
