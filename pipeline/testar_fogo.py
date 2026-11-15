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
try:
    chave = fogo._firms_chave()
    disp = fogo._firms_disponivel(chave)
    print("   disponível:", {k: (str(a), str(b)) for k, (a, b) in disp.items() if k.startswith("MODIS")})
    b = fogo._firms_bloco(chave, "MODIS_SP", "2024-09-01", 10)       # 1 a 10 de setembro de 2024 (seca forte)
    print(f"   focos Aqua (confiança >= {C.FIRMS_CONF_MIN}) na área da BAP, 1-10/09/2024: {len(b)}; exemplo: {b[:2]}")
except Exception as e:                                               # noqa
    print("   ERRO:", e)

print("2) Copernicus EWDS (FWI) — um mês, pode esperar alguns minutos na fila")
try:
    x, d, la, lo = fogo._fwi_pedido("consolidated_dataset", 2024, [9], C.CACHE / "teste_fwi.nc")
    print(f"   {len(d)} dias, grade {x.shape[1]}x{x.shape[2]}, FWI médio em set/2024: {float(x.mean()):.1f}")
except Exception as e:                                               # noqa
    print("   ERRO:", str(e)[:800])
