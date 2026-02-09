@echo off
REM ============================================
REM Job de Sincronizacao - Cockpit de Notas
REM Executa a cada 5 minutos via Task Scheduler
REM ============================================

REM Configura o diretorio
cd /d "C:\projeto de notas\backend"

REM Define o caminho do Node.js (ajuste se necessario)
SET NODE_PATH=node

REM Log de inicio
echo [%date% %time%] Iniciando sincronizacao... >> logs\sync.log

REM Executa o job
%NODE_PATH% dist\index.js >> logs\sync.log 2>&1

REM Log de fim
echo [%date% %time%] Sincronizacao finalizada (exit code: %ERRORLEVEL%) >> logs\sync.log
echo. >> logs\sync.log

exit /b %ERRORLEVEL%
