<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0025. Người lập không đặt sẵn được biến quyết định: workflow-api đọc tên từ BPMN đã deploy

- Trạng thái: Chấp nhận
- Ngày: 2026-11-22

## Bối cảnh

workflow-api ([ADR 0004](0004-workflow-access-control.md)) chuyển sang Flowable mọi biến client gửi khi khởi tạo
quy trình, chỉ chặn các biến lõi tự đặt (`initiator`, `initiatorName`, `tenant`, `idempotencyKey`). Cổng rẽ nhánh
sau bước duyệt đọc một biến do người duyệt gửi khi hoàn thành bước, ví dụ `approved` của quy trình mẫu
`core-approval`. Người lập gửi sẵn `approved: true` lúc khởi tạo, người duyệt hoàn thành bước mà không gửi `approved`,
thì cổng đọc giá trị của người lập: hồ sơ thành đã duyệt dù người duyệt không chọn gì (#145).

Gói `facilities-commune` chặn riêng bằng một `taskListener` xóa `approved` khi bước duyệt bắt đầu. Gói chỉ gồm tệp
khai báo không dùng được listener ([ADR 0022](0022-declarative-packages.md)), nên cách chặn phải nằm ở lõi và không
cần gói viết gì thêm.

Lõi phải biết biến nào là quyết định của một bước mà không đọc bảng của Tầng 2 (khai báo bước nằm ở
`platform.workflow_steps`). Các cách đã xét:

| Cách | Đánh giá |
|---|---|
| Quy ước tên: biến quyết định có tiền tố riêng, workflow-api chặn tiền tố đó lúc khởi tạo | Phải đổi tên `approved` ở mọi BPMN, khai báo bước, bài kiểm và gói đang mở; gói đặt tên sai quy ước thì không được bảo vệ, trừ khi thêm bước kiểm BPMN |
| workflow-api xóa hay ghi đè biến quyết định khi hoàn thành bước | Vẫn phải biết tên biến của từng bước; cần thêm một nguồn khai báo cho lõi |
| Mỗi quy trình khai danh sách biến được gửi lúc khởi tạo (mặc định từ chối) | An toàn nhất, nhưng mọi quy trình, gói và luật ngưỡng đang chạy phải khai lại; quá rộng cho lỗi này |
| workflow-api đọc BPMN đã deploy qua REST của Flowable, lấy tên trong điều kiện rẽ nhánh sau bước người làm | Không đổi gói nào; tên lấy từ chính định nghĩa Flowable sắp chạy; không đọc CSDL |

## Quyết định

Chọn cách cuối.

- **Biến quyết định** của một quy trình là mọi tên xuất hiện trong `conditionExpression` của một `sequenceFlow` đi
  được tới từ một `userTask`, đi qua bất kỳ nút nào. Sự kiện biên gắn vào một nút được tính là chạy sau nút đó. Đi
  vào một sub-process (`subProcess`, `transaction`, `adHocSubProcess`) thì chạy từ `startEvent` bên trong nó; luồng
  ra của sub-process được tính là chạy sau các nút bên trong nó, nhưng ra khỏi nó không chạy lại từ đầu, nên cổng
  đứng trước bước đầu tiên trong sub-process vẫn là dữ liệu người lập.
- **Tên lấy thừa, không lấy thiếu:** mọi từ có dạng tên biến trong điều kiện đều được lấy, kể cả trong chuỗi, nên
  `${approved}`, `${approved == true}` và `${execution.getVariable("approved")}` đều cho ra `approved`. Lấy thừa chỉ
  làm người lập không đặt được biến tên `execution` hay `true`; lấy thiếu thì người lập đặt sẵn được quyết định. Tên
  có dấu như `đãDuyệt` hợp lệ trong biểu thức của Flowable nên cũng được lấy nguyên.
- **Khi khởi tạo,** workflow-api hỏi Flowable phiên bản mới nhất của quy trình trong tenant của người gọi, đọc BPMN
  của phiên bản đó (`/repository/process-definitions/{id}/resourcedata`) và trả `400` nếu biến gửi lên trùng một
  biến quyết định. Kết quả nhớ theo mã định nghĩa, vì định nghĩa đã deploy không đổi; không nhớ theo khóa quy trình,
  vì deploy phiên bản mới giữ khóa mà đổi biến quyết định.
- **Không đọc được BPMN thì từ chối khởi tạo** (`502`), không cho qua.
- **Hoàn thành bước không đổi:** người xử lý bước vẫn gửi biến quyết định như trước.
- Listener xóa `approved` của quy trình rà soát trong `facilities-commune` được bỏ. Hai bước duyệt của quy trình đó
  không có bước người làm nào đứng trước, nên chỉ người lập mới đặt được `approved` trước khi bước duyệt bắt đầu, và
  lõi đã chặn người lập.

## Hệ quả

- `core-approval` và quy trình của mọi gói được bảo vệ mà không phải sửa gói. Bài kiểm của lõi và của gói xã kiểm
  khởi tạo kèm `approved` nhận `400`.
- **Cổng sau bước người làm không đọc được dữ liệu người lập gửi.** Ví dụ duyệt xong rồi rẽ theo số tiền người lập
  khai: `amount` thành biến quyết định và người lập không gửi được nó lúc khởi tạo. Cách đó vốn không an toàn, vì
  người hoàn thành bước gửi được mọi biến và ghi đè được số tiền; rẽ nhánh theo dữ liệu người lập phải đặt trước bước
  đầu tiên, như quy trình rà soát của gói xã đã làm.
- Quy trình có vòng lặp quay về cổng đứng trước bước đầu tiên làm biến của cổng đó thành biến quyết định. Chưa quy
  trình nào có hình này; khi có thì xét lại quy tắc.
- **Chưa chặn giữa hai bước:** người hoàn thành một bước vẫn đặt sẵn được biến quyết định của một bước sau, vì
  workflow-api cho người hoàn thành bước gửi mọi biến. Chưa quy trình nào có hai bước duyệt nối tiếp do hai người khác
  nhau; khi có cần quyết định riêng.
- Chỉ xét điều kiện trên `sequenceFlow`. Sự kiện điều kiện (`conditionalEventDefinition`) và quy trình con gọi bằng
  `callActivity` chưa được xét.
- Mỗi lần khởi tạo tốn thêm một lời gọi tới Flowable để tìm phiên bản mới nhất; BPMN chỉ đọc một lần cho mỗi phiên
  bản. Quy trình được khởi tạo theo khóa như trước, nên phiên bản mới deploy đúng giữa lúc kiểm và lúc khởi tạo sẽ
  chạy mà chưa được kiểm.
