<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0035. Số hồ sơ và số đo thiết bị trên bảng điều hành: workflow-api đếm, chỉ người làm được một bước xem được

- Trạng thái: Chấp nhận
- Ngày: 2026-11-23

## Bối cảnh

Bảng điều hành ([ADR 0033](0033-dashboard-component.md)) chỉ đọc số do gói tính sẵn trong view qua Hasura. Hai loại số
không nằm trong CSDL của gói: số hồ sơ của một quy trình (nằm trong Flowable, sau workflow-api) và số đo thiết bị (nằm
trong Scorpio, sau context-api). ADR 0033 đã đặt chỗ cho hai nguồn `workflow` và `context` trong schema nhưng chưa hỗ
trợ (#158).

Điều cần giữ:

- Số của cả đơn vị không lộ dữ liệu hồ sơ: không biến, không mã hồ sơ, không tên người.
- Tenant luôn lấy từ token, như mọi route của workflow-api.
- Không phải ai trong tenant cũng nên biết đơn vị có bao nhiêu hồ sơ của mọi quy trình; người không làm bước nào của
  quy trình thì không cần số đó.
- Flowable bỏ qua im lặng khóa lọc nó không biết ([ADR 0032](0032-case-tracking-for-initiators.md)); một tổng thì
  không lọc lại được như dòng.

Các lựa chọn đã xét:

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Ai đếm hồ sơ | Trình duyệt đọc danh sách hồ sơ rồi đếm | Không có route nào trả mọi hồ sơ của tenant, và mở route đó là lộ dữ liệu hồ sơ để lấy vài con số |
| | workflow-api trả `total` của truy vấn Flowable | Mỗi số một truy vấn có lọc tenant, quy trình, bước; không dòng nào rời workflow-api |
| Ai được xem | Mọi người trong tenant | Cán bộ biết số hồ sơ của mọi quy trình, kể cả quy trình mình không tham gia |
| | Người có vai trò của một bước | Đúng người cần số; vai trò đọc từ BPMN đã deploy và bảng phân cấp, không thêm cấu hình |
| Việc đang chờ người xem | Route đếm riêng | Thêm route cho số người xem đã có đủ trong `GET /v1/workflow/tasks` |
| | Đếm trên trình duyệt từ danh sách việc | Danh sách là của chính người xem và đủ (tới trần đọc của workflow-api), nên số không phụ thuộc quyền như số tổng hợp ADR 0033 tránh |

Đã chạy thử trên `flowable/flowable-rest:7.2.0` (container riêng, ngày 2026-11-23): hai tenant, hai quy trình có
userTask cùng id, hồ sơ có hạn trong quá khứ và tương lai, hồ sơ đã kết thúc, hồ sơ bị xóa. Với `POST
/query/process-instances`, `/query/historic-process-instances` và `/query/tasks`, các khóa `tenantId`,
`processDefinitionKey`, `finished`, `taskDefinitionKey`, `dueBefore` đều đổi `total` đúng như dữ liệu đã tạo; `size: 0`
vẫn trả `total`; số hồ sơ còn mở của `process-instances` bằng `historic-process-instances` với `finished: false`; hồ sơ
bị xóa tính vào `finished: true`; task không có hạn không khớp `dueBefore`; khóa lạ bị bỏ qua và trả tổng không lọc.

## Quyết định

- **Route `GET /v1/workflow/processes/{key}/counts`** trả `{process, open, finished, overdue, steps: [{step, name,
  open, overdue}], counted_at}`. `open`: hồ sơ còn mở; `finished`: hồ sơ đã kết thúc, kể cả bị dừng; `overdue`: bước
  đang chờ có hạn trước `counted_at` (đếm bước, không đếm hồ sơ); `steps`: các userTask của BPMN mới nhất, tên lấy từ
  BPMN. Mỗi số là `total` của một truy vấn chỉ dùng các khóa đã thử ở trên, kèm `size: 1` để kiểm dòng mẫu đúng tenant,
  quy trình, bước; sai thì 502 chứ không trả số của tenant khác.
- **Ai xem được**: người gọi có ít nhất một vai trò là `candidateGroups` viết thẳng trong một userTask của quy trình,
  hoặc là vai trò của một dòng `scope: tenant` trong `core.step_authorities` của tenant cho quy trình đó (đọc bằng vai
  trò CSDL chỉ đọc của [ADR 0028](0028-step-authority-table.md), chỉ khi vai trò trong BPMN không khớp). Dòng `scope:
  parent` không tính: vai trò đó là của người ở tenant cha. Người khác nhận đúng câu 404 của quy trình không có; tài
  khoản dịch vụ nhận 403.
- **Nguồn `workflow` của bảng điều hành**: `{process, counts: tenant | mine}`. `tenant` đọc route trên; `mine` đọc
  `GET /v1/workflow/tasks` và đếm trên trình duyệt việc của quy trình đó, theo bước, quá hạn là có hạn trước lúc tải;
  khối ghi rõ đó là việc đang chờ người xem. Thẻ số nhắc `open`, `overdue`, `finished` (không có với `mine`); biểu đồ
  mỗi bước một dòng, trục `step`.
- **Nguồn `context`**: `{type, attribute, limit}` đọc `GET /v1/context/entities?type=&attrs=&limit=` bằng token người
  xem (context-api lọc theo tenant), mỗi entity có số đo đó một dòng `{id, value, observedAt}`; entity thiếu số đo
  không thành dòng, không có dòng nào thì khối báo chưa có số đo.
- `role` của khối nguồn REST chỉ quyết định khối có hiện hay không; vai trò không được gửi đi, dịch vụ đọc từ token.
  Mục "Nguồn" ghi đường dẫn đã gửi, cùng chuỗi mà trang dùng để gọi.
- `make check-fast` kiểm `workflow.process` là quy trình trong BPMN của chính gói, `context.type`, `context.attribute`
  là tên, và thẻ, biểu đồ chỉ nhắc giá trị mà nguồn trả; thành phần kiểm lại các luật đó lúc chạy.

## Hệ quả

- Gói hiện số hồ sơ theo bước, việc đang chờ người xem và số đo thiết bị chỉ bằng khai báo; gói cơ sở vật chất xã có
  khối hồ sơ rà soát và hồ sơ kiểm tra kho do luật ngưỡng mở cho lãnh đạo xã, việc đang chờ người xem, độ ẩm thiết bị.
- Số hồ sơ do luật ngưỡng mở là số hồ sơ, không phải số lần đo vượt ngưỡng: iot-bridge không mở hồ sơ khi lần vượt
  chưa đủ lâu hay hồ sơ cũ còn mở ([ADR 0018](0018-threshold-rules-in-bridge.md)).
- Mỗi lần mở khối là `3 + 2 × số bước` truy vấn Flowable; chưa đo thời gian trên dữ liệu lớn.
- `open` có thể lớn hơn tổng theo bước: hồ sơ ở bước chờ, hay ở bước chỉ có trong phiên bản BPMN cũ.
- Việc đang chờ người xem bị giới hạn bởi trần đọc của `GET /v1/workflow/tasks`; quá trần thì workflow-api ghi cảnh
  báo và số thiếu.
- Chưa làm: tenant cha xem số hồ sơ của tenant con, lọc theo kỳ, lịch sử số đo trên bảng điều hành.
