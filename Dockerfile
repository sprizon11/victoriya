# ---------------------------------------------------------------------------
# Victoria Unit Flow - single-image deployment
#
# Stage 1 builds the React bundle. Stage 2 runs FastAPI and serves that bundle
# itself, so the whole app is one container on one origin: no CORS, and auth
# cookies stay SameSite=Lax (which is what makes login reliable on phones).
#
#   docker build -t victoria-unit-flow .
#   docker run -p 8000:8000 --env-file .env.production victoria-unit-flow
# ---------------------------------------------------------------------------

# ---------- stage 1: frontend ----------
FROM node:20-slim AS frontend

WORKDIR /build
COPY frontend/package.json ./
# No package-lock.json is committed, so this resolves fresh.
# --legacy-peer-deps is required: react-scripts 5 conflicts with React 19 peers.
RUN npm install --legacy-peer-deps --no-audit --no-fund \
 && npm install --legacy-peer-deps --no-audit --no-fund ajv@8

COPY frontend/ ./
# Empty REACT_APP_BACKEND_URL => the bundle calls /api on its own origin.
ENV REACT_APP_BACKEND_URL=""
ENV GENERATE_SOURCEMAP=false
ENV CI=false
RUN npm run build


# ---------- stage 2: runtime ----------
FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY backend/requirements-local.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY --from=frontend /build/build ./frontend/build

# Run as a non-root user.
RUN useradd --create-home --uid 10001 appuser \
 && chown -R appuser:appuser /app
USER appuser

ENV FRONTEND_BUILD_DIR=/app/frontend/build \
    PUBLIC_MODE=true \
    PORT=8000

EXPOSE 8000

# Render (and most PaaS) inject $PORT; default to 8000 elsewhere.
CMD ["sh", "-c", "cd backend && exec uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2 --proxy-headers --forwarded-allow-ips='*'"]
