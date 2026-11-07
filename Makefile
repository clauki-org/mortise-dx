# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Lối vào duy nhất cho mọi lệnh của dự án. CI gọi đúng các target này, nên
# `make check-fast` xanh ở máy thì CI cũng xanh.

SHELL := /bin/sh

.PHONY: help lint check-fast hooks

help: ## Liệt kê các lệnh
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-11s %s\n", $$1, $$2}'

lint: ## Kiểm tra giấy phép từng tệp (REUSE)
	uvx reuse lint

# shellcheck và yamllint chạy qua uvx để không phải cài sẵn; chỉ cần uv.
check-fast: lint ## Giấy phép, shell, YAML; không cần dựng lõi
	uvx --from shellcheck-py shellcheck scripts/pre-push
	uvx yamllint -d '{extends: relaxed, rules: {line-length: {max: 120}}}' .github

hooks: ## Cài hook pre-push chạy check-fast
	install -m 755 scripts/pre-push "$$(git rev-parse --git-path hooks)/pre-push"
