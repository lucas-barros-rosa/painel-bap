@echo off
REM ==========================================================================
REM  Envia para o GitHub tudo o que mudou nesta pasta (código, site, regiões).
REM  Uso: no terminal do VS Code, digite  .\enviar_para_github.bat
REM       ou dê dois cliques neste arquivo no Explorador de Arquivos.
REM ==========================================================================
cd /d "%~dp0"
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
echo.
echo Pronto. Confira em https://github.com e, se quiser, rode o workflow na aba Actions.
pause
