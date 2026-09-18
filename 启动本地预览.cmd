@echo off
setlocal
cd /d "%~dp0"

rem Start Vite in a detached window so this script can close safely.
start "BigApple Vite" /min cmd /c ""C:\Program Files\nodejs\node.exe" "node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5173 > vite-server.out.log 2> vite-server.err.log"

rem Give Vite a moment to bind, then open the fixed preview URL.
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:5173/"
endlocal
