@echo off
REM Double-click to start the CallPilot backend (FastAPI on port 8000).
REM Keys are auto-loaded from backend\.env. Leave this window open while demoing.
cd /d "%~dp0backend"
".venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000
pause
