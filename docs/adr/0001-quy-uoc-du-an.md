<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0001. Tiếng Việt, Apache-2.0 và quy ước làm việc

- Trạng thái: Chấp nhận
- Ngày: 2026-11-05

## Bối cảnh

Dự án hướng tới người dùng và người đóng góp bên ngoài nhóm. Họ cần giấy phép rõ ràng trong từng tệp, dựng được hệ
thống từ mã nguồn, không gặp mã của dự án khác bị đóng gói kèm, và có bug tracker, changelog, README cùng lịch sử thay
đổi minh bạch. Nhóm có dùng trợ lý AI khi lập trình.

## Quyết định

- Giấy phép Apache-2.0 cho toàn bộ mã của dự án; header SPDX trong mọi tệp, kiểm bằng REUSE (`make check-fast`).
- Tiêu đề commit và pull request bằng tiếng Anh theo Conventional Commits, để lịch sử đọc được bằng công cụ chuẩn;
  thân commit, thân pull request, issue, tài liệu và chú thích bằng tiếng Việt; định danh trong code bằng tiếng Anh.
- Mọi thay đổi đi qua issue và pull request; repo chỉ bật squash merge, mỗi pull request thành một commit trên
  `main`, có `Closes #`.
- Không trailer AI trong commit và pull request; không emoji, không icon trang trí trong code và tài liệu.
- Quy tắc làm việc nằm duy nhất trong `AGENTS.md`; `CLAUDE.md` chỉ trỏ tới nó.

## Hệ quả

- Lịch sử issue, pull request và review là bằng chứng hệ thống quản lý mã được dùng thật.
- Người đóng góp chịu trách nhiệm hiểu và giải thích được mọi dòng mình commit, dù có AI hỗ trợ.
- Người đọc nước ngoài cần công cụ dịch cho tài liệu; định danh tiếng Anh giữ code đọc được với mọi người.
