<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0062. Gói kho dùng chung: phiếu nhập, phiếu xuất, tồn kho là view, luật trên nhiều dòng qua hàm của nền tảng

- Trạng thái: Đề xuất
- Ngày: 2026-11-27
- Bổ sung: [ADR 0022](0022-declarative-packages.md) (gói khai báo gọi được hàm của nền tảng, không chỉ của lõi)

## Bối cảnh

Gói `supplies-commune` quản lý kho và vật tư của xã: số lượng là một cột do quản trị xã sửa tay. Hai bản cài cạnh
nhau (#243, ADR 0058 của #244) cần cùng một gói kho cho chính quyền và cho một
doanh nghiệp hư cấu (tấm pin, bộ biến tần, cáp). Gói phải dùng chữ không gắn ngành, có phiếu nhập và phiếu xuất (dòng
cha, dòng con), tồn kho tính trong CSDL, và CSDL phải từ chối phiếu xuất vượt số tồn.

Ví dụ: kho DMT-K1 có 20 tấm pin. Quản trị thêm dòng xuất 25 tấm vào phiếu PX-DMT-002; lệnh bị từ chối kể cả khi gọi
thẳng GraphQL, và tồn vẫn là 20.

Ba câu hỏi:

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Đổi tên gói | `apps/warehouse`, lược đồ `app_warehouse` | Đúng nghĩa hơn, nhưng đổi tên bảng GraphQL, bảng theo dõi migration, mã gói trong menu và đường dẫn, CI, `deploy.env`, e2e, mẫu cài của #244 và migration trường tùy chỉnh của #240 trên `app_supplies_commune.items`; bản cài đang chạy phải gỡ (mất dữ liệu) rồi cài lại |
| | Giữ mã `supplies-commune`, đổi tên hiển thị thành "Kho" | Mã chỉ hiện trong đường dẫn và lệnh; không bản cài, nhánh hay kiểm thử nào phải đổi |
| Luật "không xuất quá tồn" | CHECK trên bảng | CHECK chỉ thấy một dòng, không cộng được các phiếu |
| | Lưu tồn thành cột, phiếu xuất trừ bằng một mutation thứ hai | Người gọi bỏ mutation thứ hai là tồn sai; không phải CSDL chặn |
| | Dòng số dư nối nhau bằng khóa ngoại (mỗi dòng mang số dư trước và sau) | Khai báo được, nhưng người nhập phải biết dòng trước và số dư trước; biểu mẫu chung không làm được |
| | Trigger trong migration của gói | ADR 0022 cấm |
| | Hàm của nền tảng gắn trigger cho gói | Một hàm chung, không chữ nghiệp vụ; gói chỉ khai view và lời báo |
| Kho đặt ở đâu | Trên phiếu | Biểu mẫu thêm dòng con chỉ điền sẵn cột nối về phiếu (ADR 0054); dòng phải chọn lại kho để lọc mặt hàng và có thể chọn lệch |
| | Trên từng dòng | Một ô chọn thêm mỗi dòng; khóa ngoại ghép (kho, mặt hàng) không cho lệch |

## Quyết định

- **Giữ mã gói, lược đồ và tên bảng.** Tên hiển thị là "Kho"; mục menu, nhãn và lời báo dùng chữ trung tính (kho, mặt
  hàng, phiếu nhập, phiếu xuất, tồn kho). Đề nghị cấp vật tư giữ nguyên quy trình và mã mục menu. Đổi mã gói để sau
  khi không còn nhánh nào trỏ vào mã cũ, kèm bước chuyển dữ liệu.
- **`platform.empty_guard_attach(target, violations, message, tenant_column)`** (`platform/schema/migrations`):
  - Gắn trigger AFTER ROW cho thêm, sửa, xóa trên `target`. Trigger xét các tenant của dòng cũ và dòng mới. Với mỗi
    tenant, nó khóa `pg_advisory_xact_lock` theo (view, tenant) rồi mới đọc `violations`. View có dòng của tenant đó
    thì lệnh bị từ chối với `check_violation` và lời báo của gói.
  - Khóa làm hai giao dịch ghi cùng tenant chạy lần lượt. Ở READ COMMITTED (mặc định của PostgreSQL; `compose.yaml` không đặt mức khác cho Hasura), câu đọc sau khóa thấy
    dòng giao dịch trước đã ghi.
  - Hàm không biết luật nói gì. Gói viết luật thành view, ADR 0022 cho phép view.
- **Gói kho:**
  - `items.quantity` thành tồn đầu.
  - Bảng `receipts`, `issues` là dòng cha. `receipt_lines`, `issue_lines` là dòng con, ghi kho và mặt hàng, số lượng
    dương. Khóa ngoại ghép kèm `tenant_id`, `RESTRICT`.
  - View `stock` tính tồn đầu + nhập − xuất. View `stock_shortfalls` liệt kê dòng tồn âm.
  - Luật gắn trên `issue_lines`, `receipt_lines` (bỏ dòng nhập) và `items` (hạ tồn đầu). Cả bốn bảng mới có nhật ký
    (ADR 0009).
  - Dòng không có quyền sửa qua Hasura: ghi sai thì xóa rồi thêm lại.
- **Giao diện:**
  - Danh mục "Kho" có hai bảng con: "Tồn kho" chỉ đọc, "Mặt hàng" có nút thêm.
  - Danh mục "Phiếu nhập" và "Phiếu xuất" có bảng "Dòng hàng" với nút thêm dòng.
  - Biểu mẫu "Lập phiếu nhập", "Lập phiếu xuất" chỉ quản trị thấy. Danh mục chưa có nút thêm dòng cấp đầu (ADR 0054).
- **Dữ liệu demo:** `seed/demo.yaml` cho hai xã. `seed/dien-mat-troi.yaml` cho tenant `dmt` của mẫu cài doanh
  nghiệp (#244), cùng định dạng. `make check-fast` kiểm mọi `seed/*.yaml` của gói khai báo.

## Hệ quả

- Gói khai báo có luật trên nhiều dòng mà không viết trigger. Mỗi lệnh ghi vào bảng có luật đọc view một lần cho mỗi
  dòng, và các lệnh ghi cùng tenant trên cùng view chạy lần lượt. Thời gian của bước này chưa đo.
- Trigger chạy ở cuối mỗi câu lệnh, không ở cuối giao dịch. Một yêu cầu Hasura xuất trước rồi nhập sau trong cùng
  giao dịch bị từ chối ở lệnh xuất. Đổi thứ tự thì qua.
- Ở REPEATABLE READ hay SERIALIZABLE, câu đọc sau khóa vẫn dùng ảnh chụp đầu giao dịch nên khóa không đủ. Bản cài
  đặt Hasura chạy ở mức đó (biến môi trường) thì phải xét lại hàm này.
- Duyệt đề nghị cấp vật tư không tự lập phiếu xuất, vì gói không có mã (ADR 0022). Quản trị lập phiếu sau khi giao.
- Mã gói còn chữ `commune`, và người dùng thấy nó trong đường dẫn.
- Trường tùy chỉnh cho mặt hàng đến từ ADR 0059 trên chính bảng `items`. Quyết định này không đổi bảng đó.
- **Chưa kiểm** khi ghi quyết định này: smoke của gói qua cổng (lời báo Hasura trả cho `check_violation`, quyền của
  view), danh mục và biểu mẫu mới trên trình duyệt, e2e đã sửa nhãn, nạp `seed/dien-mat-troi.yaml` trên bản cài
  doanh nghiệp.
- **Đã kiểm** trên PostgreSQL 17 dựng riêng ngày 2026-11-27: xuất quá tồn, sửa dòng xuất, bỏ dòng nhập, hạ tồn đầu
  đều bị từ chối; hai phiên xuất đồng thời thì phiên sau bị từ chối; tenant khác không ảnh hưởng; số tồn của cả hai tệp
  dữ liệu demo đúng; lùi rồi áp lại migration chạy sạch.
