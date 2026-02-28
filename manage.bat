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
powershell -NoProfile -Command "$wd=(Resolve-Path '.\\backend').Path; $p=Start-Process -FilePath 'cmd.exe' -WorkingDirectory $wd -ArgumentList '/k','npm run dev' -PassThru; Set-Content -Path '.\\backend\\.pid' -Value $p.Id"
powershell -NoProfile -Command "$wd=(Resolve-Path '.\\frontend').Path; $p=Start-Process -FilePath 'cmd.exe' -WorkingDirectory $wd -ArgumentList '/k','npm run dev' -PassThru; Set-Content -Path '.\\frontend\\.pid' -Value $p.Id"
goto :eof

:stop
if not defined PORT set "PORT=8080"
echo Requesting backend graceful shutdown on port %PORT%...
powershell -NoProfile -Command "try { Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:%PORT%/api/admin/shutdown') | Out-Null; Write-Output 'shutdown_sent' } catch { Write-Output 'shutdown_request_failed' }"

if exist backend\.pid (
  set /p BACKEND_PID=<backend\.pid
  powershell -NoProfile -Command "$pidValue=%BACKEND_PID%; for ($i=0; $i -lt 20; $i++) { if (-not (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) { exit 0 }; Start-Sleep -Milliseconds 500 }; exit 1"
  if errorlevel 1 (
    echo Backend still running. Forcing taskkill...
    taskkill /PID %BACKEND_PID% /T /F >nul 2>nul
  )
  del /q backend\.pid >nul 2>nul
) else (
  echo backend\.pid not found; skipping backend PID wait.
)

if exist frontend\.pid (
  set /p FRONTEND_PID=<frontend\.pid
  taskkill /PID %FRONTEND_PID% /T /F >nul 2>nul
  del /q frontend\.pid >nul 2>nul
) else (
  echo frontend\.pid not found; skipping frontend stop.
)
goto :eof

:restart
call "%~f0" stop
call "%~f0" start
goto :eof

:usage
echo Usage: manage.bat ^<install^|start^|stop^|restart^>
exit /b 1
