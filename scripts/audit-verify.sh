#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm chuỗi băm của nhật ký thay đổi (core.audit_verify, ADR 0009): chỉ ra dòng đầu tiên bị sửa, chỗ chuỗi bị đứt,
# và nếu truyền bản sao lưu (hay "<id>:<băm>") thì kiểm thêm băm cuối ghi trong đó còn đúng không. Băm trong bản
# sao lưu bắt được cả việc sửa rồi tính lại toàn bộ chuỗi hay xóa các dòng cuối, tính tới lúc sao lưu. Dòng neo đã
# chuyển sang kho lạnh và xóa khỏi CSDL (#97) thì đối chiếu qua tệp của đoạn chứa nó (cold-archive verify).
set -euo pipefail
cd "$(dirname "$0")/.."

anchor="${1:-}"
if [[ -d "$anchor" ]]; then
  if [[ ! -f "$anchor/MANIFEST" ]]; then
    echo "$anchor không phải bản sao lưu: thiếu MANIFEST." >&2
    exit 2
  fi
  head=$(sed -n 's/^audit_head=//p' "$anchor/MANIFEST")
  if [[ -z "$head" ]]; then
    echo "MANIFEST của $anchor không có audit_head (sao lưu trước khi có nhật ký); không có gì để đối chiếu." >&2
    exit 2
  fi
  anchor=$head
fi
id=NULL hash=NULL
if [[ -n "$anchor" ]]; then
  if [[ ! "$anchor" =~ ^([0-9]+):([0-9a-f]{64})$ ]]; then
    echo "Băm neo phải có dạng <id>:<sha256 hex>, nhận: $anchor" >&2
    exit 2
  fi
  id=${BASH_REMATCH[1]} hash="'\\x${BASH_REMATCH[2]}'::bytea"
fi

psql() { docker compose exec -T postgres psql -qAtX -v ON_ERROR_STOP=1 -U postgres -d mortise "$@"; }
problems=$(psql -F ': ' -c "SELECT id, problem FROM core.audit_verify($id, $hash)")
# Neo nằm giữa một đoạn đã xóa khỏi CSDL: core.audit_verify không đọc được tệp nên trả một dòng riêng thay vì coi
# là khớp; đối chiếu neo đó qua tệp của đoạn (cold-archive verify), xong thì bỏ dòng đó khỏi danh sách vấn đề.
cold_note='neo nằm trong đoạn đã lưu trữ'
if grep -q "$cold_note" <<<"$problems"; then
  if ! docker compose --profile tools run --rm --build --quiet-pull cold-archive verify --anchor "$anchor"; then
    echo "Neo $anchor không khớp kho lạnh." >&2
    exit 1
  fi
  problems=$(grep -v "$cold_note" <<<"$problems" || true)
fi
if [[ -n "$problems" ]]; then
  echo "Nhật ký thay đổi không còn nguyên vẹn (dòng: vấn đề):" >&2
  echo "$problems" >&2
  exit 1
fi
# ${anchor:-…} trả chính giá trị neo khi có neo, nên hai nhánh phải tách bằng if thay vì ghép hai mở rộng.
if [[ -n "$anchor" ]]; then outcome="khớp băm sao lưu tại dòng $id"; else outcome="chưa đối chiếu băm sao lưu (ANCHOR=<thư mục sao lưu>)"; fi
echo "audit: $(psql -c 'SELECT count(*) FROM core.audit_log') dòng trong CSDL, chuỗi băm khớp (nối qua đoạn đã lưu trữ); $outcome"
