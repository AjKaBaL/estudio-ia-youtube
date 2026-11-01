@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm run build
if errorlevel 1 (echo Falha ao preparar o aplicativo. Veja docs\MANUAL.md. & pause & exit /b 1)
call npx electron .
