# AudioWeave Studio Launcher
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Starting AudioWeave Studio Servers   " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonExe = "C:\Users\dhana\aw_env\Scripts\python.exe"

# Start Backend in a new terminal window
Write-Host "Starting Backend (FastAPI on http://localhost:8000)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectDir\backend'; `$env:PYTHONPATH = '$projectDir\backend'; & '$pythonExe' run.py"

# Start Frontend in a new terminal window
Write-Host "Starting Frontend (Vite on http://localhost:5173)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectDir\frontend'; npm run dev"

Write-Host "`nServers launched successfully!" -ForegroundColor Yellow
Write-Host "Open your browser at: http://localhost:5173" -ForegroundColor Cyan
