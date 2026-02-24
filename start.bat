@echo off
cd /d "%~dp0"

cd backend
call npm i
start "backend" cmd /k "npm run dev"

cd ..\frontend
call npm i
start "frontend" cmd /k "npm run dev"