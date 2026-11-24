#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Khôi phục lõi từ một thư mục do scripts/backup.sh tạo ra. GHI ĐÈ toàn bộ dữ liệu hiện
# tại: CSDL, tài khoản, quy trình, tệp và dữ liệu thiết bị. Trình tự: kiểm checksum, dừng các
# dịch vụ đang dùng CSDL, nạp lại PostgreSQL, CSDL của Scorpio và SeaweedFS, rồi dựng lại cả lõi.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/writers.sh
source scripts/writers.sh

src="${1:-}"
if [[ -z "$src" || ! -d "$src" ]]; then
  echo "Cách dùng: make restore FROM=<thư mục sao lưu>" >&2
  exit 1
fi
if [[ "${CONFIRM:-}" != "yes" ]]; then
  echo "Khôi phục sẽ xóa dữ liệu hiện tại của lõi. Chạy lại với CONFIRM=yes để tiếp tục." >&2
  exit 1
fi

echo "Kiểm tra checksum…"
(cd "$src" && sha256sum --quiet -c SHA256SUMS) || {
  echo "Bản sao lưu hỏng hoặc bị sửa: checksum không khớp." >&2
  exit 1
}

# Mật khẩu vai trò trong bản dump là của .env lúc sao lưu. Dùng .env khác thì Keycloak,
# Hasura và Flowable không đăng nhập được vào CSDL sau khi khôi phục.
if [[ -f .env ]] && ! cmp -s .env "$src/env"; then
  cp .env ".env.before-restore"
  echo "Đã lưu .env hiện tại thành .env.before-restore"
fi
install -m 600 "$src/env" .env

# Mọi dịch vụ ghi (scripts/writers.sh) phải dừng trong lúc nạp, nếu không chúng ghi xen vào dữ liệu đang bị ghi đè:
# bảng và kho tệp lệch nhau, nhật ký thay đổi có dòng không khớp băm sao lưu.
docker compose stop "${writers[@]}" >/dev/null 2>&1 || true
docker compose up -d --wait postgres scorpio-db >/dev/null

# load_cluster DỊCH_VỤ TÀI_KHOẢN TỆP [MẪU_LỖI_VÔ_HẠI...]: nạp bản pg_dumpall vào một cụm PostgreSQL.
load_cluster() {
  local service="$1" user="$2" dump="$3" log="$src/restore-$1.log" pattern
  local harmless=(-e 'current user cannot be dropped' -e "role \"$user\" already exists")
  for pattern in "${@:4}"; do harmless+=(-e "$pattern"); done
  # Ngắt mọi kết nối còn sót để DROP DATABASE trong bản dump không bị chặn.
  docker compose exec -T "$service" psql -U "$user" -d postgres -q -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname IS NOT NULL;" >/dev/null
  # ON_ERROR_STOP=0: lỗi của từng câu lệnh SQL không làm psql dừng, nên psql chỉ thoát khác 0 khi hỏng
  # hạ tầng (mất kết nối, dịch vụ không chạy, tệp nén hỏng). Khi đó bản dump --clean có thể đã xóa
  # CSDL mà chưa nạp lại, nên dừng ngay chứ không coi là xong.
  if ! gunzip -c "$dump" |
    docker compose exec -T "$service" psql -U "$user" -d postgres -q -v ON_ERROR_STOP=0 >/dev/null 2>"$log"; then
    echo "Nạp $service bị ngắt giữa chừng; dữ liệu của $service có thể đã mất. Xem $log rồi khôi phục lại." >&2
    exit 1
  fi
  # Bản dump --clean có câu lệnh xóa và tạo lại vai trò đang đăng nhập; lỗi đó vô hại. Lỗi khác
  # thì dừng để quản trị viên xem log thay vì dựng lõi trên dữ liệu dở dang.
  if grep -v "${harmless[@]}" "$log" | grep -q -e 'ERROR' -e 'FATAL'; then
    echo "Nạp $service có lỗi, xem $log" >&2
    exit 1
  fi
  rm -f "$log"
}

echo "Nạp PostgreSQL…"
load_cluster postgres postgres "$src/postgres.sql.gz"
# Bản sao lưu làm trước khi có Scorpio không có tệp này; khi đó giữ CSDL Scorpio hiện tại.
if [[ -f "$src/scorpio.sql.gz" ]]; then
  echo "Nạp Scorpio…"
  # Image PostGIS dựng sẵn CSDL mẫu template_postgis và schema của tiện ích (tiger, topology) trong
  # mỗi CSDL; bản dump tạo lại chúng nên báo "đã có", không mất dữ liệu.
  load_cluster scorpio-db scorpio "$src/scorpio.sql.gz" 'cannot drop a template database' \
    'database "template_postgis" already exists' 'schema "tiger" already exists' 'schema "topology" already exists'

fi

# Bản sao lưu làm trước khi có MQTT không có tệp này; khi đó giữ tài khoản thiết bị hiện tại. start.sh của
# Mosquitto chỉnh quyền tệp và đặt lại tài khoản cầu nối theo .env khi dựng lại.
if [[ -f "$src/mqtt-auth.tar.gz" ]]; then
  echo "Nạp tài khoản MQTT…"
  docker compose run --rm --no-deps -T --entrypoint sh mosquitto -c 'tar xzf - -C /mosquitto/auth' \
    <"$src/mqtt-auth.tar.gz"
fi

echo "Nạp SeaweedFS…"
docker compose run --rm --no-deps -T --entrypoint sh seaweedfs -c \
  'find /data -mindepth 1 -delete && tar xzf - -C /data' <"$src/seaweed.tar.gz"

echo "Dựng lại lõi…"
scripts/compose.sh up -d --wait
# Nhật ký thay đổi khôi phục phải nguyên vẹn và khớp băm cuối ghi lúc sao lưu.
if grep -q '^audit_head=' "$src/MANIFEST"; then
  scripts/audit-verify.sh "$src"
fi
# Dòng nhật ký đã chuyển sang kho lạnh chỉ còn trong tệp (ADR 0014): tính lại chuỗi của mọi đoạn từ tệp đã khôi phục.
segments=$(docker compose exec -T postgres psql -qAtX -U postgres -d mortise -c 'SELECT count(*) FROM core.audit_segments')
if [[ "$segments" != 0 ]]; then
  scripts/compose.sh run tools cold-archive verify || {
    echo "Kho lạnh của nhật ký không khớp core.audit_segments trong bản sao lưu này." >&2
    exit 1
  }
fi
# Bản sao lưu phải nhất quán giữa core.files và kho tệp (backup.sh dừng dịch vụ ghi trong lúc chép).
scripts/files-verify.sh || {
  echo "core.files và kho tệp lệch nhau trong bản sao lưu này; xem danh sách ở trên." >&2
  exit 1
}
echo "Khôi phục xong. Kiểm tra bằng 'make smoke'."
