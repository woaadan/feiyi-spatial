@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   山河入谱 · 本地预览
echo   http://localhost:8000
echo.
python -m http.server 8000
pause
