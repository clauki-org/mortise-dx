#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# `make basemap` (ADR 0056): cắt nền bản đồ của một vùng từ bản dựng OpenStreetMap đã ghim trong
# platform/web/basemap.pins, kiểm SHA-256, rồi đặt vào thư mục mà web phục vụ ở /basemap/ (MORTISE_BASEMAP_DIR). Bản
# đồ đọc thư mục này ở lần mở sau, không cần dựng lại hay khởi động lại web. Chỉ đọc phần của vùng bằng yêu cầu Range,
# nên lần chạy đầu cần mạng nhưng không tải cả bản dựng. Không cần lõi đang chạy.
# Tham số (biến môi trường hay tham số của make):
#   BBOX=minLon,minLat,maxLon,maxLat  vùng khác vùng demo; cần thêm SHA256, lần đầu chạy không có để lệnh in băm
#   MINZOOM, MAXZOOM                   mức phóng (mặc định trong tệp ghim)
#   SHA256=<băm>                       băm mong đợi của tệp cắt ra, thay cho băm ghim
#   LABELS=on|off                      hiện chữ địa danh, tên đường; on tải thêm phông chữ đã ghim (mặc định off)
set -euo pipefail
cd "$(dirname "$0")/.."

pins=platform/web/basemap.pins
pin() { sed -n "s/^$1=//p" "$pins" | tail -1; }

source_url=$(pin SOURCE)
bbox="${BBOX:-$(pin BBOX)}"
minzoom="${MINZOOM:-$(pin MINZOOM)}"
maxzoom="${MAXZOOM:-$(pin MAXZOOM)}"
labels="${LABELS:-off}"

fail() {
  echo "$1" >&2
  exit 1
}

number='-?[0-9]+(\.[0-9]+)?'
[[ "$bbox" =~ ^$number,$number,$number,$number$ ]] || fail "BBOX phải là minLon,minLat,maxLon,maxLat, ví dụ $(pin BBOX)."
[[ "$minzoom" =~ ^[0-9]+$ && "$maxzoom" =~ ^[0-9]+$ && minzoom -le maxzoom && maxzoom -le 15 ]] ||
  fail "MINZOOM, MAXZOOM phải là số nguyên, MINZOOM không lớn hơn MAXZOOM, MAXZOOM tối đa 15 (mức cao nhất của nguồn)."
[[ "$labels" == on || "$labels" == off ]] || fail "LABELS chỉ nhận on hoặc off."

# Băm ghim chỉ đúng với đúng vùng và mức phóng đã ghim; vùng khác thì người vận hành phải đưa băm của mình.
want="${SHA256:-}"
if [[ -z "$want" && "$bbox" == "$(pin BBOX)" && "$minzoom" == "$(pin MINZOOM)" && "$maxzoom" == "$(pin MAXZOOM)" ]]; then
  want=$(pin SHA256)
fi

# Cùng cách chọn thư mục với compose.yaml: biến môi trường, rồi .env, rồi mặc định ngoài repo.
dir="${MORTISE_BASEMAP_DIR-$(sed -n 's/^MORTISE_BASEMAP_DIR=//p' .env 2>/dev/null | tail -1)}"
dir="${dir:-$HOME/.cache/mortise-dx/basemap}"
mkdir -p "$dir"
[[ -w "$dir" ]] || fail "Không ghi được vào $dir (có thể do Docker tạo, thuộc root): sudo chown $(id -u):$(id -g) $dir"

# Cắt vào thư mục tạm cạnh thư mục đích rồi mới đổi tên: web không bao giờ phục vụ tệp đang ghi dở hay chưa kiểm băm.
staging="$dir/.staging"
rm -rf "$staging"
mkdir -p "$staging"
trap 'rm -rf "$staging"' EXIT

echo "Cắt vùng $bbox, mức phóng $minzoom-$maxzoom từ $source_url"
if ! docker compose --profile tools run --rm --no-deps --user "$(id -u):$(id -g)" basemap \
  extract --quiet "$source_url" /basemap/.staging/region.pmtiles --bbox="$bbox" --minzoom="$minzoom" --maxzoom="$maxzoom"; then
  fail "Không cắt được nền bản đồ. Kiểm mạng của máy chủ tới ${source_url%/*}; nếu bản dựng đã bị gỡ, xem ADR 0056."
fi

got=$(sha256sum "$staging/region.pmtiles" | cut -d' ' -f1)
if [[ -z "$want" ]]; then
  fail "Tệp cắt ra có SHA-256 $got. Vùng này chưa có băm ghim: kiểm tệp rồi chạy lại với SHA256=$got."
fi
[[ "$got" == "$want" ]] ||
  fail "SHA-256 của tệp cắt ra là $got, khác $want. Nguồn hay công cụ đã đổi; không dùng tệp này (ADR 0056)."

if [[ "$labels" == on ]]; then
  fonts_url=$(pin FONTS)
  curl -fsSL --retry 2 -o "$staging/fonts.tar.gz" "$fonts_url" || fail "Không tải được phông chữ từ $fonts_url."
  got=$(sha256sum "$staging/fonts.tar.gz" | cut -d' ' -f1)
  [[ "$got" == "$(pin FONTS_SHA256)" ]] || fail "SHA-256 của gói phông là $got, khác băm ghim; không dùng gói này."
  # Chỉ lấy ba bộ phông mà kiểu vẽ dùng và giấy phép của chúng; không lấy script hay tệp khác trong gói.
  tar -xzf "$staging/fonts.tar.gz" -C "$staging" --strip-components=1 --no-same-owner --no-same-permissions \
    --wildcards '*/fonts/Noto Sans Regular/*' '*/fonts/Noto Sans Medium/*' '*/fonts/Noto Sans Italic/*' \
    '*/fonts/OFL.txt'
fi

printf '{"tiles": "region.pmtiles", "labels": %s}\n' "$([[ "$labels" == on ]] && echo true || echo false)" \
  >"$staging/basemap.json"

# basemap.json đổi sau cùng: tới lúc đó giao diện vẫn đọc cấu hình cũ, ứng với tệp cũ hay không có tệp nào.
mv -f "$staging/region.pmtiles" "$dir/region.pmtiles"
rm -rf "$dir/fonts"
[[ "$labels" == off ]] || mv "$staging/fonts" "$dir/fonts"
mv -f "$staging/basemap.json" "$dir/basemap.json"
echo "Nền bản đồ ở $dir ($(du -h "$dir/region.pmtiles" | cut -f1), SHA-256 $want, chữ: $labels)."
echo "Mở lại trang bản đồ để thấy nền; không cần khởi động lại web."
