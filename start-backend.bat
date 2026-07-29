@echo off
REM Starts the FastAPI backend on http://localhost:8000
setlocal
cd /d "%~dp0backend"

if not exist ".venv\Scripts\python.exe" (
  echo [X] No virtualenv found. Run setup-local.bat first.
  pause & exit /b 1
)

echo Starting Victoria Unit Flow API on http://localhost:8000
echo API docs: http://localhost:8000/docs
echo Press Ctrl+C to stop.
echo.
.venv\Scripts\python.exe -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload
pause
