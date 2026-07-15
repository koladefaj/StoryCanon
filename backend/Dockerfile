# Backend: FastAPI + LiteLLM, managed by uv. Python pinned to 3.13
# (litellm's Rust extension does not build on 3.14 yet).
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

# So `app` and `scripts/*` resolve regardless of how the process is launched.
ENV PYTHONPATH=/app \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Install dependencies first (cached until the lockfile changes).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

# App source is bind-mounted in compose for hot reload; copy for standalone runs.
COPY . .
RUN uv sync --frozen

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
