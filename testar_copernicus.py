"""
Teste rápido do pedido de temperatura ao Copernicus (ERA5-Land diário).
Faz 3 versões do mesmo pedido pequeno (janeiro de 1990) e mostra qual funciona e,
quando falha, a explicação completa do Copernicus.

Uso (na pasta painel-bap, com o ambiente "dados" ativo):
    python testar_copernicus.py
"""
import traceback
import cdsapi

base = {
    "variable": ["2m_temperature"],
    "year": "1990",
    "month": ["01"],
    "day": [f"{d:02d}" for d in range(1, 32)],
    "daily_statistic": "daily_maximum",
    "frequency": "1_hourly",
}
versoes = {
    "A (igual ao painel: fuso -04:00 + recorte da bacia)": {**base, "time_zone": "utc-04:00", "area": [-13.6, -60.0, -22.6, -52.8]},
    "B (fuso UTC + recorte da bacia)": {**base, "time_zone": "utc+00:00", "area": [-13.6, -60.0, -22.6, -52.8]},
    "C (fuso -04:00, sem recorte, mundo inteiro)": {**base, "time_zone": "utc-04:00"},
}

cliente = cdsapi.Client()          # sem "quiet": mostra as mensagens do Copernicus
for nome, pedido in versoes.items():
    print("\n" + "=" * 70 + f"\nVersão {nome}\n" + "=" * 70, flush=True)
    try:
        cliente.retrieve("derived-era5-land-daily-statistics", pedido, "teste_copernicus.nc")
        print(f">>> Versão {nome}: FUNCIONOU", flush=True)
    except Exception as e:
        print(f">>> Versão {nome}: FALHOU", flush=True)
        resp = getattr(e, "response", None)
        if resp is not None:
            print("Resposta do Copernicus:", resp.text[:2000])
        traceback.print_exc()
