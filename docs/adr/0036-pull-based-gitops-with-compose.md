<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0036. Phát hành theo tag, máy chủ tự kéo bản mới về chạy bằng Docker Compose, smoke lỗi thì quay về tag trước

- Trạng thái: Chấp nhận
- Ngày: 2026-11-24

## Bối cảnh

Lõi chạy bằng Docker Compose ([ADR 0002](0002-core-components.md)); máy chủ demo trước đây được dựng tay từ mã nguồn,
không biết đang chạy bản nào, không có cách quay về. Repo chưa có bản phát hành nào.

Điều cần giữ:

- Một bản phát hành là một tag git; máy chủ chạy đúng image đã qua CI của tag đó, không dựng lại tại chỗ.
- Máy chủ không mở cổng nào cho CI và không giữ khóa nào của CI; CI không giữ khóa vào máy chủ.
- Bản mới lỗi thì tự quay về bản trước mà không cần người.
- Không thêm thành phần phải vận hành riêng; người vận hành hiện chỉ cần Docker, git, make.

Các lựa chọn đã xét:

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Ai đưa bản mới lên máy chủ | CI đẩy qua SSH sau khi dựng | CI giữ khóa SSH vào máy chủ, máy chủ phải mở cổng cho runner; lộ khóa là lộ máy chủ |
| | Máy chủ tự kéo theo lịch (GitOps kéo về) | Không cổng vào, không khóa; máy chủ chỉ đọc repo và registry công khai |
| Công cụ kéo về | Argo CD, Flux | Cần Kubernetes; lõi chưa chạy trên Kubernetes |
| | Trình quản lý container khác (cụm Swarm, công cụ tự cập nhật image) | Thêm thành phần, và tự cập nhật theo image thì không biết migration, seed, smoke của bản |
| | Script trong repo, systemd timer gọi | Dùng đúng `make seed`, `make app-install`, `make smoke` như CI; đọc được trong một tệp |
| Dựng image | Máy chủ dựng từ mã nguồn của tag | Image phụ thuộc lúc dựng (bản vá của image nền), không phải image đã qua CI |
| | CI dựng, đẩy lên GitHub Container Registry theo tag | Máy chủ chạy đúng image đã kiểm; registry đi kèm repo, không thêm tài khoản |
| Đổi compose cho bản phát hành | Lớp chồng `deploy/compose.release.yaml` xóa `build` bằng `!reset` | Hành xử khác nhau giữa các bản Compose: trên runner CI (Compose v5.1.3, ngày 2026-11-24) cả tám dịch vụ vẫn còn `build`, trên v5.4.0 thì bị xóa; máy chủ có bản Compose khác sẽ lặng lẽ dựng tại chỗ |
| | `image:` có biến cạnh `build:` trong compose.yaml, một cờ cấm dựng | Một tệp compose cho mọi nơi; tên image đổi theo biến, lệnh nào có thể dựng đều qua một lối gọi |

Đã thử trên Docker 29.7.2 với container riêng (ngày 2026-11-24) cách làm một dịch vụ "sập" để kiểm tự phục hồi:
`docker kill` và `docker stop` để container ở trạng thái exited, RestartCount không đổi, dù `restart: unless-stopped`;
SIGTERM gửi tới PID 1 từ trong container bị bỏ qua khi tiến trình không cài bộ xử lý tín hiệu; với tiến trình có bộ xử
lý (thoát khi nhận SIGTERM), Docker dựng lại container và RestartCount tăng 1.

Đã thử Compose v5.4.0 (ngày 2026-11-24) với dịch vụ có cả `build` và `image`: thiếu image thì `up` thử kéo trước rồi
mới dựng; `up --no-build` kéo được thì kéo, không thì báo lỗi; `run` dựng image còn thiếu kể cả với
`--pull never|missing|always`.

## Quyết định

- **Tag và ghi chú.** Bản phát hành là tag `vX.Y.Z` trên một commit của main; ghi chú là mục `## [X.Y.Z]` của
  `CHANGELOG.md` (`scripts/release-notes.sh`), thiếu mục thì không phát hành; mục có đoạn tóm tắt trước tiêu đề `###`
  đầu tiên thì trang Release chỉ hiện đoạn đó kèm liên kết tới CHANGELOG của tag. `vX.Y.Z-rc.N` là bản thử: GitHub Release
  đánh dấu prerelease, ghi chú lấy mục `## [X.Y.Z]` nếu đã cắt, chưa thì lấy `## [Unreleased]`.
- **CI phát hành** (`.github/workflows/release.yml`): kiểm commit nằm trên main và có ghi chú → chạy lại toàn bộ
  `ci.yml` → dựng image mọi dịch vụ có `build` trong compose.yaml (linux/amd64), đẩy lên
  `ghcr.io/clauki-org/mortise-dx/<dịch vụ>:<tag>` bằng `GITHUB_TOKEN`, kèm nhãn OCI nguồn, phiên bản, commit → trên
  runner mới, không đăng nhập, với `MORTISE_NO_BUILD=1`, kéo đúng các image đó, `make up`, `make seed`, `make smoke`,
  `make heal-check`, kiểm mọi image tự viết mang nhãn revision của commit và có digest của registry → tạo GitHub
  Release, đính kèm gói mã nguồn `mortise-dx-<tag>.tar.gz` (`git archive`, định dạng mở) và `SHA256SUMS`. Quyền mặc định chỉ đọc; chỉ job đẩy image có `packages: write`, chỉ job tạo Release có
  `contents: write`.
