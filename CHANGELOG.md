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
