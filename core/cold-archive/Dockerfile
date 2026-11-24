# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hai tầng như các dịch vụ khác của lõi. Tiện ích httpfs (đọc, ghi S3) và postgres của DuckDB không có sẵn trong gói
# Python mà tải từ mạng ở lần dùng đầu; cài sẵn lúc dựng image để công cụ chạy được trên máy không có internet.

FROM ghcr.io/astral-sh/uv:0.11.21 AS uv

FROM python:3.13.18-slim-trixie AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /srv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
RUN .venv/bin/python -c "import duckdb; c = duckdb.connect(config={'extension_directory': '/srv/duckdb-extensions'}); c.execute('INSTALL httpfs'); c.execute('INSTALL postgres')"
COPY app ./app

FROM python:3.13.18-slim-trixie
RUN useradd --system --uid 10001 mortise
WORKDIR /srv
COPY --from=build /srv /srv
ENV PATH="/srv/.venv/bin:$PATH"
USER mortise
ENTRYPOINT ["python", "-m", "app.main"]
