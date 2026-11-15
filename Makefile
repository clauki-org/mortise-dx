# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Lối vào duy nhất để dựng, kiểm tra và vận hành lõi. CI gọi đúng các target này,
# nên `make check-fast` xanh ở máy thì CI cũng xanh.

SHELL := /bin/sh
# Môi trường ảo Python đặt ngoài repo: REUSE 4.0.3 quét cả .venv lồng trong repo dù
# git đã bỏ qua nó.
export UV_PROJECT_ENVIRONMENT ?= $(HOME)/.cache/mortise-dx/workflow-api-venv

.PHONY: help env up down reset ps logs seed smoke migrate-new migrate-status backup restore lint test contracts \
  check-fast web-check hooks

help: ## Liệt kê các lệnh
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-15s %s\n", $$1, $$2}'

env: ## Tạo .env với bí mật ngẫu nhiên (chỉ khi chưa có)
	@scripts/make-env.sh

up: env ## Dựng lõi, áp migration chưa chạy, chờ tới khi mọi dịch vụ sẵn sàng
	docker compose up -d --wait

down: ## Dừng lõi, giữ dữ liệu
	docker compose down

reset: ## Dừng lõi và XÓA toàn bộ dữ liệu
	docker compose down -v

ps: ## Trạng thái các dịch vụ
	docker compose ps

logs: ## Theo dõi log
	docker compose logs -f --tail=100

seed: ## Nạp tài khoản demo, metadata Hasura và quy trình mẫu
	@scripts/seed.sh

smoke: ## Kiểm tra đầu-cuối qua cổng (cần lõi đang chạy và đã seed)
	@scripts/smoke.sh

migrate-new: ## Tạo tệp migration mới cho lõi: make migrate-new NAME=<ten_ngan>
	@scripts/migration-new.sh "$(NAME)"

migrate-status: ## Migration nào của lõi đã áp, nào còn chờ (cần lõi đang chạy)
	docker compose run --rm --no-deps migrate status

backup: ## Sao lưu CSDL, tệp và .env ra ngoài repo (BACKUP_DIR để đổi nơi lưu)
	@scripts/backup.sh

restore: ## Khôi phục từ bản sao lưu, GHI ĐÈ dữ liệu: make restore FROM=<thư mục> CONFIRM=yes
	@scripts/restore.sh "$(FROM)"

lint: ## Kiểm tra giấy phép từng tệp (REUSE)
	uvx reuse lint

test: ## Kiểm thử đơn vị các dịch vụ tự viết của lõi
	cd core/workflow-api && PYTHONDONTWRITEBYTECODE=1 uv run --frozen pytest -q -p no:cacheprovider

contracts: ## Xuất lại OpenAPI của workflow-api vào contracts/ sau khi đổi route hay model
	@scripts/contracts.sh write

# shellcheck, yamllint và ruff chạy qua uvx để không phải cài sẵn; chỉ cần uv.
check-fast: lint ## Giấy phép, cú pháp compose, shell, YAML, Python, hợp đồng API; không cần dựng lõi
	@test -f .env || cp .env.example .env.check-fast
	@if [ -f .env.check-fast ]; then docker compose --env-file .env.check-fast config -q; rm -f .env.check-fast; \
	  else docker compose config -q; fi
	uvx --from shellcheck-py shellcheck scripts/*.sh scripts/pre-push core/postgres/init/*.sh
	uvx yamllint -d '{extends: relaxed, rules: {line-length: {max: 120}}}' compose.yaml core contracts .github
	uvx ruff check --no-cache core/workflow-api
	uvx ruff format --no-cache --check core/workflow-api
	uvx ruff check --no-cache --config core/workflow-api/pyproject.toml scripts
	uvx ruff format --no-cache --check --config core/workflow-api/pyproject.toml scripts
	@scripts/contracts.sh check

# Giấy phép phụ thuộc của giao diện (ADR 0006). Thư viện đóng gói vào tệp giao diện gửi tới người dùng chỉ được mang
# giấy phép dễ dãi. Công cụ chỉ chạy lúc phát triển và build, không đóng gói vào sản phẩm, được thêm: BlueOak-1.0.0
# (OSI, dễ dãi; nhóm gói của npm), MPL-2.0 (OSI; lightningcss mà Vite dùng để xử lý CSS) và CC0-1.0, CC-BY-3.0 (dữ
# liệu danh sách giấy phép SPDX mà chính công cụ kiểm giấy phép đọc).
WEB_LICENSES_SHIPPED := MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD
WEB_LICENSES_TOOLING := $(WEB_LICENSES_SHIPPED);BlueOak-1.0.0;MPL-2.0;CC0-1.0;CC-BY-3.0

web-check: ## Giao diện: cài theo package-lock, Biome, kiểu TypeScript, build, giấy phép phụ thuộc (cần Node)
	cd platform/web && npm ci --no-audit --no-fund
	cd platform/web && npx biome check .
	cd platform/web && npm run build
	cd platform/web && npx license-checker-rseidelsohn --summary --production --excludePrivatePackages \
	  --onlyAllow "$(WEB_LICENSES_SHIPPED)"
	cd platform/web && npx license-checker-rseidelsohn --summary --development --excludePrivatePackages \
	  --onlyAllow "$(WEB_LICENSES_TOOLING)"

hooks: ## Cài hook pre-push chạy check-fast
	install -m 755 scripts/pre-push "$$(git rev-parse --git-path hooks)/pre-push"
