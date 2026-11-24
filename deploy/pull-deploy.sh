#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kéo bản phát hành mới về máy chủ demo và chạy nó (ADR 0036). deploy/systemd/mortise-deploy.timer gọi định kỳ; máy
# chủ tự hỏi GitHub, không mở cổng nào cho CI. Trình tự: chọn tag đích (MORTISE_PIN, hoặc GitHub Release mới nhất
# không phải bản thử) → kéo image của tag đó trong một worktree riêng, chưa đụng gì tới bản đang chạy → sao lưu →
# checkout tag → dựng lại mọi container, `make seed`, cài các gói trong MORTISE_APPS → smoke lõi và smoke từng gói.
# Smoke lỗi thì checkout lại tag trước, dựng lại, ghi tag đích vào danh sách lỗi để không thử lại. CSDL không bao giờ tự
# khôi phục: migration của bản mới có thể đã chạy, script chỉ in lệnh `make restore` với bản sao lưu vừa làm.
# Mã thoát: 0 xong hoặc không có gì làm; 75 chưa sẵn sàng (mạng, image chưa có), lần hẹn sau thử lại; 1 bản mới lỗi và
# đã quay về bản trước; 2 quay về cũng lỗi, cần người vận hành.
# Toàn bộ logic nằm trong hàm và dòng cuối là `main "$@"; exit $?`: script nằm trong chính repo mà nó checkout, bash đã
# đọc hết hàm và lệnh gọi trước khi tệp trên đĩa bị thay, nên không chạy nhầm nửa cũ nửa mới.
set -euo pipefail

log() { printf '%s\n' "$*" >&2; }

