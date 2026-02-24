@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo [1/3] Backend dependencies...
if exist "backend\node_modules\" (
  echo - backend\node_modules already exists, skip npm install
) else (
  pushd "backend"
  call npm install
  if errorlevel 1 (
    popd
    echo [ERROR] backend npm install failed
    exit /b 1
  )
  popd
)

echo [2/3] Frontend dependencies...
if exist "frontend\node_modules\" (
  echo - frontend\node_modules already exists, skip npm install
) else (
  pushd "frontend"
  call npm install
  if errorlevel 1 (
    popd
    echo [ERROR] frontend npm install failed
    exit /b 1
  )
  popd
)

echo [3/3] Starting dev servers (manual stop)...
start "bots_dev-backend"  cmd /c "cd /d ""%~dp0backend""  ^&^& npm run dev"
start "bots_dev-frontend" cmd /c "cd /d ""%~dp0frontend"" ^&^& npm run dev"

echo Done. Close the opened windows to stop services.
endlocal