@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 卡匣 · Switch 卡带管家

set "PYTHON_CMD="
where python >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=python"
if not defined PYTHON_CMD (
  where py >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=py -3"
)

if defined PYTHON_CMD (
  echo 正在使用 Python 启动卡匣…
  %PYTHON_CMD% server.py --open
  if not errorlevel 1 goto end
  echo.
  echo Python 启动失败，改用 Windows 自带 PowerShell…
)

echo 正在使用 Windows PowerShell 启动卡匣…
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\serve-web.ps1" -Open
if errorlevel 1 (
  echo.
  echo 启动失败。请确认 8765 端口没有被其他程序占用，或把上面的错误信息发给我。
  pause
)

:end
