# syntax=docker/dockerfile:1

# ---- base: Debian slim with the exact Python the project pins (3.14) ----
FROM python:3.14.10-slim AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

# ---- build: resolve the locked dependencies into /app/.venv with uv ----
FROM base AS build
COPY --from=ghcr.io/astral-sh/uv:0.12.7 /uv /usr/local/bin/uv
# Compile .pyc once here (faster start-up); copy files rather than hard-link (cache mounts).
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev

# ---- runtime: the virtualenv and the code, no uv, no compilers, not root ----
FROM base AS runtime
RUN groupadd --system app && useradd --system --gid app --no-create-home app
COPY --from=build /app/.venv /app/.venv
COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app
ENV PATH="/app/.venv/bin:$PATH"
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--proxy-headers", "--timeout-graceful-shutdown", "10"]
