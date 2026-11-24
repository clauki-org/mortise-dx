<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Đóng góp

Tài liệu này nói cách làm việc trong repo; quy tắc code chi tiết ở [AGENTS.md](AGENTS.md).

## Trước khi bắt đầu

- Lỗi: mở issue từ mẫu Báo lỗi, ghi commit, hệ điều hành, lệnh đã chạy và nguyên văn kết quả.
- Tính năng: mở issue từ mẫu Tính năng; việc đã lên kế hoạch dùng mẫu Công việc.

Mỗi pull request ứng với một issue. Việc lớn tách thành nhiều issue.

## Làm việc ở máy

Cần Docker Engine 24+ với Compose v2, GNU Make, `curl`, `jq`, `openssl`, và [`uv`](https://docs.astral.sh/uv/)
(để chạy REUSE, shellcheck, yamllint mà không phải cài riêng). Sau khi clone, chạy `make hooks` một lần để lỗi bị
chặn trước khi push.

```bash
make up           # dựng lõi
make seed         # tài khoản demo và quyền dữ liệu
make smoke        # kiểm tra đầu-cuối qua cổng
make test         # kiểm thử đơn vị dịch vụ tự viết
make check-fast   # giấy phép, cú pháp compose, shell, YAML, Python, hợp đồng API; CI chạy đúng lệnh này
make contracts    # xuất lại OpenAPI sau khi đổi route hay model của workflow-api
make help         # mọi lệnh
```

Đổi lược đồ CSDL của lõi: `make migrate-new NAME=<ten_ngan>`, viết cả phần `up` và `down`, rồi `make up`. Không sửa
migration đã merge vào `main`; muốn đổi thì viết migration mới ([ADR 0005](docs/adr/0005-schema-migrations.md)).

## Nhánh và commit

- Tạo nhánh từ `main`: `<type>/<mô-tả-ngắn>` hoặc `<type>/<issue>-<mô-tả>`, ví dụ `feat/12-workflow-gateway`,
  `fix/20-expired-token`, `docs/architecture`.
- Commit trong nhánh viết thế nào cũng được; chúng được squash khi merge.
- `git pull --rebase` trước khi push. Không force push `main`.

## Pull request

- Tiêu đề bằng tiếng Anh theo Conventional Commits: `type(scope): description`, ví dụ
  `feat(workflow): add BPMN engine to the core`. Type: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`.
  Scope: `core`, `gateway`, `identity`, `data`, `workflow`, `iot`, `ai`, `app`, `ci`.
- Thân bằng tiếng Việt, theo mẫu: Tóm tắt (1–3 câu, đọc riêng vẫn hiểu pull request làm gì và được gì), thay đổi
  gì, vì sao, đã kiểm tra thế nào, `Closes #<issue>`. Thân trở thành thân commit trên `main`, nên người đọc
  `git log` không phải mở issue mới hiểu.
- Không trailer AI (xem AGENTS.md mục 4).
- Một pull request, một thay đổi. Nhắm dưới khoảng 500 dòng thay đổi, không tính tệp sinh tự động, test và dữ liệu.
- Người dùng thấy được thay đổi thì thêm một mục 1–3 dòng vào `Unreleased` trong `CHANGELOG.md` (quy tắc ở
  [AGENTS.md](AGENTS.md#4-git-nhánh-pull-request)).
- CI phải xanh và có một thành viên khác duyệt. Repo chỉ cho phép squash merge; nhánh tự xóa sau khi merge.

## Quyết định

Thay đổi kiến trúc, phạm vi, thành phần hay quy ước đi kèm một bản ghi trong [docs/adr/](docs/adr/README.md) ở cùng
pull request. Câu hỏi còn mở là issue gắn nhãn `needs-decision`.

## Giấy phép

Đóng góp của bạn phát hành theo [Apache License 2.0](LICENSE), như phần còn lại của dự án. Thành phần bên thứ ba mới
phải có giấy phép OSI và được ghi vào bảng giấy phép
([ADR 0002](docs/adr/0002-core-components.md)).
