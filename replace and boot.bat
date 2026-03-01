@echo off
setlocal EnableExtensions

cd /d "%~dp0"

call "replace.bat"
call "m.bat" install
call "m.bat" start

pause