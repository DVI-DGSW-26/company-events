@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js 가 설치되어 있지 않습니다.
  echo   index.html 을 더블클릭해서 여셔도 됩니다.
  echo   다만 사진과 PDF 는 저장되지 않고 새 탭에서 열립니다.
  echo.
  pause
  exit /b 1
)

start "" http://localhost:8787/
node "%~dp0tools\serve.mjs"
pause
