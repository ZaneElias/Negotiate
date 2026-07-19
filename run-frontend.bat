@echo off
REM Double-click to start the CallPilot frontend (Next.js on port 3000).
REM Then open http://localhost:3000 in your browser. Keep this window open.
cd /d "%~dp0frontend"
call npm run dev
pause
