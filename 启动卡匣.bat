@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 卡匣 · Switch 卡带管家

where python >nul 2>nul
if not errorlevel 1 (
  python server.py --open
  if errorlevel 1 pause
  goto end
)

where py >nul 2>nul
if not errorlevel 1 (
  py -3 server.py --open
  if errorlevel 1 pause
  goto end
)

echo.
echo 没有找到 Python。
echo 你可以直接双击 index.html 打开卡匣，但「安装到桌面 / 离线」功能需要本地服务器。
echo 安装 Python: https://www.python.org/downloads/
echo.
pause

:end
