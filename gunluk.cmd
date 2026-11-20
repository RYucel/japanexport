@echo off
chcp 65001 >nul
cd /d "%~dp0"
title RAV4 Avcisi - Gunluk rapor
node src\daily.js
echo.
echo Rapor: data\reports\
pause
