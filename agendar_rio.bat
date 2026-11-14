@echo off
REM ==========================================================================
REM  Agenda o atualizar_rio.bat para rodar sozinho as segundas e quintas, 05:30,
REM  meia hora antes da atualizacao do GitHub (06:00). Rode UMA vez.
REM  Se o computador estiver desligado no horario, o painel usa o ultimo nivel enviado.
REM  Para desfazer:  schtasks /Delete /TN "Painel BAP - nivel do rio" /F
REM ==========================================================================
schtasks /Create /TN "Painel BAP - nivel do rio" /TR "\"%~dp0atualizar_rio.bat\" auto" /SC WEEKLY /D MON,THU /ST 05:30 /F
if errorlevel 1 (
  echo Nao consegui criar o agendamento. Copie a mensagem acima e mande para o Claude.
) else (
  echo Agendamento criado: segundas e quintas, 05:30.
)
pause
