# Painel Hidroclimático da Bacia do Alto Paraguai

Autor: Lucas Barros da Rosa — University of British Columbia

```
site/                     o site (é o que vai para o Cloudflare)
pipeline/                 scripts em Python que baixam os dados e preenchem site/dados/
  config.py               tudo o que dá para ajustar
  fontes.py               downloads (IBGE, CHIRPS, ERA5-Land, C3S, ANA, NOAA)
  processamento.py        cálculos (anomalias, SPI, SPEI, ondas de calor, El Niño...)
  saida.py                monta os arquivos que o site lê
  atualizar_dados.py      o script que você roda
  demo.py                 dados simulados para testar
  entrada/bap.geojson     o seu limite da BAP
.github/workflows/        a automação que roda no GitHub duas vezes por semana
```

O passo a passo de instalação e publicação está na conversa com o Claude. Resumo:

1. `pip install -r pipeline/requirements.txt` (dentro do ambiente `dados`)
2. `python atualizar_dados.py --demo` na pasta `pipeline`, para testar o site
3. Publicar o projeto no GitHub (VS Code > Source Control > Publish to GitHub)
4. Criar o projeto no Cloudflare Pages e cadastrar 3 segredos e 1 variável no GitHub
5. Rodar o workflow "Atualizar painel" na aba Actions do GitHub

## Segredos e variáveis no GitHub (Settings > Secrets and variables > Actions)

| Nome | Tipo | Conteúdo |
|---|---|---|
| `CDSAPI_KEY` | Secret | a chave do Copernicus (só o código depois de `key:`) |
| `CLOUDFLARE_API_TOKEN` | Secret | token do Cloudflare com permissão "Cloudflare Pages: Edit" |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | o "Account ID" da sua conta Cloudflare |
| `CLOUDFLARE_PROJETO` | Variable | o nome do projeto no Cloudflare Pages (ex.: `painel-bap`) |

## Como funciona a atualização automática

- Roda às segundas e quintas, 06:00 de Cuiabá, e quando você clica em "Run workflow".
- Os dados baixados ficam guardados no cache do GitHub; cada execução só baixa o que é novo.
- A primeira carga (temperatura desde 1990) pode levar mais de 5 horas. O script para sozinho
  perto do limite e a execução seguinte continua de onde parou. O site só é publicado quando
  uma execução termina tudo.

## Pontos a conferir na primeira execução real

1. **Áreas das regiões** impressas no log: a soma deve ficar perto de 363 mil km².
2. **CHIRPS v3**: se mudar o endereço, ajuste `CHIRPS_MENSAL` e `CHIRPS_DIARIO_*` em `config.py`.
3. **ERA5-Land**: se o Copernicus recusar o pedido de um ano inteiro, o script tenta mês a mês.
4. **C3S**: os números de sistema em `C3S_MODELOS` mudam com o tempo; se um falhar, o script segue com o outro.
5. **ANA**: se o serviço não responder, a aba do rio fica vazia; dá para usar CSV em `pipeline/entrada/nivel_<codigo>.csv`.
