<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), đánh số
phiên bản theo [Semantic Versioning](https://semver.org/lang/vi/).

## [Unreleased]

### Added

- Giấy phép Apache-2.0 và header SPDX cho mọi tệp, kiểm bằng `make check-fast`; hook pre-push qua `make hooks`;
  CI chạy đúng lệnh này với mọi pull request.
- Quy tắc làm việc (`AGENTS.md`), hướng dẫn đóng góp, quy tắc ứng xử, chính sách bảo mật, mẫu issue và pull
  request.
- ADR 0001 về quy ước dự án, ADR 0002 về chọn thành phần lõi và giấy phép, ADR 0003 về bố cục ba tầng.
- Lõi Tầng 1 chạy bằng Docker Compose: PostgreSQL + pgvector, Keycloak, APISIX (standalone), Hasura CE, SeaweedFS.
- Cổng APISIX chặn yêu cầu không token hoặc token giả, chặn console quản trị Keycloak, giới hạn tần suất API theo
  token (không theo IP, để người dùng sau cùng một NAT hay tunnel không chặn lẫn nhau).
- Hai tenant demo cách ly dữ liệu bằng claim `tenant` và quyền Hasura theo dòng.
- `make up`, `make seed`, `make smoke` (5 bài kiểm tra đầu-cuối); CI dựng lõi trên máy trắng và chạy smoke.
  `make env` tự thêm biến mới từ `.env.example` vào `.env` đã có.
- Tài liệu API của lõi (`docs/api.md`) kèm ví dụ và ý nghĩa mã lỗi.
