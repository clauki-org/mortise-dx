#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# In ghi chú phát hành của một bản từ CHANGELOG.md: phần thân của mục `## [X.Y.Z]`, không kèm tiêu đề và các dòng liên
# kết so sánh ở cuối tệp. .github/workflows/release.yml dùng nó làm nội dung trang GitHub Release; thiếu mục hay mục
# rỗng thì thoát lỗi để không phát hành bản không có danh sách thay đổi.
# Bản thử (`vX.Y.Z-rc.N`) lấy mục `## [X.Y.Z]` nếu đã cắt, chưa có thì lấy `## [Unreleased]`.
# Cách dùng: scripts/release-notes.sh v0.1.0 [CHANGELOG.md]
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  echo "Cách dùng: scripts/release-notes.sh <phiên bản, ví dụ v0.1.0 hay v0.1.0-rc.1> [tệp changelog]" >&2
  exit 2
}

# section TIÊU_ĐỀ TỆP: in các dòng sau đúng tiêu đề `## [TIÊU_ĐỀ]` tới mục kế tiếp hay khối liên kết cuối tệp, bỏ dòng
# trống ở đầu và cuối. Không có tiêu đề thì không in gì.
section() {
  awk -v want="## [$1]" '
    index($0, want) == 1 && (length($0) == length(want) || substr($0, length(want) + 1, 1) == " ") { on = 1; next }
    on && (/^## \[/ || /^\[[^]]+\]: /) { exit }
    on { print }
  ' "$2" | sed -e '/./,$!d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
}

main() {
  local version="${1:-}" changelog="${2:-CHANGELOG.md}" number notes
  [[ "$version" =~ ^v?([0-9]+\.[0-9]+\.[0-9]+)(-rc\.[0-9]+)?$ ]] || usage
  number="${BASH_REMATCH[1]}"
  [[ -f "$changelog" ]] || { echo "Không thấy $changelog" >&2; exit 1; }
  notes=$(section "$number" "$changelog")
  if [[ -z "$notes" && -n "${BASH_REMATCH[2]}" ]] && ! grep -q "^## \[$number\]" "$changelog"; then
    notes=$(section Unreleased "$changelog")
  fi
  if [[ -z "$notes" ]]; then
    echo "CHANGELOG không có mục '## [$number]' hoặc mục rỗng: cắt mục từ Unreleased trước khi gắn tag $version." >&2
    exit 1
  fi
  printf '%s\n' "$notes"
}

main "$@"
