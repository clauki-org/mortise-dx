<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0029. Tenant cha hoàn thành bước thuộc thẩm quyền của mình trong hồ sơ tenant con; mọi bước khác vẫn 404

- Trạng thái: Chấp nhận
- Ngày: 2026-11-23

## Bối cảnh

Bảng phân cấp ([ADR 0028](0028-step-authority-table.md)) đã có dòng `scope: parent`: khi tenant có cha, nhóm ứng viên
của bước là `<tenant cha>/<vai trò>`. Nhưng workflow-api chỉ liệt kê và cho hoàn thành task cùng tenant với người gọi
([ADR 0004](0004-workflow-access-control.md)), nên task đó không ai nhận. Cần người của tenant cha (tỉnh) thấy và hoàn
thành đúng bước thuộc thẩm quyền của tenant cha trong hồ sơ của tenant con (xã), trong khi:

- **Các bước khác của hồ sơ vẫn chỉ người trong tenant con thấy**, và trạng thái hồ sơ không lộ cho tenant cha.
- **Tenant cùng cha và tenant không phải cha nhận 404**, như với task của tenant khác hiện nay.
- **Token vẫn mang đúng một tenant** ([ADR 0016](0016-parent-tenant-rollup.md)); không cấp cho tỉnh quyền trên dữ liệu
  gốc của xã.
- **Người vận hành đổi `parent_id` thì cha cũ mất quyền ngay**, kể cả với hồ sơ đã lập: nhóm ứng viên ghi lúc lập vẫn
  mang tên cha cũ.

Các cách đã xét:

| Cách | Đánh giá |
|---|---|
| Token của tỉnh mang cả tenant của các xã | ADR 0016 đã loại: tỉnh đọc được mọi dữ liệu gốc của xã |
| Flowable gán task sang tenant cha, hay tạo task con ở tenant cha | Phải có listener hay bước chạy mã trong BPMN của gói ([ADR 0022](0022-declarative-packages.md)); hồ sơ tách làm hai nơi |
| workflow-api tìm task theo nhóm `<tenant của người gọi>/<vai trò>` ở mọi tenant, rồi kiểm tenant của task là con trực tiếp của người gọi lúc này | Không đổi token, BPMN hay Flowable; chỉ bước có nhóm đó lộ ra; quan hệ cha–con đọc lúc gọi |

## Quyết định

Chọn cách cuối.

- **Bảng việc (`GET /v1/workflow/tasks`)** thêm hai truy vấn Flowable không lọc tenant: task chưa ai nhận có
  `candidateGroupIn` là `<tenant của người gọi>/<vai trò>` cho mọi vai trò realm của người gọi, và task đã giao cho
  chính người gọi.
  - Giữ task của tenant khác, của bước đọc bảng phân cấp (hồ sơ có biến `authority_<bước>`). Task đã giao cho chính
    người gọi vẫn hiện, vì người nhận rồi mà lần hoàn thành lỗi thì task nằm ở tên họ; nhóm của nó được kiểm từng
    task. Người nhận lọc ngay ở Flowable, nên task đã giao cho người khác không chiếm chỗ trong trang.
  - Mọi truy vấn task, kể cả của tenant mình, đọc hết các trang (200 task một trang, sắp theo id), tối đa 10 trang;
    chạm trần thì workflow-api ghi cảnh báo vào nhật ký thay vì lặng lẽ bỏ task.
  - Chỉ khi truy vấn trả task mới đọc tenant con trực tiếp của người gọi (`core.tenants.parent_id`, vai trò CSDL
    `workflow_api`), rồi bỏ task không thuộc tenant con. Người không có task nào từ tenant con không phụ thuộc CSDL.
  - Task có thêm trường `tenant` (tenantId của Flowable). Giao diện hiện mã tenant cạnh task của tenant khác. Không
    có tên: quyền Hasura của người gọi chỉ đọc dòng tenant của chính họ, và không nới quyền đó cho việc này.
