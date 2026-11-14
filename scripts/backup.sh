#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Sao lưu toàn bộ trạng thái của lõi vào một thư mục có dấu thời gian:
#   postgres.sql.gz  mọi CSDL và vai trò (Keycloak, Flowable, mortise kèm metadata Hasura)
#   seaweed.tar.gz   dữ liệu lưu trữ đối tượng
#   env              bản sao .env (mật khẩu vai trò CSDL trong bản dump khớp với tệp này)
#   MANIFEST, SHA256SUMS
# Khôi phục bằng scripts/restore.sh. Thư mục mặc định nằm ngoài repo để bản sao lưu
# chứa bí mật không bao giờ lọt vào git.
set -euo pipefail
cd "$(dirname "$0")/.."

root="${BACKUP_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mortise-dx/backups}"
dest="$root/$(date -u +%Y%m%dT%H%M%SZ)"

if [[ ! -f .env ]]; then
  echo "Không thấy .env: lõi chưa được dựng bằng 'make up' trong thư mục này." >&2
  exit 1
fi
if ! docker compose ps --status running --services | grep -qx postgres; then
  echo "PostgreSQL không chạy. Chạy 'make up' trước khi sao lưu." >&2
  exit 1
fi

umask 077
mkdir -p "$dest"
echo "Sao lưu vào $dest"

# pg_dumpall lấy một ảnh nhất quán cho từng CSDL trong khi dịch vụ vẫn chạy.
docker compose exec -T postgres pg_dumpall -U postgres --clean --if-exists | gzip >"$dest/postgres.sql.gz"
echo "  PostgreSQL: xong"

# SeaweedFS không có ảnh chụp nhất quán khi đang ghi, nên dừng nó trong lúc đóng gói.
# Dùng lại đúng image của dịch vụ để không thêm image mới chỉ để chạy tar.
docker compose stop seaweedfs >/dev/null
trap 'docker compose start seaweedfs >/dev/null' EXIT
docker compose run --rm --no-deps -T --entrypoint tar seaweedfs czf - -C /data . >"$dest/seaweed.tar.gz"
docker compose start seaweedfs >/dev/null
trap - EXIT
echo "  SeaweedFS: xong"

cp .env "$dest/env"
{
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "git_commit=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  docker compose config --images | sort | sed 's/^/image=/'
} >"$dest/MANIFEST"
(cd "$dest" && sha256sum postgres.sql.gz seaweed.tar.gz env MANIFEST >SHA256SUMS)

echo "Hoàn tất. Bản sao lưu chứa bí mật (.env và dữ liệu): giữ ở nơi chỉ quản trị viên đọc được."
echo "Khôi phục: make restore FROM=$dest"
