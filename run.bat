@echo off
setlocal

echo [1/4] Installing root dependencies...
call npm install
if errorlevel 1 exit /b 1

echo [2/4] Installing backend dependencies...
pushd backend
call npm install
if errorlevel 1 (
  popd
  exit /b 1
)
popd

echo [3/4] Installing frontend dependencies...
pushd frontend
call npm install
if errorlevel 1 (
  popd
  exit /b 1
)
popd

echo [4/4] Starting development services...
call dev.bat start
if errorlevel 1 exit /b 1

endlocal
