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
make check-fast   # giấy phép, cú pháp compose, shell, YAML; CI chạy đúng lệnh này
make help         # mọi lệnh
```

## Nhánh và commit

- Tạo nhánh từ `main`: `<type>/<mô-tả-ngắn>` hoặc `<type>/<issue>-<mô-tả>`, ví dụ `feat/12-cong-workflow`,
  `fix/20-token-het-han`, `docs/kien-truc`.
- Commit trong nhánh viết thế nào cũng được; chúng được squash khi merge.
- `git pull --rebase` trước khi push. Không force push `main`.

## Pull request

- Tiêu đề bằng tiếng Anh theo Conventional Commits: `type(scope): description`, ví dụ
  `feat(workflow): add BPMN engine to the core`. Type: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`.
  Scope: `core`, `gateway`, `identity`, `data`, `workflow`, `iot`, `ai`, `app`, `ci`.
- Thân bằng tiếng Việt: thay đổi gì, vì sao, đã kiểm tra thế nào, `Closes #<issue>`. Thân trở thành thân commit trên
  `main`.
- Không trailer AI (xem AGENTS.md mục 4).
- Một pull request, một thay đổi. Nhắm dưới khoảng 500 dòng thay đổi, không tính tệp sinh tự động, test và dữ liệu.
- Người dùng thấy được thay đổi thì thêm một dòng vào `Unreleased` trong `CHANGELOG.md`.
- CI phải xanh và có một thành viên khác duyệt. Repo chỉ cho phép squash merge; nhánh tự xóa sau khi merge.

## Quyết định

Thay đổi kiến trúc, phạm vi, thành phần hay quy ước đi kèm một bản ghi trong [docs/adr/](docs/adr/README.md) ở cùng
pull request. Câu hỏi còn mở là issue gắn nhãn `needs-decision`.

## Giấy phép

Đóng góp của bạn phát hành theo [Apache License 2.0](LICENSE), như phần còn lại của dự án. Thành phần bên thứ ba mới
phải có giấy phép OSI và được ghi vào bảng giấy phép
([ADR 0002](docs/adr/0002-chon-thanh-phan-loi.md)).
