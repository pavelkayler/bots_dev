@echo off
setlocal enabledelayedexpansion

set ROOT=%~dp0
set PID_DIR=%ROOT%.pids
if not exist "%PID_DIR%" mkdir "%PID_DIR%"

if "%1"=="start" goto :start
if "%1"=="stop" goto :stop
if "%1"=="restart" goto :restart

echo Usage: dev.bat ^<start^|stop^|restart^>
exit /b 1

:start
echo [dev] starting backend + frontend...
for /f %%i in ('powershell -NoProfile -Command "$p=Start-Process cmd -ArgumentList '/c cd /d \"%ROOT%backend\" && npm run build && npm run start' -PassThru; $p.Id"') do set BACKEND_PID=%%i
for /f %%i in ('powershell -NoProfile -Command "$p=Start-Process cmd -ArgumentList '/c cd /d \"%ROOT%frontend\" && npm run dev -- --host 0.0.0.0 --port 5173' -PassThru; $p.Id"') do set FRONTEND_PID=%%i

echo !BACKEND_PID!>"%PID_DIR%\backend.pid"
echo !FRONTEND_PID!>"%PID_DIR%\frontend.pid"

echo [dev] backend pid=!BACKEND_PID!
echo [dev] frontend pid=!FRONTEND_PID!
exit /b 0

:stop
echo [dev] stopping frontend...
if exist "%PID_DIR%\frontend.pid" (
  set /p FRONTEND_PID=<"%PID_DIR%\frontend.pid"
  taskkill /PID !FRONTEND_PID! /T /F >nul 2>nul
  del /f /q "%PID_DIR%\frontend.pid" >nul 2>nul
)

echo [dev] stopping backend...
if exist "%PID_DIR%\backend.pid" (
  set /p BACKEND_PID=<"%PID_DIR%\backend.pid"
  taskkill /PID !BACKEND_PID! /T /F >nul 2>nul
  del /f /q "%PID_DIR%\backend.pid" >nul 2>nul
)

echo [dev] stop complete.
exit /b 0

:restart
call "%~f0" stop
call "%~f0" start
exit /b %errorlevel%
