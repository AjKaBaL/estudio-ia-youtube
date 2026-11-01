@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Instalando dependencias (somente na primeira vez)...
call npm ci
if errorlevel 1 (echo Falhou. Veja docs\MANUAL.md, secao Problemas comuns. & pause & exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\criar-atalho.ps1"
echo Pronto. Agora abra pelo atalho "Estudio IA YouTube" na Area de Trabalho.
pause
