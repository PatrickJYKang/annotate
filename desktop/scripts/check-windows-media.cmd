@echo off
setlocal
title Annotate media compatibility check
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0check-windows-media.ps1"
echo.
pause
