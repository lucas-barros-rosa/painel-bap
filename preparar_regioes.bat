@echo off
REM ==========================================================================
REM  Monta as regioes (BAP x MT/MS x Pantanal) com dados do IBGE e envia ao GitHub.
REM  Precisa rodar no seu computador (o IBGE nao responde aos servidores do GitHub).
REM  So e necessario uma vez, ou se voce trocar algum limite em pipeline\entrada\.
REM  Uso: no terminal do VS Code, com o ambiente ativo, digite  .\preparar_regioes.bat
REM ==========================================================================
cd /d "%~dp0pipeline"
python atualizar_dados.py --regioes
if errorlevel 1 (
  echo Deu erro ao montar as regioes. Copie a mensagem acima e mande para o Claude.
  pause
  exit /b 1
)
cd /d "%~dp0"
git add pipeline/entrada/regioes.geojson pipeline/entrada/mascaras.npz
git commit -m "regioes prontas"
git push
echo.
echo Pronto. Agora rode o workflow de novo na aba Actions do GitHub.
pause
