@echo off
title Clip Vault Launcher

REM -- Watcher (own window, venv activated)
start "Clip Vault – Watcher" cmd /k "cd /d C:\Users\wildc\Jsleek21\watcher && .venv\Scripts\activate && python watcher.py"

REM -- Web server (own window)
start "Clip Vault – Web" cmd /k "cd /d C:\Users\wildc\Jsleek21\web && python -m http.server 8080"

REM -- Give the server a moment, then open the browser
timeout /t 2 /nobreak >nul
start "" "http://localhost:8080"
