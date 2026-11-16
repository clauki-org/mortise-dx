#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Khôi phục lõi từ một thư mục do scripts/backup.sh tạo ra. GHI ĐÈ toàn bộ dữ liệu hiện
# tại: CSDL, tài khoản, quy trình và tệp. Trình tự: kiểm checksum, dừng các dịch vụ
# đang dùng CSDL, nạp lại PostgreSQL và SeaweedFS, rồi dựng lại cả lõi.
set -euo pipefail
cd "$(dirname "$0")/.."

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

app_services=(apisix workflow-api flowable hasura keycloak)
docker compose stop "${app_services[@]}" seaweedfs >/dev/null 2>&1 || true
docker compose up -d --wait postgres >/dev/null

echo "Nạp PostgreSQL…"
# Ngắt mọi kết nối còn sót để DROP DATABASE trong bản dump không bị chặn.
docker compose exec -T postgres psql -U postgres -d postgres -q -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname IS NOT NULL;" >/dev/null
gunzip -c "$src/postgres.sql.gz" |
  docker compose exec -T postgres psql -U postgres -d postgres -q -v ON_ERROR_STOP=0 >/dev/null 2>"$src/restore-postgres.log" || true
# Bản dump --clean có câu lệnh xóa và tạo lại vai trò postgres đang đăng nhập; lỗi đó vô
# hại. Lỗi khác thì dừng để quản trị viên xem log thay vì dựng lõi trên dữ liệu dở dang.
if grep -v -e 'current user cannot be dropped' -e 'role "postgres" already exists' "$src/restore-postgres.log" | grep -q 'ERROR'; then
  echo "Nạp PostgreSQL có lỗi, xem $src/restore-postgres.log" >&2
  exit 1
fi
rm -f "$src/restore-postgres.log"

echo "Nạp SeaweedFS…"
docker compose run --rm --no-deps -T --entrypoint sh seaweedfs -c \
  'find /data -mindepth 1 -delete && tar xzf - -C /data' <"$src/seaweed.tar.gz"

echo "Dựng lại lõi…"
docker compose up -d --wait
# Nhật ký thay đổi khôi phục phải nguyên vẹn và khớp băm cuối ghi lúc sao lưu.
if grep -q '^audit_head=' "$src/MANIFEST"; then
  scripts/audit-verify.sh "$src"
fi
echo "Khôi phục xong. Kiểm tra bằng 'make smoke'."
