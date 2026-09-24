@echo off
title TRAP Discipline
cd /d "%~dp0"

rem ---- find Python 3 ----
set "PY=py -3"
%PY% --version >nul 2>nul
if errorlevel 1 set "PY=python"
%PY% --version >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Python 3.10 or newer is required and was not found.
  echo  Opening the download page. Install it with "Add python.exe to PATH"
  echo  checked, then run this file again.
  start https://www.python.org/downloads/
  pause
  exit /b 1
)

rem ---- first run: create a private environment and install packages ----
if not exist ".venv\Scripts\python.exe" (
  echo First run: setting things up. This takes a minute...
  %PY% -m venv .venv || (echo Could not create the environment. & pause & exit /b 1)
)
call ".venv\Scripts\activate.bat"
python -m pip install --quiet --disable-pip-version-check -r requirements.txt
if errorlevel 1 (
  echo.
  echo  Package install failed. Check your internet connection and run this again.
  pause
  exit /b 1
)

echo Starting TRAP Discipline...
python -m server %*
echo.
echo TRAP has stopped. You can close this window.
pause
