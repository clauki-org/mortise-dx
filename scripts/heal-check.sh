#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Bài kiểm tự phục hồi: làm tiến trình chính của một dịch vụ tự thoát, kiểm Docker dựng lại đúng container đó đúng
# một lần theo `restart: unless-stopped` của compose.yaml, dịch vụ khỏe lại trong HEAL_TIMEOUT giây, rồi chạy smoke.
# Gọi qua `make heal-check SERVICE=<dịch vụ>`; CI chạy sau smoke ở job e2e và ở bước kiểm bản phát hành.
#
# Cách làm dịch vụ "chết" đã chọn sau khi thử trên container riêng (Docker 29.7.2, ngày 2026-11-24):
# - `docker kill` và `docker stop` (cả `docker compose stop`) được Docker coi là người vận hành chủ động dừng: container
#   nằm ở trạng thái exited, RestartCount giữ nguyên. Đó là thiết kế của Docker, không phải lỗi của lõi.
# - Gửi SIGTERM tới PID 1 từ trong container: nhân bỏ qua tín hiệu tới PID 1 nếu tiến trình không cài bộ xử lý (thử
#   với Python không cài bộ xử lý: container chạy tiếp; iot-bridge chạy Python thẳng như vậy). Với uvicorn (thử trên
#   image workflow-api; files-api, context-api, assistant cũng chạy uvicorn) và nginx (image của web), tiến trình thoát,
#   Docker dựng lại, RestartCount tăng 1. Đó là đường giống một lần dịch vụ sập thật nên bài kiểm dùng nó.
# Restart policy không xử lý container còn chạy nhưng healthcheck báo unhealthy: Docker chỉ dựng lại khi tiến trình thoát.
set -euo pipefail
cd "$(dirname "$0")/.."

service="${1:-workflow-api}"
timeout="${HEAL_TIMEOUT:-60}"

inspect() { docker inspect -f "$1" "$container"; }

container=$(docker compose ps -q "$service" 2>/dev/null || true)
if [[ -z "$container" || "$(inspect '{{.State.Status}}')" != running ]]; then
  echo "Dịch vụ $service không chạy. Chạy 'make up' trước khi kiểm tự phục hồi." >&2
  exit 1
fi
if [[ "$(inspect '{{.HostConfig.RestartPolicy.Name}}')" != unless-stopped ]]; then
  echo "Dịch vụ $service không có restart: unless-stopped trong compose.yaml, Docker sẽ không dựng lại nó." >&2
  exit 1
fi
before=$(inspect '{{.RestartCount}}')
started=$(inspect '{{.State.StartedAt}}')

echo "Gửi SIGTERM tới tiến trình chính của $service (RestartCount trước: $before)…"
# Container có thể dừng trước khi exec kịp trả mã thoát; kết quả đo bằng RestartCount bên dưới, không bằng mã này.
docker compose exec -T "$service" sh -c 'kill -TERM 1' || true

# Chờ Docker dựng lại container và healthcheck báo healthy. Dịch vụ không có healthcheck thì chỉ chờ trạng thái running.
deadline=$((SECONDS + timeout))
count=$before health=
while ((SECONDS < deadline)); do
  count=$(inspect '{{.RestartCount}}')
  health=$(inspect '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')
  if ((count > before + 1)); then
    echo "FAIL  $service bị dựng lại $((count - before)) lần: dịch vụ sập lại sau khi lên. Xem 'docker compose logs $service'." >&2
    exit 1
  fi
  # StartedAt đổi: trạng thái đọc được là của lần chạy mới, không phải "healthy" còn sót của lần chạy cũ.
  if ((count == before + 1)) && [[ "$(inspect '{{.State.StartedAt}}')" != "$started" ]] &&
    [[ "$health" == healthy || "$health" == running ]]; then
    break
  fi
  sleep 1
done
if ((count == before)); then
  echo "FAIL  $service không được dựng lại trong ${timeout}s: tiến trình chính không thoát khi nhận SIGTERM" \
    "(không có bộ xử lý tín hiệu), nên bài kiểm này không áp dụng cho dịch vụ đó." >&2
  exit 1
fi
if [[ "$health" != healthy && "$health" != running ]]; then
  echo "FAIL  $service đã được dựng lại nhưng chưa khỏe sau ${timeout}s (trạng thái: $health)." \
    "Xem 'docker compose logs $service'; tăng HEAL_TIMEOUT nếu máy chậm." >&2
  exit 1
fi
echo "PASS  $service tự lên lại sau khi tiến trình chính thoát (RestartCount $before → $count, trạng thái $health)"

scripts/smoke.sh
