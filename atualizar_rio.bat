@echo off
REM ==========================================================================
REM  Baixa o nivel do rio Paraguai da ANA no SEU computador e envia ao GitHub.
REM  (A ANA, como o IBGE, pode nao responder aos servidores do GitHub.)
REM  Uso: .\atualizar_rio.bat         (no terminal do VS Code ou com dois cliques)
REM  O agendamento automatico chama:  atualizar_rio.bat auto   (sem pausa no fim)
REM ==========================================================================
cd /d "%~dp0pipeline"
set "PY=%USERPROFILE%\anaconda3\envs\dados\python.exe"
if not exist "%PY%" set "PY=python"
"%PY%" atualizar_dados.py --rio
if errorlevel 1 goto fim
cd /d "%~dp0"
git add pipeline/entrada/nivel_*.csv
git commit -m "nivel do rio Paraguai (ANA)"
git push
:fim
if /i not "%~1"=="auto" pause
