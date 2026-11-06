# Stock image: pip opencv-python-headless 5.0.0.93 on Python 3.12, linux/arm64.
#   docker build --platform linux/arm64 -t halloween-vision:stock vision/
FROM python:3.12-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/app/.venv PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev
# Weights are baked in (pinned URLs + SHA-256), so the container never fetches anything at runtime.
COPY scripts/fetch_models.py scripts/
RUN python scripts/fetch_models.py
COPY vocabulary.json vocabulary.npy ./
COPY app app
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
