"""
Teste rápido das duas fontes novas de fogo, antes de mandar para o GitHub.
Uso (terminal do VS Code, ambiente "dados" ativo, pasta pipeline):
    python testar_fogo.py
Precisa de:
  - a chave da NASA FIRMS salva em C:\\Users\\lucas\\.firms_key (só a chave, numa linha)
  - a licença do conjunto de FWI aceita no site do EWDS (ewds.climate.copernicus.eu)
"""
import fogo, config as C
C.CACHE.mkdir(parents=True, exist_ok=True)

print("1) NASA FIRMS (focos de calor)")
for n in (C.FIRMS_DIAS, 1):                                          # tenta 5 dias; se falhar, 1 dia
    try:
        b = fogo._firms_bloco(fogo._firms_chave(), "MODIS_SP", "2024-09-01", n)
        print(f"   OK com {n} dia(s): {len(b)} focos Aqua na área da BAP a partir de 01/09/2024; exemplo: {b[:2]}")
        break
    except Exception as e:                                           # noqa
        print(f"   ERRO com {n} dia(s):", str(e)[:400])

print("2) Copernicus EWDS (FWI) — cada tentativa pode esperar alguns minutos na fila")
tentativas = [
    ("consolidado, set/2019", "consolidated_dataset", 2019, {}),
    ("intermediário, out/2026", "intermediate_dataset", 2026, {}),
]
for nome, tipo, ano, troca in tentativas:
    mes = 10 if ano == 2026 else 9
    try:
        x, d, la, lo = fogo._fwi_pedido(tipo, ano, [mes], C.CACHE / "teste_fwi.grib", troca=troca)
        print(f"   OK ({nome}): {len(d)} dias ({d[0]} a {d[-1]}), grade {x.shape[1]}x{x.shape[2]}, FWI médio {float(x.mean()):.1f}")
    except Exception as e:                                           # noqa
        print(f"   ERRO ({nome}):", ' | '.join(str(e).splitlines()[:3])[:400])
