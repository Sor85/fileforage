# syntax=docker/dockerfile:1.7

# ---- WebUI ----------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /web
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# ---- 运行时 ---------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

# cpu：多架构 CPU 版；cu128：NVIDIA GPU 版（仅 amd64）
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_NO_CACHE=1 \
    HF_HOME=/models \
    FF_DATA_DIR=/data \
    FF_ROOTS=/media \
    FF_WEB_DIR=/app/web \
    FF_HOST=0.0.0.0 \
    FF_PORT=8730

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv

WORKDIR /app
RUN uv pip install --index-url "$TORCH_INDEX" torch torchvision torchaudio
COPY backend/pyproject.toml ./backend/
COPY backend/fileforage ./backend/fileforage
RUN uv pip install ./backend
COPY --from=web /web/dist /app/web

VOLUME ["/data", "/models"]
EXPOSE 8730
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"FF_PORT\",\"8730\")}/api/status', timeout=4)"

CMD ["python", "-m", "fileforage"]
