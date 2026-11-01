@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\criar-atalho.ps1"
if errorlevel 1 (echo Nao foi possivel criar o atalho. & pause & exit /b 1)
timeout /t 3 >nul
