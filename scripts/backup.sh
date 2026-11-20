#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Sao lưu toàn bộ trạng thái của lõi vào một thư mục có dấu thời gian:
#   postgres.sql.gz  mọi CSDL và vai trò (Keycloak, Flowable, mortise kèm metadata Hasura)
#   scorpio.sql.gz   CSDL riêng của Scorpio, gồm CSDL của từng tenant (ADR 0012)
#   mqtt-auth.tar.gz tài khoản và quyền MQTT của thiết bị (băm mật khẩu, không phải mật khẩu)
#   seaweed.tar.gz   dữ liệu lưu trữ đối tượng
#   env              bản sao .env (mật khẩu vai trò CSDL trong bản dump khớp với tệp này)
#   MANIFEST, SHA256SUMS
# Khôi phục bằng scripts/restore.sh. Thư mục mặc định nằm ngoài repo để bản sao lưu
# chứa bí mật không bao giờ lọt vào git. Trong lúc sao lưu, các dịch vụ ghi dữ liệu (scripts/writers.sh) dừng, kể
# cả cổng: người dùng và thiết bị không gọi được lõi cho tới khi sao lưu xong.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/writers.sh
source scripts/writers.sh

root="${BACKUP_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mortise-dx/backups}"
dest="$root/$(date -u +%Y%m%dT%H%M%SZ)"

if [[ ! -f .env ]]; then
  echo "Không thấy .env: lõi chưa được dựng bằng 'make up' trong thư mục này." >&2
  exit 1
fi
running=$(docker compose ps --status running --services)
for service in postgres scorpio-db; do
  if ! grep -qx "$service" <<<"$running"; then
    echo "$service không chạy. Chạy 'make up' trước khi sao lưu." >&2
    exit 1
  fi
done

umask 077
mkdir -p "$dest"
echo "Sao lưu vào $dest"

# Mỗi pg_dumpall nhất quán riêng, nhưng PostgreSQL, Scorpio và kho tệp được chép lần lượt: dịch vụ còn chạy thì tệp
# tải lên giữa hai lần chép chỉ có ở một bên (đối tượng không có dòng core.files, hay dòng không có nội dung), số đo
# ghi giữa hai lần dump chỉ có ở một CSDL. Dừng mọi dịch vụ ghi trước khi chép, bật lại cả khi sao lưu lỗi giữa chừng;
# chỉ bật lại dịch vụ đã chạy trước đó.
stopped=()
for service in "${writers[@]}"; do
  if grep -qx "$service" <<<"$running"; then stopped+=("$service"); fi
done
restart() {
  [[ ${#stopped[@]} -eq 0 ]] || docker compose up -d --wait --no-recreate "${stopped[@]}" >/dev/null ||
    echo "Không bật lại được ${stopped[*]}; chạy 'make up' để dựng lại lõi." >&2
}
trap restart EXIT
echo "Dừng dịch vụ ghi dữ liệu trong lúc sao lưu: ${stopped[*]}"
[[ ${#stopped[@]} -eq 0 ]] || docker compose stop "${stopped[@]}" >/dev/null

# Băm cuối của nhật ký thay đổi, đọc trước khi dump nên chắc chắn có trong bản dump; khôi phục xong
# audit-verify đối chiếu với nó (ADR 0009).
audit_head=$(docker compose exec -T postgres psql -qAtX -U postgres -d mortise \
  -c "SELECT id || ':' || encode(hash, 'hex') FROM core.audit_log ORDER BY id DESC LIMIT 1")

docker compose exec -T postgres pg_dumpall -U postgres --clean --if-exists | gzip >"$dest/postgres.sql.gz"
echo "  PostgreSQL: xong"

# Scorpio tạo một CSDL cho mỗi tenant, nên dump cả cụm thay vì một CSDL.
docker compose exec -T scorpio-db pg_dumpall -U scorpio --clean --if-exists | gzip >"$dest/scorpio.sql.gz"
echo "  Scorpio: xong"

# Mosquitto và SeaweedFS đã dừng: chép volume bằng đúng image của dịch vụ để không thêm image mới chỉ để chạy tar.
docker compose run --rm --no-deps -T --entrypoint tar mosquitto czf - -C /mosquitto/auth passwd acl \
  >"$dest/mqtt-auth.tar.gz"
echo "  Tài khoản MQTT: xong"

docker compose run --rm --no-deps -T --entrypoint tar seaweedfs czf - -C /data . >"$dest/seaweed.tar.gz"
echo "  SeaweedFS: xong"

trap - EXIT
restart
echo "Đã bật lại dịch vụ."

cp .env "$dest/env"
{
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "git_commit=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  docker compose config --images | sort | sed 's/^/image=/'
  [[ -z "$audit_head" ]] || echo "audit_head=$audit_head"
} >"$dest/MANIFEST"
(cd "$dest" && sha256sum postgres.sql.gz scorpio.sql.gz mqtt-auth.tar.gz seaweed.tar.gz env MANIFEST >SHA256SUMS)

echo "Hoàn tất. Bản sao lưu chứa bí mật (.env và dữ liệu): giữ ở nơi chỉ quản trị viên đọc được."
echo "Khôi phục: make restore FROM=$dest"
