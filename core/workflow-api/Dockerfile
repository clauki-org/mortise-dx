# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hai tầng: tầng build cài phụ thuộc bằng uv từ uv.lock, tầng chạy chỉ có Python và
# môi trường ảo. Phụ thuộc được cài trước khi chép mã, nên sửa mã không làm mất cache.

FROM ghcr.io/astral-sh/uv:0.11.21 AS uv

FROM python:3.13.18-slim-trixie AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /srv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app ./app

FROM python:3.13.18-slim-trixie
RUN useradd --system --uid 10001 mortise
WORKDIR /srv
COPY --from=build /srv /srv
ENV PATH="/srv/.venv/bin:$PATH"
USER mortise
EXPOSE 8000
# MORTISE_TRACING=on (compose.yaml, ADR 0038): chạy dưới opentelemetry-instrument để ghi vết; giá trị khác chạy uvicorn
# như cũ, không ghi vết. `exec` giữ uvicorn là tiến trình chính để Docker dựng lại khi nó thoát.
CMD ["sh", "-c", "if [ \"$MORTISE_TRACING\" = on ]; then set -- opentelemetry-instrument; fi; exec \"$@\" uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log"]
