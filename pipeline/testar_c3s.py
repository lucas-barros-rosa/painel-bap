"""
Diagnóstico da recusa do Copernicus nas previsões sazonais.
Manda UM pedido pequeno a cada conjunto de dados, um de cada vez, e mostra a resposta completa.
Uso (terminal do VS Code, ambiente "dados" ativo, pasta pipeline):
    python testar_c3s.py
"""
import cdsapi

cliente = cdsapi.Client(quiet=False, wait_until_complete=True)   # quiet=False = mostrar tudo o que o servidor diz

testes = {
    # o conjunto que usamos: anomalias já prontas
    "seasonal-postprocessed-single-levels": {
        "originating_centre": "ecmwf", "system": "51",
        "variable": ["2m_temperature_anomaly"], "product_type": ["ensemble_mean"],
        "year": ["2026"], "month": ["10"], "leadtime_month": ["1"],
        "data_format": "netcdf", "area": [-13, -61, -23, -52]},
    # alternativa no próprio C3S: médias mensais (a anomalia a gente calcularia com os hindcasts)
    "seasonal-monthly-single-levels": {
        "originating_centre": "ecmwf", "system": "51",
        "variable": ["2m_temperature"], "product_type": ["ensemble_mean"],
        "year": ["2026"], "month": ["10"], "leadtime_month": ["1"],
        "data_format": "netcdf", "area": [-13, -61, -23, -52]},
}

for nome, pedido in testes.items():
    print(f"\n================ {nome} ================")
    try:
        cliente.retrieve(nome, pedido, f"teste_{nome}.nc")
        print(">>> ACEITO E BAIXADO")
    except Exception as e:                                         # noqa
        resp = getattr(e, "response", None)
        print(">>> RECUSADO:", e)
        if resp is not None:
            print(">>> resposta do servidor:", (resp.text or "")[:2000])
