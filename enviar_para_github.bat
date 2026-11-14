@echo off
REM ==========================================================================
REM  Envia para o GitHub tudo o que mudou nesta pasta (código, site, regiões).
REM  Uso: no terminal do VS Code, digite  .\enviar_para_github.bat
REM       ou dê dois cliques neste arquivo no Explorador de Arquivos.
REM ==========================================================================
cd /d "%~dp0"
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo.
  echo ERRO: esta pasta nao esta ligada ao GitHub ^(falta a pasta oculta .git^).
  echo Veja no guia a secao "Religar a pasta ao GitHub".
  pause
  exit /b 1
)
echo.
echo Arquivos que mudaram:
git status --short
echo.
set "MSG="
set /p MSG=Descreva a alteracao em poucas palavras (ou so Enter): 
if "%MSG%"=="" set "MSG=atualizacao do painel"
git add -A
git commit -m "%MSG%"
git push
if errorlevel 1 (
  echo.
  echo ERRO: o envio para o GitHub falhou. Leia a mensagem acima ^(em ingles^) e me mande se nao entender.
  pause
  exit /b 1
)
echo.
echo Pronto. Confira em https://github.com e, se quiser, rode o workflow na aba Actions.
pause
