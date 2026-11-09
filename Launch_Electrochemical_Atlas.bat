@echo off
setlocal EnableExtensions
set "ATLAS_HOME=%~dp0"
set "ATLAS_RUNTIME=%ATLAS_HOME%runtime\atlas-windows-amd64.exe"
set "ATLAS_APP=%ATLAS_HOME%app\index.html"

rem The runtime lives beside this script in runtime\. Keep the entire
rem extracted Electrochemical-Atlas folder intact; the source ZIP has no EXE.
if not exist "%ATLAS_RUNTIME%" goto missing_runtime
if not exist "%ATLAS_APP%" goto missing_app
pushd "%ATLAS_HOME%" >nul 2>&1
if errorlevel 1 goto inaccessible_folder

"%ATLAS_RUNTIME%" %*
set "ATLAS_EXIT_CODE=%ERRORLEVEL%"
popd
if not "%ATLAS_EXIT_CODE%"=="0" (
  echo.
  echo Electrochemical Atlas exited with code %ATLAS_EXIT_CODE%.
  pause
)
exit /b %ATLAS_EXIT_CODE%

:missing_runtime
echo.
echo Electrochemical Atlas could not find the Windows runtime.
echo Expected file:
echo   "%ATLAS_RUNTIME%"
echo.
echo Please download the WINDOWS PORTABLE release, not the GitHub source ZIP.
echo In File Explorer, right-click the ZIP and choose Extract All.
echo Open the extracted Electrochemical-Atlas folder, and run this .bat file.
echo Do not run the launcher from inside the ZIP or extract it by itself.
echo.
echo If you extracted everything and the EXE is still missing, look in
echo Windows Security - Protection history to see whether it was quarantined.
echo Only restore a quarantined program if you trust its source.
echo.
pause
exit /b 2

:missing_app
echo.
echo Electrochemical Atlas cannot find app\index.html beside the launcher.
echo The application folder is incomplete; extract the ENTIRE ZIP again.
echo Expected file:
echo   "%ATLAS_APP%"
echo.
pause
exit /b 3

:inaccessible_folder
echo.
echo Could not open the extracted Electrochemical-Atlas folder.
echo Move the full folder to a writable location, such as Documents,
echo and try again.
echo.
pause
exit /b 4
