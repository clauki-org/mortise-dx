#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Đo dung lượng nhật ký thay đổi và thời gian một truy vấn phân tích trước và sau khi chuyển sang kho lạnh (ADR 0014,
# #97). Nhật ký sinh bằng thao tác thật: user.a sửa diện tích thông thủy mọi phòng của xã A qua GraphQL ở cổng, cộng
# rồi trừ lại 0,5 m², nên dữ liệu gói không đổi. Cần lõi đã `make seed`, gói facilities-commune đã cài và
# `make seed-demo`. Lệnh này GHI nhật ký và CHUYỂN mọi dòng tới lúc chạy sang kho lạnh; chạy trên bản cài thử.
#   scripts/audit-measure.sh <số cặp sửa>      mỗi cặp là hai lần sửa, mỗi lần một dòng nhật ký cho mỗi phòng
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
# shellcheck source=/dev/null
source .env
set +a

pairs="${1:?Cách dùng: scripts/audit-measure.sh <số cặp sửa>, ví dụ 2000}"
base="${MORTISE_PUBLIC_URL:-http://localhost:9080}"
sql() { docker compose exec -T postgres psql -qAtX -v ON_ERROR_STOP=1 -U postgres -d mortise -c "$1"; }
cold() { docker compose --profile tools run --rm --build --quiet-pull cold-archive "$@" 2>/dev/null; }
token() {
  curl -fsS "$base/auth/realms/mortise/protocol/openid-connect/token" -d grant_type=password -d client_id=mortise-test \
    -d username=user.a -d "password=$DEMO_USER_PASSWORD" | jq -r .access_token
}
# Cổng giới hạn số yêu cầu mỗi phút (limit-count trong core/apisix/apisix.yaml): bị từ chối (429) thì chờ rồi gửi lại.
edit() {
  local status
  until status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$base/v1/graphql" -H "Authorization: Bearer $1" \
    -H 'Content-Type: application/json' \
    -d "{\"query\":\"mutation { update_app_facilities_commune_rooms(where: {}, _inc: {clear_area_m2: $2}) { affected_rows } }\"}") &&
    [[ "$status" == 200 ]]; do
    [[ "$status" == 429 ]] || { echo "Cổng trả $status khi sửa phòng; dừng." >&2; exit 1; }
    sleep 5
  done
}
# Truy vấn phân tích: số thay đổi theo bảng và ngày, trên mọi dòng nhật ký. "at" trong ngoặc kép vì DuckDB coi at
# là từ khóa.
analytic() { echo "SELECT table_name, date_trunc('day', \"at\") AS day, count(*) FROM $1 GROUP BY 1, 2"; }
# Thời gian thực thi do PostgreSQL tự đo (EXPLAIN ANALYZE), trung vị của 5 lần, mili giây.
pg_time() {
  for _ in 1 2 3 4 5; do
    sql "EXPLAIN (ANALYZE, FORMAT JSON) $(analytic core.audit_log)" | jq '.[0]["Execution Time"]'
  done | sort -n | sed -n 3p
}
# Thời gian DuckDB tự đo cho cùng truy vấn trên bảng ảo audit_all (kho lạnh cộng CSDL), trung vị của 3 lần, giây.
duck_time() {
  for _ in 1 2 3; do
    cold query "EXPLAIN ANALYZE $(analytic audit_all)" | grep -oE 'Total Time: [0-9.]+s' | grep -oE '[0-9.]+'
  done | sort -n | sed -n 2p
}
size() { sql "SELECT pg_total_relation_size('core.audit_log')"; }

# Lấy token mới mỗi 100 cặp vì access token sống 5 phút.
started=$(date +%s)
for ((i = 0; i < pairs; i++)); do
  ((i % 100)) || access=$(token)
  edit "$access" 0.5
  edit "$access" -0.5
done
echo "sinh: $pairs cặp sửa trong $(($(date +%s) - started)) giây"

echo "trước: dòng=$(sql 'SELECT count(*) FROM core.audit_log') byte=$(size) pg_ms=$(pg_time)"
cold archive --before "$(date -u -d '+1 minute' +%FT%TZ)"
echo "sau khi chuyển: dòng=$(sql 'SELECT count(*) FROM core.audit_log') byte=$(size) pg_ms=$(pg_time)"
sql 'VACUUM core.audit_log' >/dev/null
echo "sau VACUUM: byte=$(size)"
sql 'VACUUM FULL core.audit_log' >/dev/null
echo "sau VACUUM FULL: byte=$(size)"
parquet=$(cold query "SELECT sum(size) AS n FROM read_blob('s3://${COLD_BUCKET:-mortise-cold}/audit_log/*.parquet')" |
  grep -oE '│ +[0-9]+ +│' | tr -dc '0-9')
echo "kho lạnh: byte=$parquet duckdb_s=$(duck_time)"
