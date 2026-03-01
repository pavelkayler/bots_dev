@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo [1/4] Stop...
call "m.bat" stop
if errorlevel 1 goto :err

echo [2/4] Replace (git reset)...
call "replace.bat"
if errorlevel 1 goto :err

echo [3/4] Install deps...
call "m.bat" install
if errorlevel 1 goto :err

echo [4/4] Start...
call "m.bat" start
if errorlevel 1 goto :err

echo Done.
exit /b 0

:err
echo ERROR: failed with code %errorlevel%
pause
exit /b %errorlevel%