<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Bản ghi quyết định kiến trúc

Mỗi quyết định quan trọng là một tệp đánh số ở đây, theo định dạng của Michael Nygard trong
[Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):
Trạng thái, Bối cảnh, Quyết định, Hệ quả. Chúng giải thích vì sao dự án như hiện nay, để không ai phải đoán lại.

## Quy tắc

- Mỗi tệp một quyết định, tên `NNNN-tieu-de-ngan.md`, đánh số theo thứ tự. Sao chép từ [template.md](template.md).
- Quyết định thay đổi kiến trúc, phạm vi, thành phần hay quy ước có bản ghi trong cùng pull request.
- Bản ghi đã chấp nhận không sửa, trừ lỗi chính tả hoặc thêm liên kết. Quyết định thay đổi là một bản ghi mới thay
  thế bản cũ; trạng thái bản cũ đổi thành `Bị thay thế bởi NNNN`.
- Câu hỏi còn mở là issue gắn nhãn `needs-decision`. Khi chốt, kết quả thành một bản ghi ở đây và issue trỏ tới nó.

## Danh sách

| Số | Quyết định | Trạng thái |
|---|---|---|
| [0001](0001-quy-uoc-du-an.md) | Tiếng Việt, Apache-2.0 và quy ước làm việc | Chấp nhận |
| [0002](0002-chon-thanh-phan-loi.md) | Chọn thành phần lõi và kiểm tra giấy phép | Chấp nhận |
| [0003](0003-bo-cuc-ba-tang-va-goi-nghiep-vu.md) | Bố cục ba tầng: thành phần dùng chung và gói nghiệp vụ khai báo | Chấp nhận |

## Quyết định còn mở

| Câu hỏi | Issue |
|---|---|
| Công nghệ giao diện và thư viện bản đồ cho Tầng 2 | chưa mở |
