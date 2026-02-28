@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM m.bat - minimal Windows ops helper for bots_dev
REM Commands: install | start | stop | restart
REM start.bat is not used anymore (user will remove it).

if "%~1"=="" goto :help

set "CMD=%~1"
set "PORT=%PORT%"
if "%PORT%"=="" set "PORT=8080"

if /I "%CMD%"=="install" goto :install
if /I "%CMD%"=="start" goto :start
if /I "%CMD%"=="stop" goto :stop
if /I "%CMD%"=="restart" goto :restart

:help
echo Usage: m.bat ^<install^|start^|stop^|restart^>
echo   Optional env: PORT (default 8080)
exit /b 1

:install
echo Installing dependencies...
pushd backend
call npm i
if errorlevel 1 (popd & exit /b 1)
popd
pushd frontend
call npm i
if errorlevel 1 (popd & exit /b 1)
popd
echo Done.
exit /b 0

:start
echo Starting backend on port %PORT% ...
call :start_proc ".\backend" ".\backend\.pid" "run" "dev"
if errorlevel 1 exit /b 1

echo Starting frontend ...
call :start_proc ".\frontend" ".\frontend\.pid" "run" "dev"
if errorlevel 1 exit /b 1

echo Started.
exit /b 0

:stop
echo Requesting backend graceful shutdown on port %PORT%...
call :try_shutdown "%PORT%"

REM Wait for backend to exit (prefer PID if valid, fallback to port)
call :wait_backend "%PORT%" ".\backend\.pid"

REM Stop frontend (dev server) by PID if available
call :stop_by_pidfile ".\frontend\.pid" "frontend"

echo Done.
exit /b 0

:restart
call "%~f0" stop
call "%~f0" start
exit /b 0

REM ---------------- helpers ----------------

:start_proc
REM args: workdir pidfile arg1 arg2 ...
set "WD=%~1"
set "PIDFILE=%~2"
shift
shift

REM Use PowerShell Start-Process with full path to npm.cmd
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$wd=(Resolve-Path '%WD%').Path; " ^
  "$npm=(Get-Command npm.cmd -ErrorAction Stop).Source; " ^
  "$p=Start-Process -FilePath $npm -WorkingDirectory $wd -ArgumentList @('%~1','%~2') -PassThru; " ^
  "Set-Content -Path '%PIDFILE%' -Value $p.Id -Encoding ASCII; " ^
  "Write-Host ('pid='+$p.Id)" 
if errorlevel 1 (
  echo Failed to start process in %WD%
  exit /b 1
)
exit /b 0

:try_shutdown
set "P=%~1"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "& {" ^
  "  try {" ^
  "    $ProgressPreference='SilentlyContinue';" ^
  "    [System.Net.WebRequest]::DefaultWebProxy = $null;" ^
  "    Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:%P%/api/admin/shutdown') -TimeoutSec 5 -Proxy $null | Out-Null;" ^
  "    Write-Host 'shutdown_sent';" ^
  "  } catch {" ^
  "    Write-Host ('shutdown_request_failed: ' + $_.Exception.Message);" ^
  "  }" ^
  "}"
exit /b 0

:wait_backend
REM args: port pidfile
set "P=%~1"
set "PIDFILE=%~2"
set "PID="

if exist "%PIDFILE%" (
  set /p PID=<"%PIDFILE%"
  set "PID=!PID: =!"
)

call :is_numeric "!PID!"
if errorlevel 1 (
  set "PID="
)

REM Wait loop: up to ~20 seconds
set "STOPPED=0"
for /L %%i in (1,1,20) do (
  if not "!PID!"=="" (
    call :pid_running "!PID!"
    if errorlevel 1 (
      set "STOPPED=1"
      goto :wait_backend_done
    )
  ) else (
    call :port_listening "%P%"
    if errorlevel 1 (
      set "STOPPED=1"
      goto :wait_backend_done
    )
  )
  timeout /t 1 /nobreak >nul
)

:wait_backend_done
if "!STOPPED!"=="1" (
  if exist "%PIDFILE%" del /q "%PIDFILE%" >nul 2>&1
  echo Backend stopped.
  exit /b 0
)

echo Backend still running after graceful wait.

REM Force kill by PID if we have one
if not "!PID!"=="" (
  echo Forcing taskkill PID !PID! ...
  taskkill /PID !PID! /T /F >nul 2>&1
  if exist "%PIDFILE%" del /q "%PIDFILE%" >nul 2>&1
  exit /b 0
)

REM Otherwise try to resolve PID from port (LISTENING)
for /f "tokens=5" %%p in ('netstat -ano ^| find ":%P% " ^| find "LISTENING"') do (
  set "KPID=%%p"
  goto :kill_port_pid
)
echo Could not resolve backend PID by port. Nothing more to do.
exit /b 0

:kill_port_pid
echo Forcing taskkill PID !KPID! (from port %P%) ...
taskkill /PID !KPID! /T /F >nul 2>&1
if exist "%PIDFILE%" del /q "%PIDFILE%" >nul 2>&1
exit /b 0

:stop_by_pidfile
REM args: pidfile label
set "PIDFILE=%~1"
set "LABEL=%~2"
if not exist "%PIDFILE%" exit /b 0
set /p PID=<"%PIDFILE%"
set "PID=%PID: =%"
call :is_numeric "%PID%"
if errorlevel 1 (
  del /q "%PIDFILE%" >nul 2>&1
  exit /b 0
)
call :pid_running "%PID%"
if errorlevel 1 (
  del /q "%PIDFILE%" >nul 2>&1
  exit /b 0
)
echo Stopping %LABEL% PID %PID% ...
taskkill /PID %PID% /T /F >nul 2>&1
del /q "%PIDFILE%" >nul 2>&1
exit /b 0

:is_numeric
set "X=%~1"
if "%X%"=="" exit /b 1
echo %X%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 exit /b 1
exit /b 0

:pid_running
REM arg: pid
tasklist /FI "PID eq %~1" 2>nul | find "%~1" >nul
if errorlevel 1 exit /b 1
exit /b 0

:port_listening
REM arg: port
netstat -ano | find ":%~1 " | find "LISTENING" >nul
if errorlevel 1 exit /b 1
exit /b 0
