#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm niêm phong hồ sơ (ADR 0053): dựng lại bản JSON chuẩn của mỗi hồ sơ đã niêm phong từ lịch sử Flowable và so
# với băm trong core.case_seals, rồi so mỗi dòng niêm phong với dòng nhật ký ghi lúc niêm phong. Phần đầu chạy trong
# container workflow-api để dùng đúng mã dựng bản JSON và tài khoản của dịch vụ, như files-verify.sh chạy trong
# files-api; phần sau đọc core.audit_log, nơi workflow_api không có quyền, bằng tài khoản postgres. Mỗi hồ sơ lệch
# một dòng, bắt đầu bằng mã hồ sơ.
set -euo pipefail
cd "$(dirname "$0")/.."

status=0
docker compose exec -T workflow-api python -m app.seal_verify || status=$?
unlogged=$(docker compose exec -T postgres psql -qAtX -v ON_ERROR_STOP=1 -U postgres -d mortise -F ': ' \
  -c 'SELECT case_id, problem FROM core.case_seals_unlogged()')
if [[ -n "$unlogged" ]]; then
  echo "$unlogged" >&2
  status=1
fi
exit "$status"
