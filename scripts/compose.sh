#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Lối gọi `docker compose up`, `run` và `pull` duy nhất cho các lệnh đụng tới dịch vụ tự viết (có `build` trong
# compose.yaml), để máy chủ chạy bản phát hành không bao giờ lặng lẽ dựng image tại chỗ (ADR 0036).
# - Máy phát triển và CI: `up` như trước, `run` dựng lại image trước khi chạy.
# - MORTISE_NO_BUILD=1 (trong .env hay môi trường, máy chủ demo): image tự viết phải có sẵn hoặc kéo được từ
#   MORTISE_IMAGE_PREFIX với tag MORTISE_VERSION; thiếu mà không kéo được thì dừng.
# Không dựa riêng vào flag của Compose: với Compose v5.4.0 (thử ngày 2026-11-24), `run` dựng image còn thiếu cả khi có
# `--pull never|missing|always`, chỉ `up --no-build` là từ chối dựng; nên image được kiểm bằng `docker image inspect`.
# Cách dùng:
#   scripts/compose.sh up [tham số của docker compose up...]
#   scripts/compose.sh run <profile> <dịch vụ> [tham số...]
#   scripts/compose.sh pull       kéo mọi image (profile tools, simulator) rồi kiểm image tự viết đã có trên máy
set -euo pipefail
cd "$(dirname "$0")/.."

no_build() {
  local value="${MORTISE_NO_BUILD:-}"
  [[ -n "$value" ]] || value=$(sed -n 's/^MORTISE_NO_BUILD=//p' .env 2>/dev/null | tail -1)
  [[ "$value" == 1 ]]
}

# Dịch vụ có build trong compose.yaml, ở mọi profile.
built_services() {
  docker compose --profile '*' config --format json |
    python3 -c 'import json, sys; print("\n".join(n for n, s in json.load(sys.stdin)["services"].items() if "build" in s))'
}

# require_images DỊCH_VỤ...: image phải có trên máy; thiếu thì kéo một lần, vẫn thiếu thì dừng thay vì để Compose dựng.
require_images() {
  local service image
  for service in "$@"; do
    # Không dùng `config --images DỊCH_VỤ`: lệnh đó in cả image của các dịch vụ trong depends_on.
    image=$(docker compose --profile '*' config --format json |
      python3 -c 'import json, sys; print(json.load(sys.stdin)["services"][sys.argv[1]]["image"])' "$service")
    docker image inspect "$image" >/dev/null 2>&1 || docker compose --profile '*' pull --quiet "$service" || true
    if ! docker image inspect "$image" >/dev/null 2>&1; then
      echo "Không có image $image và không kéo được. MORTISE_NO_BUILD=1 nên không dựng tại chỗ;" \
        "kiểm MORTISE_IMAGE_PREFIX, MORTISE_VERSION trong .env và đường mạng tới registry." >&2
      exit 1
    fi
  done
}

# MORTISE_TRACING thành tên bộ lấy mẫu của cổng (`always_<giá trị>`, compose.yaml); giá trị lạ làm cổng từ chối mọi
# API dưới /v1 với 503, nên dừng trước khi dựng (ADR 0038). Biến ở môi trường thắng .env như với compose.
check_tracing() {
  local value="${MORTISE_TRACING-$(sed -n 's/^MORTISE_TRACING=//p' .env 2>/dev/null | tail -1)}"
  case "$value" in
    on | off | "") ;;
    *)
      echo "MORTISE_TRACING chỉ nhận on hoặc off, đang là '$value'; sửa trong .env." >&2
      exit 1
      ;;
  esac
}

# Thư mục nền bản đồ mà web gắn vào (compose.yaml, ADR 0056). Thiếu thì Docker tự tạo, thuộc root, và `make basemap`
# chạy bằng người dùng thường không ghi vào được; nên tạo trước, trống cũng được (bản đồ vẽ nền trơn).
ensure_basemap_dir() {
  local dir="${MORTISE_BASEMAP_DIR-$(sed -n 's/^MORTISE_BASEMAP_DIR=//p' .env 2>/dev/null | tail -1)}"
  mkdir -p "${dir:-$HOME/.cache/mortise-dx/basemap}"
}

main() {
  local action="${1:-}" profile service
  shift || true
  case "$action" in
    up)
      check_tracing
      ensure_basemap_dir
      if no_build; then
        local services
        mapfile -t services < <(built_services)
        require_images "${services[@]}"
        exec docker compose up --no-build "$@"
      fi
      exec docker compose up "$@"
      ;;
    run)
      profile="${1:?Cách dùng: scripts/compose.sh run <profile> <dịch vụ> [tham số...]}"
      service="${2:?Cách dùng: scripts/compose.sh run <profile> <dịch vụ> [tham số...]}"
      shift 2
      if no_build; then
        require_images "$service"
        exec docker compose --profile "$profile" run --rm --quiet-pull --pull never "$service" "$@"
      fi
      exec docker compose --profile "$profile" run --rm --quiet-pull --build "$service" "$@"
      ;;
    pull)
      docker compose --profile tools --profile simulator pull --quiet
      local services
      mapfile -t services < <(built_services)
      require_images "${services[@]}"
      ;;
    *)
      echo "Cách dùng: scripts/compose.sh up|run|pull ..." >&2
      exit 2
      ;;
  esac
}

main "$@"
