@echo off
title Unlimited Squad Team Voice (Group ID Join)
echo Checking dependencies...
if not exist "node_modules" (
    echo Installing express and socket.io...
    call npm install
)

echo.
echo =======================================================
echo Unlimited Squad Voice Server is starting on Port 4000...
echo Opening http://localhost:4000 in your browser...
echo =======================================================
echo.
start http://localhost:4000
node server.js
pause
