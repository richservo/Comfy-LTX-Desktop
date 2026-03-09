@echo off
title Comfy LTX Desktop

:: Check for Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install it from https://nodejs.org/
    pause
    exit /b 1
)

:: Check for pnpm
where pnpm >nul 2>&1
if errorlevel 1 (
    echo pnpm not found, installing...
    npm install -g pnpm
    if errorlevel 1 (
        echo [ERROR] Failed to install pnpm.
        pause
        exit /b 1
    )
)

:: Check for git
where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git not found. Install it from https://git-scm.com/
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies...
    pnpm install
    if errorlevel 1 (
        echo [ERROR] pnpm install failed.
        pause
        exit /b 1
    )
)

:: Launch
echo Starting Comfy LTX Desktop...
pnpm dev
