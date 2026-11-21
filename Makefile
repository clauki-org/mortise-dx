# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Lối vào duy nhất để dựng, kiểm tra và vận hành lõi. CI gọi đúng các target này,
# nên `make check-fast` xanh ở máy thì CI cũng xanh.

SHELL := /bin/sh
# Môi trường ảo Python đặt ngoài repo, mỗi dịch vụ một thư mục: REUSE 4.0.3 quét cả .venv
# lồng trong repo dù git đã bỏ qua nó, và hai dịch vụ dùng chung một môi trường thì mỗi lần
# chạy uv lại gỡ phụ thuộc của dịch vụ kia.
export MORTISE_VENVS ?= $(HOME)/.cache/mortise-dx

.PHONY: help env up down reset ps logs seed smoke migrate-new migrate-status backup restore lint test contracts \
  check-fast web-check e2e audit-verify backup-under-load files-verify hooks app-install app-uninstall app-status app-smoke otp device-add device-remove simulate archive cold-query cold-verify seed-demo ai-up

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

seed: env ## Nạp tài khoản demo, metadata Hasura và quy trình mẫu
	@scripts/seed.sh

otp: ## In mã OTP hiện tại của tài khoản người duyệt demo và khóa để nhập vào ứng dụng OTP
	@uv run --quiet --no-project python scripts/otp.py show

smoke: ## Kiểm tra đầu-cuối qua cổng (cần lõi đang chạy và đã seed)
	@scripts/smoke.sh

migrate-new: ## Tạo tệp migration mới cho lõi: make migrate-new NAME=<ten_ngan>
	@scripts/migration-new.sh "$(NAME)"

migrate-status: ## Migration nào của lõi đã áp, nào còn chờ (cần lõi đang chạy)
	docker compose run --rm --no-deps migrate status

audit-verify: ## Kiểm nhật ký thay đổi không bị sửa lén; ANCHOR=<thư mục sao lưu> để đối chiếu băm lúc sao lưu
	@scripts/audit-verify.sh "$(ANCHOR)"

backup: ## Sao lưu CSDL, tệp và .env ra ngoài repo (BACKUP_DIR để đổi nơi lưu); dịch vụ ghi dữ liệu dừng trong lúc sao lưu
	@scripts/backup.sh

backup-under-load: ## Sao lưu trong khi tải tệp lên liên tục qua cổng; khôi phục bản này để kiểm core.files khớp kho tệp
	@scripts/backup-under-load.sh

files-verify: ## Kiểm mỗi dòng core.files có đúng một đối tượng trong kho tệp, không có đối tượng mồ côi (cần lõi đang chạy)
	@scripts/files-verify.sh

simulate: ## Chạy bộ giả lập thiết bị demo, gửi số đo mỗi 5 giây; thêm ARGS="--set xa-a/archive-01:humidity=78"
	docker compose --profile simulator run --rm --build simulator $(ARGS)

ai-up: env ## Chạy Ollama (profile ai), tải mô hình ghim trong core/ollama/models.txt và kiểm digest; lần đầu cần mạng
	@scripts/ai.sh

device-add: ## Cấp tài khoản MQTT cho thiết bị, in mật khẩu: make device-add TENANT=<tenant> DEVICE=<thiết bị>
	@scripts/device.sh add "$(TENANT)" "$(DEVICE)"

device-remove: ## Thu hồi tài khoản MQTT của thiết bị: make device-remove TENANT=<tenant> DEVICE=<thiết bị>
	@scripts/device.sh remove "$(TENANT)" "$(DEVICE)"
archive: ## Xuất nhật ký thay đổi cũ sang kho lạnh: make archive BEFORE=<ngày, ví dụ 2026-11-01>
	@test -n "$(BEFORE)" || { echo "Cách dùng: make archive BEFORE=2026-11-01" >&2; exit 1; }
	@docker compose --profile tools run --rm --build cold-archive archive --before "$(BEFORE)"
cold-verify: ## Tính lại chuỗi băm của mọi đoạn nhật ký trong kho lạnh từ tệp; thêm ANCHOR=<id>:<băm> để đối chiếu neo
	@docker compose --profile tools run --rm --build cold-archive verify $(if $(ANCHOR),--anchor "$(ANCHOR)")
