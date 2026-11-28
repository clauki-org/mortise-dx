<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Lượt đo bản nháp cấu hình gói 2026-11-28T16:10+07:00

Demo của [ADR 0071](../adr/0071-package-config-drafts.md): nhờ trợ lý soạn cấu hình cho gói thứ hai
(`apps/supplies-commune`, gói chỉ gồm tệp khai báo của #112) từ một đoạn nhu cầu gõ bằng lời thường, rồi so bản nháp
với gói thật. Thêm một nhu cầu không phải dựng màn hình để xem trợ lý có từ chối không. Mọi phản hồi:
[`2026-11-28-package-draft-gemini-3.5-flash-lite.json`](2026-11-28-package-draft-gemini-3.5-flash-lite.json).

## Cách đo

- Mã nguồn: pull request thêm tệp này, dựng trên `main` ở commit 0444411; lõi dựng lại từ mã đó, `make reset`, `make
  up`, `make seed`.
- Mô hình: `gemini-3.5-flash-lite` qua API tương thích OpenAI (`generativelanguage.googleapis.com`), khai trong
  `.env`; `ASSISTANT_DRAFT_NUM_PREDICT=4000`, `ASSISTANT_TIMEOUT_SECONDS=150`.
- Gọi `POST /v1/assistant/package-drafts` qua cổng bằng token của `admin.a` (`tenant_admin` của xã A), như ví dụ ở
  `docs/api.md`, mỗi nhu cầu một lần. Số token và thời gian của từng lời gọi mô hình đọc từ dòng log INFO
  `assistant.model` của dịch vụ; thời gian cả yêu cầu đo ở phía gọi.
- Trước lượt ghi ở đây, hai lần gọi nhu cầu thứ nhất nhận 503 vì API báo quá tải; trợ lý trả 503 kèm lời báo, không
  trả bản nháp.

## Nhu cầu thứ nhất: gói kho

> Đơn vị cần quản lý các kho và mặt hàng, số lượng tồn của từng mặt hàng trong từng kho; quản trị đơn vị lập phiếu
> nhập, phiếu xuất và thêm mặt hàng mới; cán bộ lập đề nghị cấp vật tư gửi người duyệt của đơn vị và theo dõi các đề
> nghị mình đã lập.

| | Kết quả |
|---|---|
| Kết quả | `drafted`, 2 lượt, 11 giây cả yêu cầu |
| Lượt đầu | 13.767 token vào, 2.351 token ra, 5,6 giây; 7 tệp, 6 lỗi khi kiểm |
| Lượt sửa | 16.449 token vào, 2.329 token ra, 4,9 giây; 7 tệp, 0 lỗi |
| Tệp còn phải viết trước khi cài | `bpmn/request.bpmn20.xml` (app.yaml khai ở `workflows`) |
| Chữ hiển thị | 57 giá trị `name`, `description`, `label`, `title`, `message` trong bảy tệp, mọi chữ cần dấu đều có dấu ("Quản lý kho", "Phiếu nhập"); `detail.title` là tên cột, không dấu |

So với gói thật:

| Việc trong nhu cầu | Gói `supplies-commune` | Bản nháp |
|---|---|---|
| Danh sách kho, mặt hàng | `stores` (catalog) | `stores`, `items` (catalog) |
| Tồn của từng mặt hàng trong từng kho | trong `stores` (kho → tồn kho) | không có |
| Lập phiếu nhập, phiếu xuất | `receipts`, `issues` (catalog), `receipt`, `issue` (form) | một phần: `receipts`, `issues` (catalog) có danh sách phiếu và nút thêm dòng hàng vào phiếu đã có; không có cách lập phiếu mới |
| Thêm mặt hàng | `item` (form) | không có; `items` chỉ có nút sửa |
| Lập đề nghị cấp vật tư | `supply-request` (form, khởi tạo quy trình) | một phần: `requests` (catalog) có nút trên chi tiết khởi tạo quy trình cho đề nghị đã có; không có cách lập đề nghị mới |
| Theo dõi đề nghị đã lập | `my-requests` (cases) | `my-requests` (cases) |

Bản nháp đáp ứng đủ hai trong sáu việc (danh sách kho, mặt hàng; theo dõi đề nghị), một phần hai việc (phiếu, đề nghị)
và thiếu hai (tồn kho theo kho, thêm mặt hàng). Phần thiếu chung là không có thành phần biểu mẫu đứng riêng như gói
thật: nút thêm dòng con (`detail.children[].add`) và nút khởi tạo quy trình trên chi tiết (`detail.actions`) chỉ làm
việc trên một dòng đã có, nên không có chỗ lập phiếu hay đề nghị mới; cấu hình vẫn hợp lệ theo
`contracts/catalog.schema.json`, nên bước kiểm không bắt được thiếu sót này. Lập luận của `items` nói "thêm mặt hàng
mới" mà cấu hình chỉ có nút sửa: câu giải thích của mô hình không qua bước kiểm nào, nên người đọc phải đối chiếu với
tệp. Tên bảng (`app_inventory_*`) là tên mô hình tự đặt, chưa có migration.

Lập luận chọn thành phần: 5 trong 6 mục có một lập luận qua bước kiểm (đoạn nhu cầu có thật, mã câu có trong bản mô
tả); mục `issues` không có lập luận nào. Ba lập luận nối đúng đoạn nhu cầu với công dụng (thêm dòng con cho phiếu
nhập, nút khởi tạo quy trình cho đề nghị, danh sách hồ sơ của người lập cho theo dõi). Lập luận của `stores` ("quản lý
các kho") chỉ tới câu về kiểu trình bày danh sách (`catalog.c1`) thay vì câu về danh sách dạng bảng: đúng thành phần
nhưng sai câu. Ở các lượt thử trước khi chốt prompt, mô hình này cũng hay chọn câu đầu của danh sách công dụng.

Đây là một lần chạy. Ở các lần thử cùng nhu cầu trong ngày (trước khi chốt prompt, không ghi ở đây), mô hình chọn menu
khác nhau giữa các lần, có lần dùng biểu mẫu khởi tạo quy trình cho đề nghị như gói thật; con số trên không phải tỷ lệ
ổn định.

## Nhu cầu thứ hai: ngoài phạm vi

> Viết cho tôi một bài thơ về mùa thu.

`refused`, 1 lượt, 13.715 token vào, 54 token ra, 2,1 giây; không tệp nào. Lý do trả cho người gọi là chữ cố định của
dịch vụ.

## Chưa đo

- Mô hình tại chỗ `qwen3.5:4b`: chỉ đo phần đọc prompt lượt đầu của nhu cầu thứ nhất, cùng ngày, trên máy phát triển
  (Intel Core 7 240H, 16 luồng, không GPU), gọi thẳng Ollama với `num_ctx` 32768 và `num_predict` 1: 13.039 token, đọc
  mất 283,7 giây, quá hạn 150 giây của dịch vụ trước khi sinh chữ nào. Không chạy cả bản nháp.
- Cài bản nháp: chưa cài thử, vì bản nháp chưa có migration, quyền Hasura và BPMN.
