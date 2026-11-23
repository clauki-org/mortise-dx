<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0031. Trường của một bước chỉ do người làm bước đó ghi: userTask khai trường bằng `flowable:formProperty`

- Trạng thái: Chấp nhận
- Ngày: 2026-11-23

## Bối cảnh

workflow-api chuyển sang Flowable mọi biến client gửi khi khởi tạo hay hoàn thành một bước, trừ biến lõi đặt.
[ADR 0025](0025-decision-variables.md) chỉ chặn người lập đặt sẵn biến mà cổng rẽ nhánh sau một bước người làm đọc.
Biến không cổng nào đọc thì vẫn gửi sẵn được. Ví dụ là `decision` của bước quyết định trong quy trình rà soát của gói
`facilities-commune` (#153). Người lập, người duyệt hay người trình gửi sẵn nội dung quyết định. Người có thẩm quyền
hoàn thành bước qua API mà không gửi `decision` thì nội dung người khác đặt thành quyết định trên hồ sơ, và màn hình
xử lý còn hiện sẵn nó (#154). `comment` của bước duyệt cũng vậy.

Bảng việc biết trường của mỗi bước từ khai báo bước (`contracts/workflow.schema.json`: `form.properties` và
`variables` của nút), nhưng khai báo đó nằm ở bảng `platform.workflow_steps` của Tầng 2. Lõi không đọc bảng của Tầng
2 (ADR 0025), và workflow-api không đọc CSDL để biết điều có sẵn trong BPMN
([ADR 0028](0028-step-authority-table.md)). Gói chỉ gồm tệp khai báo không dùng được listener
([ADR 0022](0022-declarative-packages.md)), nên cách chặn phải nằm ở lõi.

Các cách đã xét:

| Cách | Đánh giá |
|---|---|
| workflow-api đọc `platform.workflow_steps` | Lõi phụ thuộc lược đồ của Tầng 2; gỡ hay đổi khai báo bước là đổi luật của lõi mà định nghĩa quy trình không đổi |
| Quy ước tên: trường của bước `x` mang tiền tố `x_` | Phải đổi tên biến ở mọi BPMN, khai báo bước, bài kiểm và dữ liệu đã có; bước dùng chung một trường (`comment` của bước duyệt và bước trình) phải đổi tên |
| Chỉ cho gửi biến đã khai (mặc định từ chối) | An toàn nhất, nhưng mọi biến khởi tạo của gói và luật ngưỡng phải khai lại; rộng hơn lỗi này |
| Mỗi userTask khai trường nó ghi trong BPMN, workflow-api đọc từ BPMN đã deploy | Phần tử chuẩn của Flowable; đọc cùng lần với biến quyết định và bước phân cấp; không đọc CSDL |

## Quyết định

Chọn cách cuối.

- **Khai trường:** mỗi userTask khai các biến nó ghi bằng `<flowable:formProperty id="..."/>` thẳng trong
  `extensionElements` của nó, chỉ thuộc tính `id`. Đó là mọi khóa của `form.properties` và của `variables` ở mọi nút
  trong khai báo bước, kể cả biến quyết định như `approved`. Nhiều bước khai cùng một tên thì mỗi bước đó đều ghi được
  nó.
- **Vì sao formProperty:** Flowable 7.2 chỉ dùng formProperty trong `FormService` (đọc và gửi biểu mẫu kiểu cũ).
  workflow-api hoàn thành bước bằng `POST /runtime/tasks/{id}` (`TaskService`), không đi qua `FormService`, nên
  formProperty không kiểm, không đổi kiểu và không tạo biến nào. Đã thử ngày 2026-11-23 trên image
  `flowable/flowable-rest:7.2.0`, chạy riêng, không chung CSDL với lõi. BPMN khai formProperty chỉ có `id` deploy
  được (bộ đọc kiểm theo XSD, `id` là thuộc tính bắt buộc duy nhất). Bước hoàn thành được với biến khác trường đã
  khai, và với một bước không gửi trường nào. Biến của hồ sơ chỉ gồm biến đã gửi. Thuộc tính khác (`type`, `required`,
  `variable`, `expression`) chỉ có tác dụng qua `FormService`, nên bị cấm: chúng hứa một điều không xảy ra, `variable`
  làm tên biến khác `id` mà workflow-api đọc, `expression` là biểu thức chạy trong Flowable.
- **Khởi tạo:** workflow-api từ chối (`400`) biến là trường của bất kỳ userTask nào của phiên bản sắp khởi tạo. Lỗi
  nêu tên biến và bước.
- **Hoàn thành:** workflow-api từ chối (`400`) biến là trường của một userTask khác mà không phải trường của bước
  đang hoàn thành. Bước lấy theo `processDefinitionId` của task, tức phiên bản hồ sơ đang chạy, không theo phiên bản
  mới nhất. Kiểm sau quyền hoàn thành, nên người của tenant khác hay vai trò khác vẫn nhận `404`/`403` như trước.
- **Biến không là trường của bước nào** vẫn gửi được như trước, lúc khởi tạo lẫn lúc hoàn thành, ví dụ `excessM2`.
- **Đọc BPMN:** cùng một lần đọc `/repository/process-definitions/{id}/resourcedata` với biến quyết định và bước phân
  cấp, nhớ theo mã định nghĩa suốt đời tiến trình. Không đọc được thì từ chối (`502`).
- **`make check-fast`:** với mỗi BPMN có khai báo bước, trường của một bước trong khai báo (`form.properties`,
  `variables` của nút) phải đúng bằng formProperty của userTask cùng id. formProperty có thuộc tính khác `id`, có
  phần tử con, trùng id, hay nằm ngoài userTask là lỗi. Bước kiểm đọc trường bằng chính mã của workflow-api
  (`core/workflow-api/app/fields.py`).
- `scripts/check-declarative.sh` không đổi. formProperty chỉ có `id` không chạy mã nên gói khai báo dùng được;
  listener và bước chạy mã vẫn bị cấm.

## Hệ quả

- Nội dung của một bước chỉ do người làm bước đó ghi. Người lập không gửi sẵn được `decision` hay `comment`; người
  trình không ghi sẵn được `decision`; người xác nhận không sửa được trường của bước trước. Điều ADR 0025 ghi là
  "chưa chặn giữa hai bước" nay được chặn với mọi biến quyết định khai làm trường của bước.
- Trường dùng chung thì mọi bước khai nó đều ghi đè được nhau. Nội dung phải giữ riêng thì đặt tên riêng, như
  `decision` tách khỏi `comment`.
- workflow-api vẫn không kiểm giá trị hay trường bắt buộc của biểu mẫu: người làm bước bỏ trống `decision` qua API
  thì hồ sơ không có quyết định, nhưng không mang nội dung của người khác.
- Định nghĩa deploy trước thay đổi này không có formProperty nên không từ chối gì. Bản cài cũ chạy lại `make seed` và
  `make app-install APP=<gói>` để deploy phiên bản mới. Hồ sơ đang chạy trên phiên bản cũ giữ hành vi cũ tới khi
  kết thúc.
- Lần đầu hoàn thành một bước của một phiên bản quy trình trong đời tiến trình tốn thêm tối đa hai lời gọi tới
  Flowable (đọc khóa và BPMN); các lần sau đọc từ bộ nhớ.
- Biến quyết định mà không bước nào khai làm trường (chỉ có thể khi cổng đọc biến không có trong khai báo bước) vẫn chỉ
  được ADR 0025 bảo vệ lúc khởi tạo. `make check-fast` không bắt buộc mọi biến quyết định là trường, vì ADR 0025 lấy
  thừa tên (`execution`, `getVariable`).
- Quy trình mẫu mới `core-handoff` (hai bước nối tiếp do hai vai trò làm) để `make smoke` kiểm việc chặn giữa hai bước.