# Cấu hình: /etc/mortise/deploy.env (deploy/deploy.env.example), đổi bằng MORTISE_DEPLOY_ENV khi thử.
# MORTISE_TAG_SOURCE=git lấy tag mới nhất trong git thay vì GitHub Release, chỉ dùng để thử script trên bản sao.
load_config() {
  local file="${MORTISE_DEPLOY_ENV:-/etc/mortise/deploy.env}"
  if [[ -f "$file" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$file"
    set +a
  fi
  : "${MORTISE_DIR:?đặt MORTISE_DIR (thư mục clone của repo) trong $file}"
  STATE_DIR="${STATE_DIR:-/var/lib/mortise-deploy}"
  BACKUP_DIR="${BACKUP_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mortise-dx/backups}"
  export BACKUP_DIR
  MORTISE_APPS="${MORTISE_APPS:-}"
  MORTISE_PIN="${MORTISE_PIN:-}"
  MORTISE_TAG_SOURCE="${MORTISE_TAG_SOURCE:-github}"
  MORTISE_IMAGE_PREFIX="${MORTISE_IMAGE_PREFIX:-ghcr.io/clauki-org/mortise-dx}"
}

state() { cat "$STATE_DIR/$1" 2>/dev/null || true; }
put_state() { printf '%s\n' "$2" >"$STATE_DIR/$1.tmp" && mv "$STATE_DIR/$1.tmp" "$STATE_DIR/$1"; }
is_failed() { grep -qxF "$1" "$STATE_DIR/failed" 2>/dev/null; }

# env_set KHÓA GIÁ_TRỊ: ghi một biến vào .env của bản cài, thay dòng cũ nếu có.
env_set() {
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >>.env; fi
}

# Bản đang chạy: tag ghi ở lần triển khai trước, hoặc MORTISE_VERSION trong .env của lần cài đầu theo deploy/README.md.
current_version() {
  local current
  current=$(state current)
  [[ -n "$current" ]] || current=$(sed -n 's/^MORTISE_VERSION=//p' .env 2>/dev/null)
  printf '%s' "$current"
}

# Tên repo trên GitHub lấy từ MORTISE_REPO hoặc địa chỉ origin, để bản fork tự hỏi đúng repo của mình.
github_repo() {
  local repo="${MORTISE_REPO:-}"
  [[ -n "$repo" ]] || repo=$(git remote get-url origin | sed -E 's#^.*github\.com[:/]##; s#\.git$##')
  if [[ ! "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    log "origin không phải repo GitHub; đặt MORTISE_REPO=<chủ>/<repo> trong tệp cấu hình."
    return 1
  fi
  printf '%s' "$repo"
}

# Tag phát hành mới nhất; không in gì khi chưa có bản nào. /releases/latest của GitHub bỏ qua bản nháp và bản thử.
latest_release() {
  local body code repo
  if [[ "$MORTISE_TAG_SOURCE" == git ]]; then
    git tag -l 'v*' --sort=-v:refname | grep -Ev -- '-' | head -1 || true
    return
  fi
  repo=$(github_repo) || return 1
  body=$(mktemp)
  # Không token: API công khai cho 60 lần mỗi giờ theo địa chỉ IP, đủ cho bộ hẹn giờ 15 phút; vượt thì trả 403.
  code=$(curl -sS -o "$body" -w '%{http_code}' -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$repo/releases/latest") || code=000
  case "$code" in
    200) jq -r '.tag_name // empty' "$body" ;;
    404) ;;
    *) log "Không hỏi được GitHub Release (HTTP $code); lần hẹn sau thử lại."; rm -f "$body"; return 1 ;;
  esac
  rm -f "$body"
}

resolve_target() {
  local target="$MORTISE_PIN"
  [[ -n "$target" ]] || target=$(latest_release) || return 1
  if [[ -n "$target" && ! "$target" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$ ]]; then
    log "Tag '$target' không đúng dạng vX.Y.Z hay vX.Y.Z-rc.N."
    return 1
  fi
  printf '%s' "$target"
}

# Kéo image của tag đích trong worktree riêng, khi bản đang chạy chưa bị đụng tới: image chưa có thì không sao lưu, không
# dừng gì. Worktree cần .env đủ biến của bản mới để Compose nội suy, nên chép .env rồi chạy make-env.sh của bản mới
# (thêm biến mới với giá trị tạm, chỉ dùng cho lần kéo này). Trả 2 khi tag không triển khai được theo cách này.
prepull() {
  local tag="$1" stage="$STATE_DIR/stage" rc=0
  git worktree remove --force "$stage" 2>/dev/null || rm -rf "$stage"
  git worktree add --quiet --detach "$stage" "$tag" || return 1
  if [[ ! -x "$stage/scripts/compose.sh" ]]; then
    log "Tag $tag chưa có scripts/compose.sh, không triển khai bằng image phát hành được."
    rc=2
  else
    (umask 077 && cp .env "$stage/.env" && cd "$stage" && scripts/make-env.sh >/dev/null &&
      MORTISE_IMAGE_PREFIX="$MORTISE_IMAGE_PREFIX" MORTISE_VERSION="$tag" MORTISE_NO_BUILD=1 scripts/compose.sh pull) ||
      rc=1
  fi
  git worktree remove --force "$stage" 2>/dev/null || rm -rf "$stage"
  git worktree prune
  return "$rc"
}

# Sao lưu khi lõi đang chạy, lúc mã và .env còn khớp bản đang chạy (backup.sh ghi commit và chép .env vào bản sao lưu).
take_backup() {
  if [[ -z "$(docker compose ps --status running -q 2>/dev/null)" ]]; then
    log "Lõi không chạy, bỏ qua sao lưu."
    return 0
  fi
  make backup || return 1
  put_state last_backup "$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)"
}

# switch_to TAG: checkout tag, bổ sung biến mới vào .env, trỏ Compose sang image phát hành của tag (không dựng tại
# chỗ), dựng lại. --force-recreate thay cho `make up`: cấu hình gắn từng tệp (routes của APISIX, Mosquitto) trỏ vào
# inode cũ sau khi git thay tệp, và `up` không tạo lại container có định nghĩa không đổi, nên bản mới sẽ chạy với cấu
# hình của bản cũ.
switch_to() {
  git checkout --quiet --detach "$1" &&
    make env &&
    env_set MORTISE_IMAGE_PREFIX "$MORTISE_IMAGE_PREFIX" &&
    env_set MORTISE_VERSION "$1" &&
    env_set MORTISE_NO_BUILD 1 &&
    scripts/compose.sh up -d --wait --force-recreate --remove-orphans && make seed
}

install_apps() {
  local app
  for app in $MORTISE_APPS; do make app-install APP="$app" || return 1; done
}

smoke_all() {
  local app
  make smoke || return 1
  for app in $MORTISE_APPS; do make app-smoke APP="$app" || return 1; done
}

restore_hint() {
  local backup
  backup=$(state last_backup)
  [[ -n "$backup" ]] || return 0
  log "CSDL KHÔNG được tự khôi phục. Nếu migration của $1 đã làm hỏng dữ liệu, khôi phục bản sao lưu trước khi triển khai:"
  log "  cd $MORTISE_DIR && make restore FROM=$backup CONFIRM=yes"
}

# Bản mới lỗi: ghi vào danh sách lỗi trước, để dù quay về cũng lỗi thì lần hẹn sau không thử lại bản đó.
roll_back() {
  local target="$1" previous="$2"
  printf '%s\n' "$target" >>"$STATE_DIR/failed"
  if [[ -z "$previous" ]]; then
    log "Bản $target lỗi và không có bản trước để quay về."
    restore_hint "$target"
    return 1
  fi
  log "Bản $target lỗi, quay về $previous."
  if switch_to "$previous" && smoke_all; then
    log "Đã quay về $previous. Bỏ $target khỏi $STATE_DIR/failed để thử lại sau khi sửa."
    restore_hint "$target"
    return 1
  fi
  log "Quay về $previous cũng lỗi; lõi có thể đang dở dang. Xem 'docker compose ps' và log của từng dịch vụ."
  restore_hint "$target"
  return 2
}

main() {
  local target current rc=0
  load_config
  mkdir -p "$STATE_DIR"
  exec 9>"$STATE_DIR/lock"
  flock -n 9 || { log "Một lần triển khai khác đang chạy."; return 0; }
  cd "$MORTISE_DIR"
  git fetch --quiet --tags --force origin || { log "Không fetch được origin; lần hẹn sau thử lại."; return 75; }
  target=$(resolve_target) || return 75
  current=$(current_version)
  if [[ -z "$target" ]]; then log "Chưa có bản phát hành nào."; return 0; fi
  if [[ "$target" == "$current" ]]; then log "Đang chạy $target, không có gì làm."; return 0; fi
  if is_failed "$target"; then log "Bỏ qua $target: đã lỗi lần trước (xem $STATE_DIR/failed)."; return 0; fi
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    log "Thư mục $MORTISE_DIR có thay đổi chưa commit; không checkout đè lên. Xem 'git status'."
    return 1
  fi
  log "Triển khai $target (đang chạy: ${current:-chưa có})."
  prepull "$target" || rc=$?
  if ((rc == 2)); then printf '%s\n' "$target" >>"$STATE_DIR/failed"; return 1; fi
  if ((rc != 0)); then log "Chưa kéo được image của $target; lần hẹn sau thử lại."; return 75; fi
  take_backup || { log "Sao lưu lỗi, không triển khai $target."; return 1; }
  if switch_to "$target" && install_apps && smoke_all; then
    put_state previous "$current"
    put_state current "$target"
    log "Đã triển khai $target."
    return 0
  fi
  roll_back "$target" "$current"
}

main "$@"; exit $?
