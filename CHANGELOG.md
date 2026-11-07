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
- `make up`, `make seed`, `make smoke` (kiểm tra đầu-cuối); CI dựng lõi trên máy trắng và chạy smoke.
  `make env` tự thêm biến mới từ `.env.example` vào `.env` đã có.
- Tài liệu API của lõi (`docs/api.md`) kèm ví dụ và ý nghĩa mã lỗi.
- Workflow BPMN tại `/v1/workflow/*`: Flowable đứng sau `workflow-api`, cách ly tenant, chỉ vai trò ứng viên được
  hoàn thành task, quy tắc bốn mắt; quy trình mẫu `core-approval` deploy theo tenant bằng `make seed`. `make test`
  chạy kiểm thử đơn vị; ADR 0004 về lớp kiểm soát quyền trước Flowable.
- Tài liệu công cụ sử dụng (`docs/tools.md`): vai trò, cấu hình và cách xem của từng thành phần lõi và công cụ
  phát triển.
- `make backup` và `make restore`: sao lưu PostgreSQL (mọi CSDL và vai trò), SeaweedFS và `.env` kèm checksum;
  khôi phục ghi đè có xác nhận. CI kiểm cả vòng sao lưu, xóa sạch, khôi phục.
- `make up` chờ tới khi cổng APISIX đã nạp xong tuyến đường (healthcheck), không chỉ tới khi container chạy.
