#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Phần chỉnh hợp lệ × cấu hình mọi gói (ADR 0060): đọc cấu hình mục menu của mọi gói ở apps/, sinh phần chỉnh cho
# từng loại, trộn bằng hàm của trình duyệt (scripts/config-overrides-generate.mjs), rồi đưa cấu hình đã trộn qua bộ
# kiểm chung của gói (`scripts/contracts.sh package <gói> --configs <thư mục>`). Bản contracts.sh chưa có lệnh package
# thì kiểm từng tệp theo schema của thành phần (`contracts.sh config`), ít bước hơn. Gọi từ `make overrides-check`;
# cần uv và Node 24 trở lên (chạy thẳng tệp .ts).
set -euo pipefail
cd "$(dirname "$0")/.."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Tệp cấu hình là YAML; Node không có bộ đọc YAML trong repo, nên Python đọc rồi ghi JSON cho bước trộn.
uv run --quiet --no-project --with pyyaml==6.0.3 python - "$work/input.json" <<'PY'
import glob, json, os, sys, yaml

entries = []
for manifest in sorted(glob.glob("apps/*/app.yaml")):
    folder = os.path.dirname(manifest)
    with open(manifest, encoding="utf-8") as file:
        app = yaml.safe_load(file)
    for item in app.get("menu", []):
        with open(os.path.join(folder, item["config"]), encoding="utf-8") as file:
            config = yaml.safe_load(file)
        entries.append({"app": os.path.basename(folder), "item": item["id"], "component": item["component"],
                        "path": item["config"], "config": config})
with open(sys.argv[1], "w", encoding="utf-8") as file:
    json.dump(entries, file, ensure_ascii=False)
PY

node scripts/config-overrides-generate.mjs "$work/input.json" "$work/merged"

if grep -q '^  package)' scripts/contracts.sh; then
  for set in "$work"/merged/*/; do
    for app in "$set"*/; do
      scripts/contracts.sh package "$(basename "$app")" --configs "$app" >/dev/null
    done
  done
else
  echo "config-overrides: contracts.sh chưa có lệnh package (#234), chỉ kiểm theo schema của thành phần" >&2
  jq -r '.[] | "\(.component) \(.app)/\(.path)"' "$work/input.json" | while read -r component path; do
    for set in "$work"/merged/*/; do
      scripts/contracts.sh config "$component" "$set$path" >/dev/null
    done
  done
fi
echo "ok -- cấu hình đã trộn của mọi bộ phần chỉnh qua bộ kiểm"