- **Hoàn thành task của tenant khác** chỉ được xét khi nhóm ứng viên của task là `<tenant người gọi>/<vai trò người
  gọi có>`. Không khớp thì vẫn đi đường cũ và nhận 404, không đọc CSDL. Khớp thì đủ cả ba mới được xét tiếp, thiếu
  một điều là 404:
  - tenant của task là con trực tiếp của người gọi lúc này;
  - hồ sơ có biến `authority_<bước>`, tức bước đọc bảng phân cấp. Bước có nhóm chứa dấu `/` viết sẵn trong BPMN
    không thành việc của tenant cha.
  - Sau đó: luôn cần OTP, không xét vai trò; task đã giao cho người khác thì 403; quy tắc bốn mắt như cũ.
- **Nhóm ghép từ người gọi, không tách từ task.** Vai trò không chứa `/` (CHECK của `core.step_authorities`), nhưng
  mã tenant (`core.tenants.id`) không có ràng buộc nào cấm. Tách nhóm thì `a/b` + `c` và `a` + `b/c` cho cùng một
  chuỗi. Phép so tenant cha lúc gọi phân định trường hợp đó.
- **`GET /v1/workflow/instances/{id}` giữ nguyên:** chỉ tenant của hồ sơ đọc được trạng thái.
- **Tenant cha thấy mọi biến của hồ sơ ở bước được giao**, như người trong tenant con thấy ở bước đó. Biến là thứ
  người quyết định cần đọc; lọc biến theo bước là việc của khai báo bước, không phải của lớp quyền này.
- **Chỉ con trực tiếp**, như ADR 0016: tenant ông không thấy bước của tenant cháu.
- **Demo:** tenant `tinh-khac` không có con, có `manager.k`; quy trình mẫu `core-authority` có dòng `parent` (vượt
  100000, số kiểm thử). Gói `facilities-commune` có dòng `province` cho bước `decide`: phần vượt trên 1000 m², ngưỡng
  minh họa không lấy từ văn bản nào; quản trị tỉnh sửa `above` của từng xã.
- **Đã kiểm:** Flowable 7.2.0 (container riêng, H2, ngày 2026-11-23): nhóm có dấu `/` đặt qua
  `${authority_decide}` cho đúng một liên kết ứng viên. `candidateGroupIn` trong thân JSON nhận dấu `/`, không cần
  `tenantId`. Phân trang bằng `start`, `size` và `sort: id` trả đúng `total`. Liên kết ứng viên còn sau khi nhận.

## Hệ quả

- **Tenant cha có việc mà không có quyền dữ liệu gốc.** Màn hình xử lý hiện biểu mẫu và biến của hồ sơ. Tenant cha
  không mở được bản ghi của tenant con qua Hasura; giao diện chưa có liên kết tới bản ghi (`record` của khai báo bước)
  nên không có nút hỏng.
- **Tenant cha cần khai báo bước của gói**, đọc theo tenant mình (`platform.workflow_steps`). Bộ cài nạp cho mọi
  tenant nên đã có. Tenant cha tạo sau khi cài gói thì thấy task nhưng màn hình báo bước chưa có khai báo, cho tới khi
  chạy lại `make app-install`.
- **Đổi `parent_id` làm mồ côi bước đã gán cho tenant cha.** Nhóm ghi lúc lập hồ sơ mang tên cha cũ: cha cũ mất quyền
  ngay, cha mới không nhận được. Hồ sơ đó cần người vận hành xử lý ở Flowable. `make smoke` kiểm điều này bằng cách đổi
  tạm cha của xã A.
- **OTP chỉ nhập một lần mỗi phiên** ([ADR 0011](0011-approver-mfa.md)): token ghi `otp` suốt phiên, nên workflow-api
  không đòi mã mới cho từng quyết định. Điều này giờ áp cho cả quyết định thay tenant con. Đây là giới hạn đã biết;
  đòi xác thực lại cho từng quyết định là việc sau.
- **Bảng việc của người có vai trò thêm hai truy vấn Flowable không lọc tenant.**
  CSDL lỗi thì người có task từ tenant con nhận 503 ở bảng việc. Người khác không bị ảnh hưởng.
- **Hồ sơ thiếu hay âm biến ngưỡng tới tenant cha**, vì dòng ngưỡng coi như vượt (ADR 0028). Biến ngưỡng do người lập
  gửi thì người lập khai thấp là giữ hồ sơ ở tenant con; giới hạn này đã ghi ở ADR 0028.
