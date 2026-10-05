@echo off
setlocal

set "PROJECT_DIR=D:\AI开发\nasdaq-qdii-dashboard"
set "NODE_BIN=C:\Program Files\nodejs\node.exe"
set "VINEXT=%PROJECT_DIR%\node_modules\vinext\dist\cli.js"
set "LOG_FILE=%PROJECT_DIR%\local-server.log"

cd /d "%PROJECT_DIR%"
if not exist "%VINEXT%" (
  echo [%date% %time%] Missing node_modules/vinext. Run npm install first.>>"%LOG_FILE%"
  exit /b 1
)

echo [%date% %time%] Starting Nasdaq QDII dashboard on http://localhost:8004>>"%LOG_FILE%"
set HTTP_PROXY=
set HTTPS_PROXY=
set ALL_PROXY=
set http_proxy=
set https_proxy=
set all_proxy=
set NO_PROXY=localhost,127.0.0.1
set no_proxy=localhost,127.0.0.1
"%NODE_BIN%" "%VINEXT%" dev --port 8004 --host 127.0.0.1 >>"%LOG_FILE%" 2>&1
