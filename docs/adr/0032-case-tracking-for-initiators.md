<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0032. Người lập theo dõi hồ sơ của mình: route riêng chỉ trả hồ sơ do người gọi lập, không trả trường của bước

- Trạng thái: Chấp nhận
- Ngày: 2026-11-23

## Bối cảnh

Người lập hồ sơ (cán bộ gửi đề nghị cấp vật tư, lập hồ sơ rà soát) chỉ biết hồ sơ đã gửi; muốn biết hồ sơ đang ở
bước nào, ai đang xử lý và kết quả thì phải hỏi người khác hay gọi API bằng tay (#157). API quy trình có
`GET /v1/workflow/instances/{id}`, nhưng route đó trả trạng thái cho mọi người trong tenant
([ADR 0029](0029-parent-completes-delegated-step.md)), không có danh sách, không có bước.

Điều cần giữ:

- Chỉ người lập thấy hồ sơ của mình: người khác cùng tenant, quản trị tenant và tenant cha không thấy.
- Người lập không thấy nội dung người xử lý ghi: ý kiến, quyết định, nơi nhận. Đó là trường của bước
  ([ADR 0031](0031-step-fields.md)).
- Không lộ danh tính người xử lý; chỉ vai trò và đơn vị.
- Lõi không biết nghiệp vụ: tên bước, tên kết quả lấy từ BPMN; tên hồ sơ và nhãn của biến lấy từ khai báo bước của gói.

Hành vi của Flowable 7.2 đã thử ngày 2026-11-23 trên image `flowable/flowable-rest:7.2.0`, chạy riêng với CSDL trong
bộ nhớ, không chung với lõi:

- `POST /query/historic-process-instances` lọc đúng theo `tenantId`, `variables` (`initiator` bằng), `processInstanceId`,
  `processDefinitionKeyIn`, `finished`, sắp theo `startTime`, phân trang, kèm biến (`includeProcessVariables`). Dòng trả
  về không có `processDefinitionKey`; khóa đọc từ `processDefinitionId`.
- `POST /query/tasks` lọc đúng theo `processInstanceVariables` (`initiator` bằng) và `tenantId`. Khóa lọc Flowable không
  biết thì bị bỏ qua im lặng: `processInstanceIdIn` trả mọi task.
- `POST /query/historic-task-instances` theo `processInstanceId` có `taskDefinitionKey`, `name`, `dueDate`, `startTime`,
  `endTime`, `assignee`, `deleteReason`. Bước hoàn thành có `deleteReason` null; bước dừng vì sự kiện biên hết hạn hay
  vì hồ sơ bị xóa có `deleteReason`.
- `POST /query/historic-activity-instances` lọc được theo `activityType`; bước chờ hẹn giờ (`intermediateCatchEvent`)
  có tên và `endTime` null khi đang chờ. `POST /query/executions` lọc theo `processInstanceVariables` cho biết
  `activityId` của nhánh đang chờ hẹn giờ; truy vấn này không sắp theo `id` được (400).
- `GET /history/historic-task-instances/{id}/identitylinks` trả nhóm ứng viên của bước đã xong ở khóa `groupId`
  (runtime dùng `group`).
- Hồ sơ bị xóa có `endTime` nhưng `endActivityId` null.

## Quyết định

- **Route riêng**, không đổi `GET /v1/workflow/instances/{id}`:
  - `GET /v1/workflow/cases?process=..&state=open|ended|all&offset&limit` trả `{total, items}`: hồ sơ do người gọi lập
    trong tenant của họ, mới nhất trước, tối đa 100 mỗi trang.
  - `GET /v1/workflow/cases/{id}` trả một hồ sơ kèm `steps`: bước người làm và bước chờ, theo thời điểm bắt đầu, với
    trạng thái `open`, `done`, `cancelled`.
- **Người lập** là biến `initiator` workflow-api đặt bằng `sub` của token lúc khởi tạo; người dùng không đặt được biến
  này. Không dùng `startUserId`: Flowable ghi tài khoản kỹ thuật ([ADR 0004](0004-workflow-access-control.md)).
- **Kiểm quyền trong một truy vấn**: mã hồ sơ, tenant của người gọi và `initiator` nằm chung một truy vấn lịch sử. Hồ
  sơ không có, của tenant khác hay của người khác đều nhận cùng `404` "Không tìm thấy hồ sơ.". Tài khoản dịch vụ nhận
  `403`. Tham số sai nhận `400` nêu tên tham số.
- **Bước đang chờ của cả trang** lấy từ một truy vấn task theo người lập, không truy vấn theo từng hồ sơ. Chỉ khi một
  hồ sơ còn mở không có task mà BPMN của nó có bước chờ thì hỏi thêm một truy vấn nhánh đang chạy.
- **Biến người lập thấy** là mọi biến trừ biến lõi đặt (`initiator`, `initiatorName`, `tenant`, `idempotencyKey`,
  `authority_*`) và trừ mọi trường của mọi bước trong phiên bản BPMN của hồ sơ, kể cả khi hồ sơ đã kết thúc. BPMN có
  bước người làm mà không khai trường nào (deploy trước ADR 0031) thì không trả biến nào: không biết biến nào là nội
  dung của người xử lý.
- **Tên bước chờ và kết quả** đọc từ BPMN đã deploy (userTask, intermediateCatchEvent, endEvent), cùng lần đọc với
  biến quyết định và trường của bước, nhớ theo mã định nghĩa.
- **Người xử lý** chỉ hiện là nhóm ứng viên (vai trò, hay `<tenant cha>/<vai trò>` với bước của tenant cha) và việc
  đã có người nhận chưa (`claimed`); không trả `sub` hay tên. Nhóm chỉ có ở màn hình một hồ sơ, mỗi bước một lời gọi.
- **Thành phần Tầng 2 `cases`** (`contracts/cases.schema.json`): gói khai `title`, `processes`. Danh sách lọc theo trạng
  thái, màn hình một hồ sơ ở `/apps/<gói>/<mục>/<mã hồ sơ>` ([ADR 0023](0023-package-pages-in-the-web-shell.md)). Tên
  hồ sơ theo `title`, dòng thông tin theo `details` của khai báo bước. Biểu mẫu và nút của danh mục hiện "Xem hồ sơ
  vừa lập" khi gói có mục `cases` cho quy trình đó. `make check-fast` kiểm mỗi quy trình trong `processes` có trong BPMN
  của chính gói.

## Hệ quả

- Người lập theo dõi hồ sơ trọn trên web. Gói `supplies-commune` có mục "Đề nghị đã lập", gói `facilities-commune` có
  mục "Hồ sơ rà soát đã lập" và khai `details` phần vượt cho bước duyệt. Hồ sơ kiểm tra kho lưu trữ không có trang:
  tài khoản dịch vụ mở hồ sơ đó nên không người lập nào thấy nó.
- **Biến không là trường của bước nào vẫn hiện cho người lập**, kể cả khi người làm bước sau gửi kèm nó lúc hoàn thành
  (ADR 0031 chỉ chặn trường của bước). Gói muốn giấu một biến người xử lý ghi thì khai nó làm trường của bước đó.
- Mỗi lần mở danh sách tốn một truy vấn hồ sơ và một truy vấn task (đọc mọi task đang chờ của các hồ sơ còn mở của
  người lập); màn hình một hồ sơ tốn thêm một lời gọi mỗi bước để đọc nhóm.
- Người lập không rút hay sửa được hồ sơ; người khác (quản trị tenant, tenant cha) chưa có màn hình theo dõi hồ sơ
  của người khác. Đó là quyết định riêng nếu cần.
- Hạn của bước chờ hẹn giờ không hiện; chỉ bước người làm có hạn.
