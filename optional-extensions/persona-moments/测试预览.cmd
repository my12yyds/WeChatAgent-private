@echo off
chcp 65001 >nul
"%LOCALAPPDATA%\WeChatAgentMoments\runtime\Scripts\python.exe" -X utf8 "%~dp0bridge\preview.py"
pause
