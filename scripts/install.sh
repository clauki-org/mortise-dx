#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Dựng một bản cài theo mẫu presets/<mẫu>/preset.yaml bằng một lệnh (ADR 0058): kiểm mẫu, tạo .env, ghi mẫu và thư mục
# thương hiệu vào .env, dựng lõi, seed (gồm tenant và tài khoản của mẫu), cài các gói, nạp dữ liệu demo. Mọi bước đều
# chạy lại được, nên lỗi giữa chừng thì sửa rồi chạy lại cả lệnh. Tên dự án compose, cổng và URL công khai không do
# mẫu quyết định mà nằm trong .env, đặt trước lần cài đầu (README, mục chạy hai bản cài).
# Gọi qua Makefile: make install PRESET=<mẫu>.
set -euo pipefail
cd "$(dirname "$0")/.."

preset="${1:-}"
if [[ ! "$preset" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ || ! -f "presets/$preset/preset.yaml" ]]; then
  known=(presets/*/preset.yaml)
  known=("${known[@]#presets/}")
  echo "Cách dùng: make install PRESET=<mẫu>; mẫu có sẵn: ${known[*]%/preset.yaml}" >&2
  exit 1
fi
py=(uv run --quiet --no-project --with pyyaml==6.0.3 python)

# set_env TÊN GIÁ_TRỊ: thay dòng của biến trong .env. Makefile và các script đọc .env bằng `sed -n 's/^TÊN=//p'`, nên
# ghi thêm một dòng trùng tên thay vì thay sẽ để hai giá trị cùng sống.
set_env() {
  local tmp
  tmp=$(mktemp .env.install.XXXXXX)
  if grep -q "^$1=" .env; then
    while IFS= read -r line; do
      [[ "$line" == "$1="* ]] && line="$1=$2"
      printf '%s\n' "$line"
    done <.env >"$tmp"
  else
    cat .env >"$tmp"
    printf '%s=%s\n' "$1" "$2" >>"$tmp"
  fi
  chmod 600 "$tmp"
  mv "$tmp" .env
}

# Dự án compose cùng tên đang chạy từ thư mục khác là bản cài khác trên cùng máy: cài tiếp ở đây sẽ dựng lại container
# của nó bằng cấu hình và mẫu của checkout này. Chỉ đọc danh sách dự án, không đụng container. CONFIRM=yes bỏ qua
# khi cố ý dựng lại bản cài đó từ một worktree khác của cùng repo.
check_project() {
  local project
  [[ "${CONFIRM:-}" != yes ]] || return 0
  project=$(docker compose config --format json | python3 -c 'import json, sys; print(json.load(sys.stdin)["name"])')
  docker compose ls --all --format json | python3 -c '
import json, os, sys
name, here = sys.argv[1], os.path.realpath("compose.yaml")
for running in json.load(sys.stdin):
    files = [os.path.realpath(f) for f in running["ConfigFiles"].split(",")]
    where = running["ConfigFiles"]
    if running["Name"] == name and here not in files:
        sys.exit(f"Dự án compose {name} đang chạy từ {where}. Đặt COMPOSE_PROJECT_NAME, "
                 "MORTISE_PORT, MORTISE_PUBLIC_URL và các cổng quản trị khác trong .env của checkout này, hoặc cài "
                 "từ checkout đang chạy dự án đó; cố ý dựng lại dự án này từ đây thì thêm CONFIRM=yes.")
' "$project"
}

scripts/contracts.sh preset "presets/$preset/preset.yaml"
"${py[@]}" scripts/preset.py check "$preset"
scripts/make-env.sh

# Mọi bước sau đọc cùng một .env: compose để biến môi trường thắng .env, còn seed.sh, app.sh nạp .env đè lên, nên một
# biến còn sót trong shell sẽ làm lõi dựng với URL này mà Keycloak được seed với URL khác.
load_env() {
  set -a
  # shellcheck source=/dev/null
  source .env
  set +a
}
load_env
check_project

plan=$("${py[@]}" scripts/preset.py plan "$preset")
branding=$(sed -n 's/^branding //p' <<<"$plan")
mapfile -t packages < <(sed -n 's/^package //p' <<<"$plan")
mapfile -t demos < <(sed -n 's/^demo //p' <<<"$plan")

# Thương hiệu là thư mục compose gắn vào container web lúc dựng, nên phải ghi trước `up`.
set_env MORTISE_PRESET "$preset"
set_env MORTISE_BRANDING_DIR "$branding"
echo ".env: MORTISE_PRESET=$preset, MORTISE_BRANDING_DIR=$branding"
load_env

scripts/compose.sh up -d --wait
scripts/seed.sh
for package in "${packages[@]}"; do scripts/app.sh "$package" install; done

for demo in "${demos[@]}"; do
  read -r package data <<<"$demo"
  if [[ -n "$data" ]]; then
    "${py[@]}" scripts/app-seed.py "apps/$package" "$data"
  else
    make -s seed-demo APP="$package"
  fi
done
echo "Đã cài mẫu $preset tại $MORTISE_PUBLIC_URL"
