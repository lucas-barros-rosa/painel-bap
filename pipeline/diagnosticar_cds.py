"""
Mostra os pedidos que a sua conta tem no Copernicus (CDS), inclusive os que NÃO aparecem na página
"Your requests", e pode cancelar os que estão parados na fila.
Uso (terminal do VS Code, ambiente "dados" ativo, pasta pipeline):
    python diagnosticar_cds.py              -> só mostra
    python diagnosticar_cds.py --cancelar   -> mostra e cancela os que estão na fila ou rodando
"""
import sys
from collections import Counter
from pathlib import Path
import requests

# lê url e chave do arquivo C:\Users\lucas\.cdsapirc (o mesmo que o cdsapi usa)
conf = dict(l.split(":", 1) for l in (Path.home() / ".cdsapirc").read_text().splitlines() if ":" in l)
url = conf["url"].strip().rstrip("/")                   # https://cds.climate.copernicus.eu/api
cab = {"PRIVATE-TOKEN": conf["key"].strip()}            # a chave vai no cabeçalho; não aparece na tela

# 1) todos os pedidos da conta, do mais novo para o mais antigo (até 200)
pedidos, prox = [], f"{url}/retrieve/v1/jobs?limit=100&sortby=-created"
while prox and len(pedidos) < 200:
    r = requests.get(prox, headers=cab, timeout=60)
    r.raise_for_status()
    j = r.json()
    pedidos += j.get("jobs", [])
    prox = next((l["href"] for l in j.get("links", []) if l.get("rel") == "next"), None)

print(f"Pedidos encontrados: {len(pedidos)}")
print("Por situação:", dict(Counter(p.get("status") for p in pedidos)))
print("Por conjunto de dados e situação:")
for (ds, st), n in sorted(Counter((p.get("processID"), p.get("status")) for p in pedidos).items()):
    print(f"   {ds:45s} {st:12s} {n}")

parados = [p for p in pedidos if p.get("status") in ("accepted", "running")]
print(f"\nNa fila ou rodando agora: {len(parados)}")
for p in parados:
    print(f"   {p.get('created', '')[:19]}  {p.get('processID')}  {p.get('status')}  {p.get('jobID')}")

# 2) o que o Copernicus diz sobre o conjunto das previsões (limites, avisos)
r = requests.get(f"{url}/retrieve/v1/processes/seasonal-postprocessed-single-levels", headers=cab, timeout=60)
print(f"\nConjunto seasonal-postprocessed-single-levels: HTTP {r.status_code}")
info = r.json() if r.ok else {}
for chave in ("message", "messages", "jobControlOptions", "limits"):
    if chave in info:
        print(f"   {chave}: {str(info[chave])[:500]}")

# 3) cancelar os parados, se pedido
if "--cancelar" in sys.argv:
    for p in parados:
        r = requests.delete(f"{url}/retrieve/v1/jobs/{p['jobID']}", headers=cab, timeout=60)
        print(f"   cancelando {p['jobID']} ({p.get('processID')}): HTTP {r.status_code}")