- **Tên image và cờ cấm dựng.** Tám dịch vụ tự viết có
  `image: ${MORTISE_IMAGE_PREFIX:-mortise.invalid}/<dịch vụ>:${MORTISE_VERSION:-dev}` cạnh `build`. Máy phát triển
  dựng như trước; tiền tố mặc định thuộc miền `.invalid` không bao giờ phân giải được, nên lần Compose thử kéo trước khi
  dựng không thể lấy image của người khác (trên Docker Hub đã có tài khoản tên `mortise`). Máy chủ đặt
  `MORTISE_IMAGE_PREFIX=ghcr.io/clauki-org/mortise-dx`, `MORTISE_VERSION=<tag>`, `MORTISE_NO_BUILD=1` trong .env. Mọi
  `up` và `run` có thể dựng image đi qua `scripts/compose.sh`: với cờ đó, image tự viết phải có trên máy hoặc kéo được,
  không thì dừng, không bao giờ dựng. Image bên thứ ba giữ phiên bản ghim. `make check-fast` kiểm tên image theo tiền
  tố và không lệnh nào gọi `--build`, `docker compose run` dịch vụ tự viết hay `docker compose up` cả lõi ngoài lối đó.
- **Máy chủ kéo về** (`deploy/pull-deploy.sh`, `mortise-deploy.timer` mỗi 15 phút): tag đích là `MORTISE_PIN` hoặc
  GitHub Release mới nhất không phải bản thử. Kéo image của tag đích trong một worktree riêng trước; kéo lỗi thì chưa
  đụng gì, lần sau thử lại. Sau đó sao lưu, checkout tag, ghi ba biến trên vào .env, tạo lại mọi container (tệp
  cấu hình gắn từng tệp như routes của APISIX vẫn trỏ vào nội dung cũ sau checkout nếu container không được tạo lại),
  `make seed`, cài các gói trong `MORTISE_APPS`, smoke lõi và smoke từng gói. Lỗi thì checkout tag trước, dựng lại, seed, smoke, ghi tag
  đích vào danh sách lỗi để không thử lại.
- **CSDL không tự khôi phục.** Quay về chỉ đổi image và mã; migration của bản lỗi có thể đã chạy, script in lệnh
  `make restore` với bản sao lưu vừa làm để người vận hành quyết định.
- **Tự phục hồi dựa vào restart policy của Docker.** `make heal-check` gửi SIGTERM tới PID 1 của dịch vụ từ trong
  container, kiểm RestartCount tăng đúng 1, dịch vụ khỏe lại trong `HEAL_TIMEOUT`, rồi smoke; chạy trong job e2e và ở
  bước kiểm bản phát hành.
- **Diễn tập khôi phục** (`make restore-drill`) chạy trong CI trên máy trắng, đo thời gian từng giai đoạn; kết quả ghi
  ở [docs/restore-drill.md](../restore-drill.md). Vòng sao lưu, khôi phục cũ trong job e2e được thay bằng job này.

## Hệ quả

- Mỗi bản phát hành có trang Release, danh sách thay đổi và image cố định trên registry; máy chủ biết mình đang chạy tag
  nào (`/var/lib/mortise-deploy/current`).
- Quay về tự động chỉ bao phủ image và mã. Bản mới có migration không tương thích ngược thì bản cũ có thể không chạy
  trên CSDL đã nâng; khi đó phải khôi phục bản sao lưu. Ghim về tag cũ (`MORTISE_PIN`) cũng chỉ đổi image.
- Smoke ghi dữ liệu demo (tài khoản, hồ sơ, tệp), nên cách triển khai này chỉ dành cho máy chủ demo. Bản cài có dữ liệu
  thật cần smoke chỉ đọc, chưa có.
- Restart policy chỉ dựng lại container khi tiến trình thoát: container còn chạy mà healthcheck báo unhealthy không được
  dựng lại; dừng bằng `docker stop`, `docker compose stop` hay `docker kill` cũng không (đúng thiết kế của Docker).
  Dịch vụ chạy Python trực tiếp làm PID 1 (iot-bridge) không thoát khi nhận SIGTERM nên bài kiểm không áp dụng cho nó.
- Keycloak trên máy chủ demo vẫn chạy `start-dev`, chỉ dành cho phát triển; chuyển sang chế độ chạy thật là việc riêng.
- Gói image mới đẩy lần đầu lên GHCR có thể ở chế độ riêng tư; máy chủ và bước kiểm kéo không đăng nhập, nên lần đầu
  phải đặt từng gói thành Public.
- Máy chủ hỏi API công khai của GitHub, giới hạn 60 lần mỗi giờ theo địa chỉ IP; bộ hẹn giờ 15 phút dùng 4 lần.
- Chuyển lõi lên Kubernetes thì Argo CD là hướng thay cho script này: cùng mô hình kéo về từ git, có sẵn quay về và
  theo dõi lệch cấu hình.
