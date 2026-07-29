@echo off
REM ============================================================
REM  Preview the PRODUCTION build locally - one server, one port.
REM
REM  This is the same shape that runs on Render: FastAPI serves the
REM  compiled React bundle itself at http://localhost:8000
REM
REM  Use this to check what the hosted version will look like.
REM  For day-to-day editing use start-backend.bat + start-frontend.bat
REM  instead (those give you instant hot-reload).
REM ============================================================
setlocal
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
  echo [X] Run setup-local.bat first.
  pause & exit /b 1
)
if not exist "frontend\node_modules" (
  echo [X] Run setup-local.bat first.
  pause & exit /b 1
)

echo.
echo [1/2] Building the frontend ^(takes 1-2 minutes^)...
echo.
pushd frontend
REM Empty backend URL => the bundle calls /api on its own origin, exactly as in production.
set "REACT_APP_BACKEND_URL="
set "GENERATE_SOURCEMAP=false"
set "CI=false"
call npm run build
if errorlevel 1 (
  echo.
  echo [X] Build failed - see the errors above.
  popd & pause & exit /b 1
)
popd

echo.
echo [2/2] Starting the combined server...
echo.

REM These override backend\.env for this run only.
REM PUBLIC_MODE stays false: it forces Secure cookies, which browsers reject
REM over plain http://localhost. Everything else matches the deployed setup.
set "FRONTEND_BUILD_DIR=%~dp0frontend\build"
set "CORS_ORIGINS="
set "PUBLIC_MODE=false"

echo ============================================
echo   Open  http://localhost:8000
echo   Login  admin@example.com / admin123
echo.
echo   Frontend and API are both on port 8000,
echo   exactly like the hosted version.
echo   Press Ctrl+C to stop.
echo ============================================
echo.

cd backend
.venv\Scripts\python.exe -m uvicorn server:app --host 0.0.0.0 --port 8000
pause
