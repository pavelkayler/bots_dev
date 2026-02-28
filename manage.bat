@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "CMD=%~1"
if "%CMD%"=="" goto :usage

if /I "%CMD%"=="install" goto :install
if /I "%CMD%"=="start" goto :start
if /I "%CMD%"=="stop" goto :stop
if /I "%CMD%"=="restart" goto :restart

goto :usage

:install
pushd backend
call npm i
popd
pushd frontend
call npm i
popd
goto :eof

:start
if not defined PORT set "PORT=8080"
powershell -NoProfile -Command "$wd=(Resolve-Path '.\\backend').Path; $p=Start-Process -FilePath 'npm' -WorkingDirectory $wd -ArgumentList 'run','dev' -PassThru; Set-Content -Path '.\\backend\\.pid' -Value $p.Id"
powershell -NoProfile -Command "$wd=(Resolve-Path '.\\frontend').Path; $p=Start-Process -FilePath 'npm' -WorkingDirectory $wd -ArgumentList 'run','dev' -PassThru; Set-Content -Path '.\\frontend\\.pid' -Value $p.Id"
goto :eof

:stop
if not defined PORT set "PORT=8080"
set "BACKEND_PID="
set "BACKEND_PID_VALID="
echo Requesting backend graceful shutdown on port %PORT%...
powershell -NoProfile -Command "try { Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:%PORT%/api/admin/shutdown') | Out-Null; Write-Output 'shutdown_sent' } catch { Write-Output 'shutdown_request_failed' }"

if exist backend\.pid (
  set /p BACKEND_PID=<backend\.pid
) else (
  echo backend\.pid not found; skipping backend PID wait.
)

if defined BACKEND_PID (
  set "BACKEND_PID_INVALID="
  for /f "delims=0123456789" %%A in ("%BACKEND_PID%") do set "BACKEND_PID_INVALID=1"
  if not defined BACKEND_PID_INVALID set "BACKEND_PID_VALID=1"
)

set "BACKEND_DOWN="
if defined BACKEND_PID_VALID (
  call :wait_pid_exit "%BACKEND_PID%"
)
if not defined BACKEND_DOWN (
  call :wait_port_down "%PORT%"
)

if not defined BACKEND_DOWN (
  echo Backend still running after graceful wait. Forcing taskkill...
  if defined BACKEND_PID_VALID (
    taskkill /PID %BACKEND_PID% /T /F >nul 2>nul
  ) else (
    call :kill_pid_by_port "%PORT%"
  )
)

if exist backend\.pid del /q backend\.pid >nul 2>nul

if exist frontend\.pid (
  set /p FRONTEND_PID=<frontend\.pid
  taskkill /PID %FRONTEND_PID% /T /F >nul 2>nul
  del /q frontend\.pid >nul 2>nul
) else (
  echo frontend\.pid not found; skipping frontend stop.
)
goto :eof

:wait_pid_exit
set "WAIT_PID=%~1"
for /l %%I in (1,1,20) do (
  tasklist /FI "PID eq %WAIT_PID%" | find "%WAIT_PID%" >nul
  if errorlevel 1 (
    set "BACKEND_DOWN=1"
    goto :eof
  )
  timeout /t 1 /nobreak >nul
)
goto :eof

:wait_port_down
set "WAIT_PORT=%~1"
for /l %%I in (1,1,20) do (
  powershell -NoProfile -Command "try { Invoke-RestMethod -Method Get -Uri ('http://127.0.0.1:%WAIT_PORT%/api/doctor') -TimeoutSec 1 | Out-Null; exit 1 } catch { exit 0 }"
  if not errorlevel 1 (
    set "BACKEND_DOWN=1"
    goto :eof
  )
  timeout /t 1 /nobreak >nul
)
goto :eof

:kill_pid_by_port
set "PORT_TO_KILL=%~1"
set "RESOLVED_PID="
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /R /C:":%PORT_TO_KILL% .*LISTENING"') do (
  set "RESOLVED_PID=%%P"
  goto :kill_resolved
)
:kill_resolved
if defined RESOLVED_PID (
  taskkill /PID %RESOLVED_PID% /T /F >nul 2>nul
) else (
  echo Could not resolve backend PID by port %PORT_TO_KILL%.
)
goto :eof

:restart
call "%~f0" stop
call "%~f0" start
goto :eof

:usage
echo Usage: manage.bat ^<install^|start^|stop^|restart^>
exit /b 1
