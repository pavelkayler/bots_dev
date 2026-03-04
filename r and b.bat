@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "ROOT=%~dp0"
set "CACHE_DIR=%ROOT%backend\data\cache"

rem Preserve folder OUTSIDE repo root (sibling to project folder)
set "PRESERVE_DIR=%ROOT%..\bots_dev__preserve_cache"

echo [1/7] Stop...
call "m.bat" stop

echo.
echo [2/7] Preserve cache (backend\data\cache) to OUTSIDE folder...
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
echo [3/7] Push backend\data to repo (commit+push), excluding backend\data\cache...
rem Ensure git exists
where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: git not found in PATH.
  goto :err
)

pushd "%ROOT%"

rem Ensure we are inside a git work tree
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  popd
  echo ERROR: not a git repository in "%ROOT%".
  goto :err
)

rem Stage backend/data changes
git add -A backend/data
if errorlevel 1 (
  popd
  echo ERROR: git add failed.
  goto :err
)

rem Exclude cache from commit (do not push cache)
git reset -- backend/data/cache >nul 2>&1

rem If nothing staged, skip commit/push
git diff --cached --quiet
if not errorlevel 1 (
  echo   No staged changes in backend/data (after excluding cache). Skip commit/push.
  popd
  goto :after_push
)

rem Commit (message is intentionally generic)
git commit -m "backup backend/data"
if errorlevel 1 (
  popd
  echo ERROR: git commit failed.
  goto :err
)

rem Push
git push
if errorlevel 1 (
  popd
  echo ERROR: git push failed.
  goto :err
)

echo   backend/data pushed successfully.
popd

:after_push
echo.
echo [4/7] Replace (git reset/clean)...
call "replace.bat"
if errorlevel 1 goto :err

echo.
echo [5/7] Restore cache from OUTSIDE folder...
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
echo [6/7] Install deps...
call "m.bat" install
if errorlevel 1 goto :err

echo.
echo [7/7] Start...
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
