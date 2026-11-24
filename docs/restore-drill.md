<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Diễn tập khôi phục trên máy trắng

Diễn tập trả lời: mất hẳn máy chủ, chỉ còn bản sao lưu và mã nguồn, thì dựng lại lõi mất bao lâu và có chạy đúng không.
Script: `scripts/restore-drill.sh`, gọi bằng `make restore-drill`. Lý do: [ADR 0036](adr/0036-pull-based-gitops-with-compose.md).

## Máy trắng là gì

Máy không còn container, volume, image hay bộ đệm build nào của lõi và không có `.env`; chỉ có Docker, các công cụ ở
[README](../README.md#chạy-từ-mã-nguồn), mã nguồn đúng bản và một thư mục do `make backup` tạo. Mọi image bên thứ ba
phải kéo lại từ registry, mọi image tự viết phải dựng lại (hay kéo từ GHCR khi `.env` trong bản sao lưu có
`MORTISE_NO_BUILD=1`, xem [deploy/README.md](../deploy/README.md)).

## Các giai đoạn

| Giai đoạn | Làm gì |
|---|---|
| `backup` | `make backup-under-load`: sao lưu trong lúc tải tệp lên liên tục qua cổng; bỏ qua khi có `FROM=` |
| `wipe` | `docker compose down -v --rmi all` (gồm profile `tools`, `simulator`; không đụng profile `ai`: Ollama và mô hình đã tải giữ nguyên, chúng không nằm trong bản sao lưu), `docker builder prune -af`, cất `.env` thành `.env.before-drill` |
| `restore` | `make restore` không `make up` trước: tự dựng PostgreSQL, CSDL của Scorpio, nạp dữ liệu, kéo hay dựng mọi image, dựng lõi, kiểm nhật ký và kho tệp |
| `smoke` | `make smoke` trên lõi vừa khôi phục, không seed lại |

Mỗi giai đoạn đo bằng `date +%s` (đơn vị giây). Báo cáo markdown in ra màn hình và, trên CI, vào tóm tắt của lần chạy
(`$GITHUB_STEP_SUMMARY`): ngày giờ UTC, bản (`git describe`), số CPU, RAM, phiên bản Docker, cỡ bản sao lưu, số giây
từng giai đoạn và kết quả. Giai đoạn `restore` gồm cả thời gian tải image, nên phụ thuộc mạng của máy chạy.

## Chạy lại

- **CI:** job `restore-drill` của `ci.yml` chạy trên một runner mới mỗi khi pull request đổi phần mà sao lưu, khôi phục
  phụ thuộc, và mỗi lần push lên main hay gắn tag phát hành: `make up`, `make seed`, `make smoke`, rồi
  `make restore-drill CONFIRM=yes`. Bản sao lưu chứa `.env` nên không bao giờ được tải lên làm artifact.
- **Máy đang chạy lõi:** `make restore-drill CONFIRM=yes`. Lệnh XÓA toàn bộ dữ liệu và image của lõi trên máy, và xóa
  bộ đệm build của Docker cho mọi dự án trên máy. Cần lõi đang chạy và đã `make seed`.
- **Máy mới:** chép thư mục sao lưu sang, clone repo, checkout đúng commit ghi ở `git_commit` trong `MANIFEST` của bản
  sao lưu, rồi `make restore-drill FROM=<thư mục sao lưu> CONFIRM=yes`.

Khôi phục xong, `.env` là bản trong sao lưu; `.env.before-drill` chỉ còn lại khi khác bản đó.

## Kết quả

Thêm một dòng cho mỗi lần chạy đáng ghi, chép từ báo cáo của script.

| Ngày (UTC) | Nơi chạy | Bản | CPU / RAM | Docker | Cỡ sao lưu | Sao lưu (s) | Xóa (s) | Khôi phục (s) | Smoke (s) | Kết quả |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-24 14:23 | runner `ubuntu-latest` của GitHub Actions, CI của PR #174 | `1c23fba` | 4 / 15,6 GiB | 29.4.2 | 244K | 43 | 30 | 141 | 49 | Qua |
