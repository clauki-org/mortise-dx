<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0003. Bố cục ba tầng: thành phần dùng chung và gói nghiệp vụ khai báo

- Trạng thái: Chấp nhận
- Ngày: 2026-11-07

## Bối cảnh

Kiến trúc DX-OS có ba tầng: lõi không giao diện, không gian năng lực dùng chung H-P-D-I, và ứng dụng nghiệp vụ
cắm–rút. Dự án hướng tới một nền
tảng mà tổ chức tự cấu hình để dùng, không phải lập trình thêm cho mỗi lĩnh vực. Nếu thành phần dùng chung và nghiệp
vụ nằm lẫn trong một thư mục, mỗi lĩnh vực mới lại phải sửa phần dùng chung.

Các lựa chọn đã xét:

1. Mỗi ứng dụng tự mang giao diện và logic riêng, chỉ dùng chung lõi. Đơn giản, nhưng mỗi lĩnh vực viết lại danh
   mục, biểu mẫu, bản đồ, báo cáo.
2. Một ứng dụng web chung chứa sẵn mọi nghiệp vụ, bật tắt bằng cờ. Nghiệp vụ lẫn vào phần chung; gỡ một lĩnh vực
   phải sửa code.
3. Thư viện thành phần dùng chung không chứa nghiệp vụ, cộng gói nghiệp vụ chủ yếu là khai báo (schema, quy trình,
   biểu mẫu, quy tắc, lớp bản đồ) được thành phần đọc và hiển thị.

## Quyết định

Chọn lựa chọn 3, với bố cục:

- `core/`: Tầng 1, lõi không giao diện.
- `platform/`: Tầng 2, gồm khung giao diện `web/`, thành phần `components/`, dịch vụ dùng chung tự viết `services/`
  và lược đồ `schema/`. Không chứa từ nghiệp vụ của lĩnh vực nào.
- `apps/<gói>/`: Tầng 3, mỗi gói một thư mục, có tệp khai báo `app.yaml`. Gói ưu tiên khai báo; chỉ viết giao diện
  riêng khi thành phần dùng chung không đáp ứng được.
- `devices/`: firmware và giả lập thiết bị; `deploy/`: triển khai lên máy chủ.

Thư mục chỉ được tạo khi có mã nguồn thật đầu tiên.

## Hệ quả

- Thêm lĩnh vực mới chủ yếu là viết một gói khai báo; phần dùng chung được dùng lại.
- Thành phần phải thiết kế cấu hình được ngay từ đầu, tốn công hơn viết thẳng cho một lĩnh vực.
- Cần cơ chế cài và gỡ gói (`make app-install`, `make app-remove`) và bước kiểm tra trong CI: gỡ gói thì
  `make smoke` vẫn qua; `core/` và `platform/` không chứa từ nghiệp vụ.
- `AGENTS.md` mục Bố cục ghi bố cục và ranh giới theo bản ghi này.
