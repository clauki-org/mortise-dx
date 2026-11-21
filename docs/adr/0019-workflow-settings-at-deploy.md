<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0019. Ngưỡng và thời hạn của quy trình gói là settings, thay vào BPMN lúc deploy

- Trạng thái: Chấp nhận
- Ngày: 2026-11-20

## Bối cảnh

Quy trình rà soát của gói xã rẽ nhánh theo một ngưỡng (phần vượt trên 300 m² thì phải công khai) và chờ một thời
hạn (công khai 30 ngày), theo Điều 3a khoản 2, 3 NĐ 155/2025/NĐ-CP, bổ sung bởi Điều 3 NĐ 369/2026/NĐ-CP. Các yêu cầu:

- **Không viết cứng trong logic:** hai số này là cấu hình (AGENTS.md).
- **Demo và CI cần thời hạn ngắn**, vì không ai chờ 30 ngày để thấy bước tiếp theo.
- **Người lập và người duyệt hồ sơ không được tự đổi chúng.** Người lập gửi ngưỡng thật cao thì né được bước công
  khai.

workflow-api chuyển sang Flowable mọi biến client gửi khi lập hồ sơ và khi hoàn thành bước, chỉ chặn vài tên dành
riêng của lõi. Các cách đã xét:

- **Biến của hồ sơ, client gửi:** ai lập hay duyệt hồ sơ cũng ghi đè được.
- **workflow-api tự thêm biến từ khai báo của gói:** workflow-api không đọc CSDL. Còn phải chặn các tên đó ở cả lúc
  lập lẫn lúc hoàn thành bước, tức là đổi lõi lớn cho một nhu cầu của gói.
- **Bảng cấu hình trong CSDL, quy trình gọi HTTP để đọc:** Flowable phải giữ khóa đọc dữ liệu, thêm một đường gọi
  ra ngoài cho mỗi hồ sơ.
- **Giá trị nằm trong định nghĩa quy trình.** Bộ cài thay giá trị vào BPMN trước khi deploy.

## Quyết định

Chọn cách cuối.

- **Khai trong `app.yaml`:** gói khai `settings` (`contracts/app.schema.json`): tên là chữ thường, số và gạch dưới;
  giá trị là số hoặc chuỗi chỉ gồm chữ, số và `. : + _ -`, đủ cho số và thời hạn ISO 8601.
- **Viết trong BPMN:** BPMN của gói viết `{{tên}}` ở chỗ cần giá trị. Cú pháp này không trùng `${...}` của biểu thức
  Flowable.
- **Thay lúc cài:** `scripts/app-deploy.py` thay mọi `{{tên}}` bằng giá trị lúc cài, rồi băm và deploy tệp đã thay.
  - Băm tính trên tệp đã thay: đổi giá trị thì quy trình được deploy phiên bản mới; hồ sơ đang chạy giữ phiên bản
    cũ.
  - Giá trị đang dùng được in ra khi cài.
- **Ghi đè khi cài:** `make app-install APP=<gói> SETTINGS=tên=giá trị,...`. Tên ghi đè không có trong `app.yaml` là
  lỗi, không lặng lẽ bỏ qua. Giá trị ghi đè phải cùng loại với giá trị trong `app.yaml`: số thay số, thời hạn ISO 8601
  thay thời hạn.
- **Kiểm ở `make check-fast`:** BPMN của gói chỉ được dùng tên đã khai trong `app.yaml` của chính gói; BPMN của lõi
  không có settings. Bộ cài cũng dừng khi gặp tên chưa khai, không để chuỗi `{{tên}}` lọt vào Flowable.
- **Giá trị mặc định là giá trị theo văn bản.** Demo và CI ghi đè thời hạn:
  `SETTINGS=publication_period=PT20S`.

## Hệ quả

- **Người lập hay người duyệt hồ sơ không đổi được ngưỡng và thời hạn qua API**, vì chúng là hằng số trong định
  nghĩa quy trình.
- **Muốn đổi giá trị thì chạy lại `make app-install`.** Chạy lại mà quên `SETTINGS` thì bản cài quay về giá trị
  trong `app.yaml`. Smoke của gói đọc thời hạn từ quy trình đã deploy; thời hạn không hết trong thời gian chờ thì
  báo SKIP phần công khai và trình, kèm lệnh cài lại với thời hạn ngắn.
- **Một giá trị cho mọi tenant của bản cài.** Ngưỡng và thời hạn hiện là quy định chung. Giá trị riêng cho từng
  tenant (ví dụ mỗi tỉnh phân cấp khác nhau, #111) cần dữ liệu theo tenant, không dùng cơ chế này.
- **Cơ chế chỉ thay chuỗi trong tệp.** Nó không cho tính toán, điều kiện hay giá trị lấy từ dữ liệu của hồ sơ.
