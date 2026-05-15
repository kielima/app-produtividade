@echo off
:: Encerra apenas processos PowerShell rodando na porta 8080
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8080 "') do (
    for /f "tokens=1" %%b in ('tasklist /FI "PID eq %%a" /FO CSV 2^>nul ^| findstr /i "powershell"') do (
        taskkill /F /PID %%a >nul 2>&1
    )
)

:: Inicia o servidor PowerShell em segundo plano (janela oculta)
start "" /b powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0servidor.ps1"

:: Aguarda 1 segundo para o servidor iniciar
timeout /t 1 /nobreak >nul

:: Abre o dashboard no Chrome
start "" "http://localhost:8080/dashboard.html"
