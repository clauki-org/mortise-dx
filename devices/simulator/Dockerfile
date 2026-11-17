# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hai tầng: tầng build cài phụ thuộc bằng uv từ uv.lock, tầng chạy chỉ có Python và
# môi trường ảo. Phụ thuộc được cài trước khi chép mã, nên sửa mã không làm mất cache.

FROM ghcr.io/astral-sh/uv:0.11.21 AS uv

FROM python:3.13-slim-trixie AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /srv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY simulate.py ./

FROM python:3.13-slim-trixie
RUN useradd --system --uid 10001 mortise
WORKDIR /srv
COPY --from=build /srv /srv
ENV PATH="/srv/.venv/bin:$PATH"
USER mortise
ENTRYPOINT ["python", "simulate.py"]
