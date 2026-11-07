<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Chính sách bảo mật

Mortise DX giữ định danh người dùng, token truy cập và dữ liệu của nhiều tenant, nên báo cáo lỗ hổng rất quan trọng.

## Phiên bản được hỗ trợ

Chưa có bản phát hành. Báo cáo cho nhánh `main` đều được tiếp nhận.

## Báo cáo lỗ hổng

Không mở issue công khai. Dùng **Report a vulnerability** ở tab Security của repo; báo cáo chỉ tới nhóm phát triển.

Ghi rõ lỗ hổng là gì, cách tái hiện, commit hoặc phiên bản, và kẻ tấn công làm được gì. Xóa token, mật khẩu và dữ
liệu thật khỏi mọi thứ đính kèm.

Báo cáo được xác nhận trong vòng một tuần. Sau khi có bản sửa, báo cáo được công bố thành GitHub security advisory,
kèm ghi nhận người báo nếu muốn.

## Những gì cần báo riêng

- Gọi được API dữ liệu mà không có token hợp lệ, hoặc vượt qua cổng APISIX
- Người dùng một tenant đọc hoặc sửa được dữ liệu của tenant khác
- Token, mật khẩu hay bí mật lọt vào log, phản hồi API hoặc repo
- Trang quản trị (Keycloak, Hasura) truy cập được từ ngoài máy chủ
- Tệp tải lên vượt qua bước quét mã độc
