<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0026. Nút của danh mục khởi tạo quy trình của gói, biến lấy từ dòng đang xem

- Trạng thái: Chấp nhận
- Ngày: 2026-11-21

## Bối cảnh

Người dùng cần lập hồ sơ cho đúng một dòng của danh mục, ví dụ một cơ sở. Họ không có công cụ kỹ thuật để gọi
`POST /v1/workflow/processes/{key}/instances`. Theo [ADR 0013](0013-component-config-contracts.md), thành phần danh
mục chỉ đọc và chỉ biết cấu hình của nó. Gói lại không được viết giao diện riêng khi thành phần dùng chung làm được
([ADR 0022](0022-declarative-packages.md)).

Biến của hồ sơ có thể nằm ngoài bảng của danh mục. Ví dụ, số tổng của cả đơn vị nằm trong một view, nối với bảng qua
quan hệ một-một mà Hasura khai. Trước quyết định này, danh mục không đọc được cột của bảng khác.

Cách chọn Idempotency-Key đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Không gửi mã | Bấm đúp hay gửi lại sau lỗi mạng sinh hai hồ sơ |
| Mã suy từ khóa của dòng | Với người dùng, workflow-api trả lại cả quy trình đã kết thúc. Hồ sơ đã bị trả lại thì không lập lại được cho dòng đó, và người thứ hai vẫn lập trùng được |
| Mã ngẫu nhiên cho mỗi lần mở hộp xác nhận | Bấm đúp và gửi lại trong cùng hộp chỉ tạo một quy trình; lần mở sau là một hồ sơ mới |

## Quyết định

- **Nút khai trong cấu hình danh mục.** Mỗi mục trong `detail.actions` (`contracts/catalog.schema.json`) có tên ngắn,
  nhãn, khóa quy trình và `variables`. `variables` ánh xạ tên biến của quy trình tới khóa hay một trường đã khai của
  dòng. Mọi cấp cha–con đều khai được nút. Tên biến theo cùng luật với `contracts/workflow.schema.json`, không trùng
  biến dành riêng của lõi.
- **Chỉ quy trình của cùng gói.** `make check-fast` (`scripts/check-catalog-actions.py`) kiểm hai điều. Khóa quy
  trình phải có trong BPMN của gói chứa tệp cấu hình. Mỗi biến phải lấy từ khóa hay trường đã khai. Thành phần kiểm
  lại luật thứ hai lúc chạy.
- **Trường qua quan hệ.** `fields[].name` nhận thêm dạng `<quan hệ>.<cột>`, đúng một cấp, theo quan hệ một-một mà
  Hasura khai. Trường này chỉ hiện ở màn hình chi tiết và làm nguồn biến. Danh sách, ô tìm, ô lọc, thứ tự và tiêu đề
  vẫn chỉ nhận cột của chính bảng. Quyền đọc vẫn do Hasura quyết định ở bảng đích của quan hệ.
- **Người bấm thấy trước điều sẽ gửi.** Hộp xác nhận hiện nhãn và giá trị của các trường làm nguồn biến; khóa là mã
  kỹ thuật nên không hiện. Trường còn trống thì không cho gửi, để hồ sơ không thiếu thông tin hay đi nhánh mặc định
  của BPMN. Giá trị gửi đi giữ kiểu mà Hasura trả, nên số vẫn là số và cổng rẽ nhánh so sánh được.
- **Idempotency-Key ngẫu nhiên cho mỗi lần mở hộp**, như bảng trên. Mã suy từ khóa không chặn được hai hồ sơ cùng mở
  cho một dòng. Muốn chặn thì workflow-api phải tìm được quy trình theo biến, đó là việc của lõi và nằm ngoài quyết
  định này.
- **Quyền.** Nút hiện cho mọi người đọc được dòng. Ai được khởi tạo, và tenant nào, do workflow-api quyết định theo
  token. Cấu hình không khai vai trò, như phần còn lại của cấu hình danh mục.

## Hệ quả

- Gói lập hồ sơ từ danh mục chỉ bằng khai báo. Thành phần danh mục có một việc ghi: khởi tạo quy trình. Bản mô tả
  `contracts/catalog.component.yaml` ghi điều này trong năng lực và giới hạn.
- Giá trị của biến do trình duyệt đọc lúc bấm. Người cố tình gọi thẳng API vẫn gửi được giá trị khác, nên người
  duyệt phải đối chiếu với dữ liệu. Muốn quy trình tự đọc số ở phía máy chủ thì cần một quyết định khác.
- Danh mục chưa hiện hồ sơ đã lập cho một dòng. Bảng việc chưa có nút mở lại dòng từ một việc, dù khai báo bước đã
  có `record`; đó là việc sau.
