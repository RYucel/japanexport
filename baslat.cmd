@echo off
chcp 65001 >nul
cd /d "%~dp0"
title RAV4 Avcisi - Panel
echo Panel baslatiliyor: http://localhost:4173
start "" http://localhost:4173
node server.js
pause
