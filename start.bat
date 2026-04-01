@echo off
title LTX Desktop - Starting
cd /d "%~dp0"

echo.
echo  ========================================
echo   LTX Desktop Launcher
echo  ========================================
echo.

:: -------------------------------------------------------
:: 1. Node.js
:: -------------------------------------------------------
where node >nul 2>&1
if not errorlevel 1 goto :node_ok

echo [*] Node.js not found. Attempting to install...

:: Try winget first
where winget >nul 2>&1
if errorlevel 1 goto :node_winget_skip

echo [*] Installing Node.js via winget...
winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements -s winget >nul 2>&1
set "PATH=%PROGRAMFILES%\nodejs;%PATH%"
where node >nul 2>&1
if not errorlevel 1 goto :node_ok

:node_winget_skip
echo [*] Downloading Node.js installer...
powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi' -OutFile '%TEMP%\node-install.msi'" 2>nul
if not exist "%TEMP%\node-install.msi" goto :node_fail

echo [*] Running Node.js installer...
msiexec /i "%TEMP%\node-install.msi" /passive
del "%TEMP%\node-install.msi" >nul 2>&1
set "PATH=%PROGRAMFILES%\nodejs;%PATH%"
where node >nul 2>&1
if not errorlevel 1 goto :node_ok

:node_fail
echo.
echo [ERROR] Could not install Node.js automatically.
echo         Please install it manually from https://nodejs.org/
echo.
pause
exit /b 1

:node_ok
echo [OK] Node.js found.

:: -------------------------------------------------------
:: 2. Git
:: -------------------------------------------------------
set "PORTABLE_GIT=%LOCALAPPDATA%\LTXDesktop\git"

where git >nul 2>&1
if not errorlevel 1 goto :git_ok

if exist "%PORTABLE_GIT%\cmd\git.exe" goto :git_portable_ok

echo [*] Git not found. Downloading portable git...
powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/MinGit-2.47.1.2-64-bit.zip' -OutFile '%TEMP%\mingit.zip'" 2>nul
if not exist "%TEMP%\mingit.zip" goto :git_warn

echo [*] Extracting portable git...
if not exist "%PORTABLE_GIT%" mkdir "%PORTABLE_GIT%"
powershell -NoProfile -Command "Expand-Archive -Path '%TEMP%\mingit.zip' -DestinationPath '%PORTABLE_GIT%' -Force" 2>nul
del "%TEMP%\mingit.zip" >nul 2>&1

if not exist "%PORTABLE_GIT%\cmd\git.exe" goto :git_warn

:git_portable_ok
set "PATH=%PORTABLE_GIT%\cmd;%PATH%"
goto :git_ok

:git_warn
echo [WARNING] Git not available. Custom node installation may not work.
goto :git_done

:git_ok
echo [OK] Git available.

:git_done

:: -------------------------------------------------------
:: 3. Pull latest code
:: -------------------------------------------------------
if exist ".git" (
    echo [*] Checking for updates...
    git pull >nul 2>&1
    if not errorlevel 1 (
        echo [OK] Up to date.
    ) else (
        echo [NOTE] Could not pull updates. Continuing with current version.
    )
) else (
    echo [NOTE] Not a git repo, skipping update check.
)

:: -------------------------------------------------------
:: 4. pnpm
:: -------------------------------------------------------
set "PNPM_CMD=pnpm"

where corepack >nul 2>&1
if errorlevel 1 goto :pnpm_global

echo [*] Preparing pinned pnpm via corepack...
call corepack enable >nul 2>&1
call corepack prepare pnpm@10.30.3 --activate >nul 2>&1
if errorlevel 1 goto :pnpm_global
set "PNPM_CMD=corepack pnpm"
goto :pnpm_ok

:pnpm_global
where pnpm >nul 2>&1
if not errorlevel 1 goto :pnpm_ok

echo [*] pnpm not found. Installing...
call npm install -g pnpm >nul 2>&1
where pnpm >nul 2>&1
if not errorlevel 1 goto :pnpm_ok

echo.
echo [ERROR] Failed to install pnpm.
echo.
pause
exit /b 1

:pnpm_ok
echo [OK] pnpm found.

:: -------------------------------------------------------
:: 5. Dependencies
:: -------------------------------------------------------
echo [*] Checking dependencies...
call %PNPM_CMD% install
if errorlevel 1 goto :deps_fail
goto :deps_ok

:deps_fail
echo.
echo [ERROR] Dependency installation failed.
echo.
pause
exit /b 1

:deps_ok
echo [OK] Dependencies ready.

:: -------------------------------------------------------
:: 6. Launch
:: -------------------------------------------------------
echo.
echo  ========================================
echo   Launching LTX Desktop...
echo  ========================================
echo.
call %PNPM_CMD% dev
if errorlevel 1 goto :launch_fail
goto :launch_done

:launch_fail
echo.
echo [ERROR] LTX Desktop exited with an error.
echo.
pause

:launch_done
