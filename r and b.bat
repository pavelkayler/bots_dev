@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [1/3] Running replace.bat...
call "replace.bat"
if errorlevel 1 goto :err

echo.
echo [2/3] Running m.bat install...
call "m.bat" install
if errorlevel 1 goto :err

echo.
echo [3/3] Running m.bat start...
call "m.bat" start
if errorlevel 1 goto :err

echo.
echo Done.
pause
exit /b 0

:err
set "RC=%errorlevel%"
echo.
echo ERROR: step failed with code %RC%
pause
exit /b %RC%
