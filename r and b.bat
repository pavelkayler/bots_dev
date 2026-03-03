@echo off
setlocal EnableExtensions EnableDelayedExpansion
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

goto :menu

:menu
echo.
echo ===== MENU =====
echo 1 - start
echo 2 - stop
echo 0 - exit
set /p "choice=Select: "

if "%choice%"=="1" goto :do_start
if "%choice%"=="2" goto :do_stop
if "%choice%"=="0" goto :done

echo Invalid choice: "%choice%"
goto :menu

:do_start
call "m.bat" start
echo.
pause
goto :menu

:do_stop
call "m.bat" stop
echo.
pause
goto :menu

:done
echo Exiting...
exit /b 0

:err
echo.
echo ERROR: failed with code %errorlevel%
echo.
pause
exit /b %errorlevel%
