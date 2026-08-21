@echo off
title RETHINK AI - Launcher
echo ========================================================
echo        RETHINK AI - THINK BEYOND. CREATE FUTURE.
echo               Created for: RAVI TEJA
echo ========================================================
echo.
echo Starting Rethink AI Server on port 3000...
echo.

cd /d "%~dp0"
start http://localhost:3000
node server.js
pause
