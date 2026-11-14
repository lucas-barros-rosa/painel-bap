"""
Teste rápido do ERA5-Land pelo "ARCO Data Lake" do ECMWF, antes de mandar tudo para o GitHub.
Uso (terminal do VS Code, ambiente "dados" ativo, dentro da pasta pipeline):
    python testar_era5land.py
Mostra até quando há dados, lê 1 mês da BAP e estima o tempo da carga completa (1990 até hoje).
"""
import time
import numpy as np
import config as C
import fontes

t0 = time.time()
ds = fontes.abrir_era5land_arco()                    # usa a chave do arquivo C:\Users\lucas\.cdsapirc
v = ds["t2m"]
t = ds["time"].values.astype("datetime64[h]")
print(f"Zarr aberto em {time.time() - t0:.0f} s. Dados de {t[0]} até {t[-1]} (UTC).")
print("Pedaços internos (horas, lat, lon):", v.encoding.get("chunks") or v.encoding.get("preferred_chunks"))

sy, sx, ry, rx = fontes._recorte_arco(ds)
i1 = len(t); i0 = i1 - 31 * 24                       # último mês disponível
t0 = time.time()
x = v.isel(time=slice(i0, i1), latitude=sy, longitude=sx).values[:, ry][:, :, rx] - 273.15
dur = time.time() - t0
tmax, tmin, dias, *_ = fontes._diarias(x.astype("float32"), t[i0:i1])
print(f"Último mês lido em {dur:.0f} s: Tmax média {np.nanmean(tmax):.1f} °C, Tmin média {np.nanmean(tmin):.1f} °C "
      f"({dias[0]} a {dias[-1]})")
print("Sem dado (NaN) na grade:", int(np.isnan(tmax[0]).sum()), "de", tmax[0].size, "pontos")

# cada leitura baixa pedaços inteiros (~33792 h); um mês já baixa um pedaço inteiro de tempo
blocos = (i1 - int(np.searchsorted(t, np.datetime64(f"{C.ANO_INICIAL}-01-01T00", "h")))) / 33792
print(f"Carga completa: ~{blocos:.0f} blocos como este; estimativa de {blocos * dur / 60:.0f} min "
      "(no GitHub costuma ser mais rápido).")
