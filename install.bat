@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo 正在安装 dsh-anime-theme ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
endlocal