cold-query: ## Truy vấn nhật ký gộp kho lạnh và CSDL bằng DuckDB: make cold-query SQL="SELECT count(*) FROM audit_all"
	@test -n "$(SQL)" || { echo 'Cách dùng: make cold-query SQL="SELECT count(*) FROM audit_all"' >&2; exit 1; }
	@docker compose --profile tools run --rm --build cold-archive query "$(SQL)"

# Gói có bộ nạp riêng (seed/load.py) thì chạy nó; gói chỉ có seed/demo.yaml thì nạp bằng bộ nạp chung
# scripts/app-seed.py (ADR 0022). APP=<gói> nạp riêng một gói, khi các gói khác có dữ liệu demo chưa được cài.
seed-demo: ## Nạp dữ liệu demo của các gói (hoặc APP=<gói>) qua cổng; cần gói đã cài và make seed
	@found=; for dir in $(if $(APP),apps/$(APP)/,apps/*/); do \
	  if [ -f "$${dir}seed/load.py" ]; then run="$${dir}seed/load.py"; \
	  elif [ -f "$${dir}seed/demo.yaml" ]; then run="scripts/app-seed.py $${dir%/}"; \
	  else continue; fi; \
	  found=1; \
	  DEMO_USER_PASSWORD="$$(sed -n 's/^DEMO_USER_PASSWORD=//p' .env)" \
	  MORTISE_PUBLIC_URL="$$(sed -n 's/^MORTISE_PUBLIC_URL=//p' .env)" \
	    uv run --quiet --no-project --with pyyaml==6.0.3 python $$run || exit 1; \
	done; \
	test -n "$$found" || { echo "Không gói nào có dữ liệu demo (seed/load.py hoặc seed/demo.yaml)." >&2; exit 1; }

app-install: ## Cài một gói Tầng 3 lên lõi đang chạy: make app-install APP=<gói> [SETTINGS=tên=giá trị,...]
	@APP_SETTINGS="$(SETTINGS)" scripts/app.sh "$(APP)" install

app-uninstall: ## Gỡ gói, XÓA dữ liệu của gói ở mọi tenant: make app-uninstall APP=<gói> CONFIRM=yes
	@CONFIRM="$(CONFIRM)" scripts/app.sh "$(APP)" uninstall

app-status: ## Migration nào của gói đã áp: make app-status APP=<gói>
	@scripts/app.sh "$(APP)" status

app-smoke: ## Kiểm tra qua cổng của một gói đã cài: make app-smoke APP=<gói>
	@test -x "apps/$(APP)/tests/smoke.sh" || { echo "Gói '$(APP)' không có apps/$(APP)/tests/smoke.sh" >&2; exit 1; }
	@apps/$(APP)/tests/smoke.sh

restore: ## Khôi phục từ bản sao lưu, GHI ĐÈ dữ liệu: make restore FROM=<thư mục> CONFIRM=yes
	@scripts/restore.sh "$(FROM)"

lint: ## Kiểm tra giấy phép từng tệp (REUSE)
	uvx reuse lint

test: ## Kiểm thử đơn vị các dịch vụ tự viết của lõi và bộ giả lập thiết bị
	@for dir in core/workflow-api core/files-api core/context-api core/iot-bridge core/cold-archive \
	  platform/services/assistant devices/simulator; do \
	  echo "== $$dir"; \
	  (cd $$dir && UV_PROJECT_ENVIRONMENT=$(MORTISE_VENVS)/$$(basename $$dir)-venv PYTHONDONTWRITEBYTECODE=1 \
	    uv run --frozen pytest -q -p no:cacheprovider) || exit 1; \
	done

contracts: ## Xuất lại OpenAPI của workflow-api, files-api, context-api và assistant vào contracts/ sau khi đổi route hay model
	@scripts/contracts.sh write

# Gói chỉ được chứa tệp khai báo, không có mã chạy (ADR 0022); scripts/check-declarative.sh kiểm trong check-fast.
# Gói có mã riêng (ví dụ bộ nạp seed/load.py) không nằm trong danh sách này.
DECLARATIVE_APPS :=

# shellcheck, yamllint và ruff chạy qua uvx để không phải cài sẵn; chỉ cần uv.
check-fast: lint ## Giấy phép, cú pháp compose, shell, YAML, Python, hợp đồng API; không cần dựng lõi
	@test -f .env || cp .env.example .env.check-fast
	@if [ -f .env.check-fast ]; then docker compose --env-file .env.check-fast config -q; rm -f .env.check-fast; \
	  else docker compose config -q; fi
	uvx --from shellcheck-py shellcheck scripts/*.sh scripts/pre-push core/postgres/init/*.sh core/postgres/roles.sh \
	  core/mosquitto/start.sh \
	  apps/*/tests/*.sh
	uvx yamllint -d '{extends: relaxed, rules: {line-length: {max: 120}}}' compose.yaml core contracts apps .github
	uvx ruff check --no-cache core/workflow-api core/files-api core/context-api core/iot-bridge core/cold-archive \
	  platform/services/assistant devices/simulator
	uvx ruff format --no-cache --check core/workflow-api core/files-api core/context-api core/iot-bridge \
	  core/cold-archive platform/services/assistant devices/simulator
	uvx ruff check --no-cache --config core/workflow-api/pyproject.toml scripts apps
	uvx ruff format --no-cache --check --config core/workflow-api/pyproject.toml scripts apps
	@scripts/contracts.sh check
	uv run --quiet --no-project --with pyyaml==6.0.3 python scripts/hasura-metadata.py lint
	$(if $(DECLARATIVE_APPS),@scripts/check-declarative.sh $(DECLARATIVE_APPS))

# Giấy phép phụ thuộc của giao diện (ADR 0006). Thư viện đóng gói vào tệp giao diện gửi tới người dùng chỉ được mang
# giấy phép dễ dãi. Công cụ chỉ chạy lúc phát triển và build, không đóng gói vào sản phẩm, được thêm: BlueOak-1.0.0
# (OSI, dễ dãi; nhóm gói của npm), MPL-2.0 (OSI; lightningcss mà Vite dùng để xử lý CSS) và CC0-1.0, CC-BY-3.0 (dữ
# liệu danh sách giấy phép SPDX mà chính công cụ kiểm giấy phép đọc).
WEB_LICENSES_SHIPPED := MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD
WEB_LICENSES_TOOLING := $(WEB_LICENSES_SHIPPED);BlueOak-1.0.0;MPL-2.0;CC0-1.0;CC-BY-3.0

# Bài kiểm chỉ nhận mật khẩu demo và địa chỉ cổng, không nhận các bí mật khác của .env. Trình duyệt Chromium do
# Playwright tải đúng phiên bản nó cần; đã có thì bước cài chỉ kiểm rồi bỏ qua.
e2e: ## Kiểm thử trên trình duyệt qua cổng (Playwright); cần lõi đang chạy, đã seed và cài gói facilities-commune (cần Node)
	cd platform/web && npm ci --no-audit --no-fund && npx playwright install chromium
	cd platform/web && DEMO_USER_PASSWORD="$$(sed -n 's/^DEMO_USER_PASSWORD=//p' ../../.env)" \
	  MORTISE_PUBLIC_URL="$$(sed -n 's/^MORTISE_PUBLIC_URL=//p' ../../.env)" npx playwright test

web-check: ## Giao diện: cài theo package-lock, Biome, kiểm thử đơn vị, kiểu TypeScript, build, giấy phép phụ thuộc (cần Node)
	cd platform/web && npm ci --no-audit --no-fund
	cd platform/web && npx biome check .
	cd platform/web && npm test
	cd platform/web && npm run build
	cd platform/web && npx license-checker-rseidelsohn --summary --production --excludePrivatePackages \
	  --onlyAllow "$(WEB_LICENSES_SHIPPED)"
	cd platform/web && npx license-checker-rseidelsohn --summary --development --excludePrivatePackages \
	  --onlyAllow "$(WEB_LICENSES_TOOLING)"

hooks: ## Cài hook pre-push chạy check-fast
	install -m 755 scripts/pre-push "$$(git rev-parse --git-path hooks)/pre-push"
