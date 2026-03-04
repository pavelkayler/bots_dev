@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "ROOT=%~dp0"
set "CACHE_DIR=%ROOT%backend\data\cache"

rem Preserve folder OUTSIDE repo root (sibling to project folder)
set "PRESERVE_DIR=%ROOT%..\bots_dev__preserve_cache"

echo [1/6] Stop...
call "m.bat" stop

echo.
echo [2/6] Preserve cache (backend\data\cache) to OUTSIDE folder...
if exist "%PRESERVE_DIR%" (
  rmdir /s /q "%PRESERVE_DIR%"
)
mkdir "%PRESERVE_DIR%" >nul 2>&1

if exist "%CACHE_DIR%" (
  echo   Copying "%CACHE_DIR%"  ^>  "%PRESERVE_DIR%\cache"
  robocopy "%CACHE_DIR%" "%PRESERVE_DIR%\cache" /E /R:1 /W:1 /NFL /NDL >nul
) else (
  echo   Cache dir not found, nothing to preserve.
)

echo.
echo [3/6] Replace (git reset/clean)...
call "replace.bat"
if errorlevel 1 goto :err

echo.
echo [4/6] Restore cache from OUTSIDE folder...
if exist "%PRESERVE_DIR%\cache" (
  if not exist "%CACHE_DIR%" (
    mkdir "%CACHE_DIR%" >nul 2>&1
  )
  echo   Restoring "%PRESERVE_DIR%\cache"  ^>  "%CACHE_DIR%"
  robocopy "%PRESERVE_DIR%\cache" "%CACHE_DIR%" /E /R:1 /W:1 /NFL /NDL >nul
) else (
  echo   No preserved cache found, skip restore.
)

echo.
echo [5/6] Install deps...
call "m.bat" install
if errorlevel 1 goto :err

echo.
echo [6/6] Start...
call "m.bat" start
if errorlevel 1 goto :err

goto :menu

:menu
echo.
echo ===== MENU =====
echo 1 - start
echo 2 - stop
echo 3 - status
echo 4 - clear preserved cache (outside folder)
echo 0 - exit
set /p "choice=Select: "

if "%choice%"=="1" goto :do_start
if "%choice%"=="2" goto :do_stop
if "%choice%"=="3" goto :do_status
if "%choice%"=="4" goto :do_clear_preserve
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

:do_status
call "m.bat" status
echo.
pause
goto :menu

:do_clear_preserve
if exist "%PRESERVE_DIR%" (
  rmdir /s /q "%PRESERVE_DIR%"
  echo Removed: "%PRESERVE_DIR%"
) else (
  echo No preserved cache folder found.
)
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
