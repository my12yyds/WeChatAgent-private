@echo off
chcp 65001 >nul
if not exist "%LOCALAPPDATA%\WeChatAgentMoments\runtime\Scripts\python.exe" (
  py -3 -m venv "%LOCALAPPDATA%\WeChatAgentMoments\runtime"
  if errorlevel 1 goto failed
)
"%LOCALAPPDATA%\WeChatAgentMoments\runtime\Scripts\python.exe" -m pip install -r "%~dp0bridge\requirements.txt"
if errorlevel 1 goto failed
echo 运行环境安装完成。插件 pythonExe 可留空。
pause
exit /b 0
:failed
echo 安装失败。请确认已安装64位Python和py启动器，并检查网络。
pause
exit /b 1
