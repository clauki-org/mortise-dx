#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Bật profile `ai` (ADR 0021): chạy Ollama, tải các mô hình ghim trong core/ollama/models.txt rồi đối chiếu digest
# lớp trọng số. Tên trên registry của Ollama trỏ được sang bản khác khi nhà phát hành đẩy lại; không đối chiếu thì
# trợ lý chạy một mô hình chưa ai đo mà không ai biết. Mô hình đã có thì Ollama chỉ kiểm, không tải lại.
set -euo pipefail
cd "$(dirname "$0")/.."

pins=core/ollama/models.txt

if ! docker compose --profile ai up -d --wait ollama; then
  echo "Ollama không khởi động được; xem: docker compose --profile ai logs ollama" >&2
  exit 1
fi

while read -r name weights; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  # </dev/null: lệnh exec đọc stdin, không chặn thì nó ăn mất các dòng còn lại của tệp ghim.
  if ! docker compose exec -T ollama ollama pull "$name" </dev/null; then
    echo "Không tải được $name; kiểm mạng của máy chủ rồi chạy lại make ai-up." >&2
    exit 1
  fi
  if ! modelfile=$(docker compose exec -T ollama ollama show --modelfile "$name" </dev/null); then
    echo "Ollama không đọc được $name sau khi tải; xem: docker compose --profile ai logs ollama" >&2
    exit 1
  fi
  # Ollama ghi tệp trọng số theo băm của nó (blobs/sha256-<băm>) và in đường dẫn đó ở dòng FROM.
  if ! grep -q "^FROM .*/blobs/${weights/:/-}$" <<<"$modelfile"; then
    echo "Trọng số của $name trên registry khác digest ghim trong $pins ($weights)." >&2
    echo "Đo lại mô hình theo ADR 0021 trước khi sửa digest." >&2
    exit 1
  fi
  echo "ollama: $name khớp $weights"
done <"$pins"
