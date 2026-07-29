@echo off
REM Starts the React dev server on http://localhost:3000
setlocal
cd /d "%~dp0frontend"

if not exist "node_modules" (
  echo [X] node_modules missing. Run setup-local.bat first.
  pause & exit /b 1
)

echo Starting Victoria Unit Flow UI on http://localhost:3000
echo Press Ctrl+C to stop.
echo.
call npm start
pause
