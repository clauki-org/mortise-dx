<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Bản ghi quyết định kiến trúc

Mỗi quyết định quan trọng là một tệp đánh số ở đây, theo định dạng của Michael Nygard trong
[Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):
Trạng thái, Bối cảnh, Quyết định, Hệ quả. Chúng giải thích vì sao dự án như hiện nay, để không ai phải đoán lại.

## Quy tắc

- Mỗi tệp một quyết định, tên `NNNN-short-title.md`, đánh số theo thứ tự. Sao chép từ [template.md](template.md).
- Quyết định thay đổi kiến trúc, phạm vi, thành phần hay quy ước có bản ghi trong cùng pull request.
- Bản ghi đã chấp nhận không sửa, trừ lỗi chính tả hoặc thêm liên kết. Quyết định thay đổi là một bản ghi mới thay
  thế bản cũ; trạng thái bản cũ đổi thành `Bị thay thế bởi NNNN`.
- Câu hỏi còn mở là issue gắn nhãn `needs-decision`. Khi chốt, kết quả thành một bản ghi ở đây và issue trỏ tới nó.

## Danh sách

| Số | Quyết định | Trạng thái |
|---|---|---|
| [0001](0001-project-conventions.md) | Tiếng Việt, Apache-2.0 và quy ước làm việc | Chấp nhận |
| [0002](0002-core-components.md) | Chọn thành phần lõi và kiểm tra giấy phép | Chấp nhận |
| [0003](0003-three-tier-layout.md) | Bố cục ba tầng: thành phần dùng chung và gói nghiệp vụ khai báo | Chấp nhận |
| [0004](0004-workflow-access-control.md) | Workflow: Flowable REST đứng sau lớp kiểm soát quyền workflow-api | Chấp nhận |
| [0005](0005-schema-migrations.md) | Thay đổi lược đồ CSDL bằng migration dbmate, mỗi gói một lịch sử riêng | Chấp nhận |
| [0006](0006-frontend-stack.md) | Giao diện Tầng 2: React, Mantine và component đọc cấu hình gói | Chấp nhận |
| [0007](0007-login-page-exception.md) | Trang đăng nhập là bề mặt giao diện duy nhất của lõi | Chấp nhận |
| [0008](0008-shared-api-contracts.md) | Hợp đồng API giữa các tầng trong `contracts/`, CI kiểm cả ví dụ đúng và ví dụ sai | Chấp nhận |
| [0009](0009-tamper-evident-audit-log.md) | Nhật ký thay đổi ghi bằng trigger, chuỗi băm phát hiện sửa, đối chiếu băm trong bản sao lưu | Chấp nhận |
| [0010](0010-upload-malware-scan.md) | Quét mã độc tệp tải lên bằng ClamAV, trước khi lưu, từ chối khi chưa quét được | Chấp nhận |

## Quyết định còn mở

Hiện không có.
