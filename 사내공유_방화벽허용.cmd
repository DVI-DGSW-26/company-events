@echo off
chcp 65001 >nul
title 행사 아카이브 - 사내 공유 허용

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   관리자 권한이 필요합니다.
  echo   이 파일을 마우스 오른쪽 버튼으로 눌러 "관리자 권한으로 실행" 을 선택하세요.
  echo.
  pause
  exit /b 1
)

netsh advfirewall firewall delete rule name="행사 아카이브 (8787)" >nul 2>&1
netsh advfirewall firewall add rule name="행사 아카이브 (8787)" dir=in action=allow protocol=TCP localport=8787 profile=private,domain >nul

if errorlevel 1 (
  echo.
  echo   방화벽 규칙을 추가하지 못했습니다. 사내 IT 담당자에게 8787 포트 허용을 요청하세요.
  echo.
) else (
  echo.
  echo   사내 네트워크에서 접속할 수 있도록 8787 포트를 열었습니다.
  echo   이제 "열기.cmd" 를 실행하고, 화면에 표시되는 주소를 동료에게 알려주세요.
  echo.
  echo   ※ 공용 Wi-Fi 등 '공용 네트워크' 에서는 열지 않았습니다. 사내망에서만 접속됩니다.
  echo.
)
pause
