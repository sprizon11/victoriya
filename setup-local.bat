@echo off
REM ============================================================
REM  Victoria Unit Flow - one-time local setup (Windows)
REM  Run this ONCE. Afterwards use start-backend.bat / start-frontend.bat
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo ============================================
echo  Victoria Unit Flow - local setup
echo ============================================
echo.

REM ---------- checks ----------
where python >nul 2>&1
if errorlevel 1 (
  echo [X] Python not found on PATH. Install Python 3.11 from python.org
  echo     ^(tick "Add python.exe to PATH" during install^) then re-run this script.
  pause & exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo [X] Node.js not found on PATH. Install Node 20 LTS from nodejs.org, then re-run.
  pause & exit /b 1
)
echo [1/5] Python and Node found.

REM ---------- backend env ----------
echo [2/5] Writing backend\.env for local use ^(backup: .env.emergent.bak^)...
if exist "backend\.env" if not exist "backend\.env.emergent.bak" copy /y "backend\.env" "backend\.env.emergent.bak" >nul
REM Local dev runs the UI on :3000 and the API on :8000 - two different origins,
REM so the API must explicitly allow the dev server. ("*" is rejected by design.)
> "backend\.env" echo MONGO_URL="mongodb://localhost:27017"
>> "backend\.env" echo DB_NAME="victoria_unit_flow"
>> "backend\.env" echo CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000"
>> "backend\.env" echo JWT_SECRET="local-dev-only-not-for-deployment-a1b2c3d4e5f6"
>> "backend\.env" echo ADMIN_EMAIL="admin@example.com"
>> "backend\.env" echo ADMIN_PASSWORD="admin123"
>> "backend\.env" echo PUBLIC_MODE="false"
>> "backend\.env" echo FRONTEND_URL="http://localhost:3000"

REM ---------- frontend env ----------
echo [3/5] Writing frontend\.env for local use ^(backup: .env.emergent.bak^)...
if exist "frontend\.env" if not exist "frontend\.env.emergent.bak" copy /y "frontend\.env" "frontend\.env.emergent.bak" >nul
> "frontend\.env" echo REACT_APP_BACKEND_URL=http://localhost:8000
>> "frontend\.env" echo ENABLE_HEALTH_CHECK=false

REM ---------- python venv ----------
echo [4/5] Creating Python virtualenv and installing backend deps...
if not exist "backend\.venv" python -m venv backend\.venv
call backend\.venv\Scripts\python.exe -m pip install --upgrade pip
call backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-local.txt
if errorlevel 1 ( echo [X] pip install failed. & pause & exit /b 1 )

REM ---------- node deps ----------
echo [5/5] Installing frontend deps ^(this takes a few minutes^)...
pushd frontend
call npm install --legacy-peer-deps
if errorlevel 1 ( echo [X] npm install failed. & popd & pause & exit /b 1 )
REM react-scripts 5 + npm needs ajv 8; harmless if already correct
call npm install --legacy-peer-deps ajv@8 >nul 2>&1
popd

echo.
echo ============================================
echo  Setup complete.
echo.
echo  NEXT: make sure MongoDB is running, then:
echo    1^) double-click start-backend.bat
echo    2^) double-click start-frontend.bat
echo    3^) open http://localhost:3000
echo       login: admin@example.com / admin123
echo ============================================
echo.
pause
