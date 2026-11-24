#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Diễn tập khôi phục trên máy trắng (docs/restore-drill.md): sao lưu trong lúc đang tải tệp lên, xóa sạch container,
# volume, image và bộ đệm build, cất .env sang bên, rồi khôi phục mà không `make up` trước (restore.sh tự dựng CSDL, tự
# kéo hay dựng image), cuối cùng smoke. Đo từng giai đoạn bằng `date +%s` và in báo cáo markdown ra màn hình, kèm
# $GITHUB_STEP_SUMMARY khi chạy trên CI. Máy mới chưa có lõi: FROM=<thư mục sao lưu> bỏ qua giai đoạn sao lưu.
# XÓA mọi dữ liệu của lõi trên máy và toàn bộ bộ đệm build của Docker trên máy, nên cần CONFIRM=yes.
# Gọi qua `make restore-drill [FROM=<thư mục>] CONFIRM=yes`.
set -euo pipefail
cd "$(dirname "$0")/.."

from="${1:-}"
if [[ "${CONFIRM:-}" != yes ]]; then
  echo "Diễn tập xóa toàn bộ dữ liệu, image của lõi và bộ đệm build của Docker trên máy này." \
    "Chạy lại với CONFIRM=yes để tiếp tục." >&2
  exit 1
fi
if [[ -n "$from" && ! -f "$from/SHA256SUMS" ]]; then
  echo "FROM=$from không phải thư mục do 'make backup' tạo (thiếu SHA256SUMS)." >&2
  exit 1
fi

declare -A took=()
result=FAIL
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
revision=$(git describe --tags --always --dirty 2>/dev/null || echo unknown)

# phase TÊN LỆNH...: chạy một giai đoạn, ghi số giây. Không gọi trong `if` hay `||`: set -e phải còn hiệu lực trong các
# hàm bên dưới, để sao lưu lỗi thì dừng trước khi xóa. Lỗi thì báo cáo (trap EXIT) ghi giai đoạn đang chạy là lỗi.
running=
phase() {
  running="$1"
  shift
  echo "== $running"
  started=$(date +%s)
  "$@"
  took[$running]=$(($(date +%s) - started))
  running=
}

backup() {
  BACKUP_DIR="${BACKUP_DIR:-$(mktemp -d)}"
  export BACKUP_DIR
  scripts/backup-under-load.sh
  from=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)
}

# .env cất sau cùng: `docker compose down` cần nó để nội suy các biến bắt buộc của compose.yaml (máy mới chưa có .env
# thì dùng .env.example, không có gì để xóa). .env không bị xóa, để người vận hành còn lấy lại khi khôi phục hỏng;
# restore.sh cài .env của bản sao lưu.
wipe() {
  local env_file=.env
  [[ -f .env ]] || env_file=.env.example
  docker compose --env-file "$env_file" --profile tools --profile simulator down -v --rmi all --remove-orphans
  docker builder prune -af >/dev/null
  if [[ -f .env ]]; then mv .env .env.before-drill; fi
}

restore() { CONFIRM=yes scripts/restore.sh "$from"; }

report() {
  local mem size=unknown name
  [[ -z "$running" ]] || took[$running]="lỗi sau $(($(date +%s) - started))"
  mem=$(awk '/^MemTotal:/ { printf "%.1f GiB", $2 / 1048576 }' /proc/meminfo 2>/dev/null || echo unknown)
  [[ -z "$from" || ! -d "$from" ]] || size=$(du -sh "$from" | cut -f1)
  {
    echo "### Diễn tập khôi phục: $result"
    echo
    echo "| Mục | Giá trị |"
    echo "|---|---|"
    echo "| Bắt đầu (UTC) | $started_at |"
    echo "| Bản | \`$revision\` |"
    echo "| CPU (nproc) | $(nproc) |"
    echo "| RAM | $mem |"
    echo "| Docker | $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo unknown) |"
    echo "| Cỡ bản sao lưu | $size |"
    for name in backup wipe restore smoke; do
      echo "| Giai đoạn $name (giây) | ${took[$name]:-không chạy} |"
    done
  } | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
}
trap report EXIT

if [[ -z "$from" ]]; then phase backup backup; fi
phase wipe wipe
phase restore restore
phase smoke scripts/smoke.sh
result=PASS
# Khôi phục xong, .env là bản trong sao lưu; bản đã cất chỉ còn giữ khi hai bản khác nhau.
if [[ -f .env.before-drill ]] && cmp -s .env .env.before-drill; then rm -f .env.before-drill; fi
