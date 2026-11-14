@echo off
REM ==========================================================================
REM  Gera dados SIMULADOS e abre o painel no navegador, para ver mudanças no site.
REM  Uso: no terminal do VS Code, com o ambiente ativo, digite  .\testar_no_computador.bat
REM  Para desligar o servidor depois: Ctrl+C no terminal.
REM ==========================================================================
cd /d "%~dp0pipeline"
python atualizar_dados.py --demo
if errorlevel 1 (
  echo Deu erro ao gerar os dados simulados. Confira se o ambiente "dados" esta ativo.
  pause
  exit /b 1
)
cd /d "%~dp0site"
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000"
python -m http.server 8000
