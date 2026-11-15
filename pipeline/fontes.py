"""
Downloads de todas as fontes de dados do painel. Cada função devolve arrays numpy já na grade da BAP.
Tudo o que é baixado fica em pipeline/cache/, então uma execução interrompida continua de onde parou.
"""
import calendar, datetime as dt, json, re, sys, tempfile, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urljoin
import numpy as np
import config as C
import processamento as pr
from comum import G05, G10, TempoEsgotado, checar_tempo, grava, log, soma_mes, tentar, ym


# =============================================================================
# utilidades de download
# =============================================================================
def baixar_arquivo(url, destino, timeout=600):
    """Baixa url para destino (se ainda não existir)."""
    import requests
    if destino.exists() and destino.stat().st_size > 0:
        return destino
    destino.parent.mkdir(parents=True, exist_ok=True)

    def _f():
        with requests.get(url, stream=True, timeout=timeout) as r:
            r.raise_for_status()
            tmp = destino.with_name(destino.name + ".parcial")
            with open(tmp, "wb") as f:
                for parte in r.iter_content(1 << 20):
                    f.write(parte)
            tmp.replace(destino)
    tentar(_f, vezes=3, espera=30)
    return destino


def existe(url):
    """True se o servidor tem o arquivo (pergunta só o cabeçalho, sem baixar)."""
    import requests
    try:
        r = tentar(lambda: requests.head(url, timeout=60, allow_redirects=True), vezes=3, espera=10)
        return r.status_code == 200
    except Exception:                                      # noqa
        return False


# =============================================================================
# Limites: sua BAP + estados (IBGE) + Pantanal (bioma IBGE)
# =============================================================================
def _uniao(gdf):
    g = gdf.geometry.buffer(0)
    return g.union_all() if hasattr(g, "union_all") else g.unary_union


def _arquivo_entrada(nome):
    for ext in (".geojson", ".gpkg", ".shp", ".json"):
        if (C.ENTRADA / (nome + ext)).exists():
            return C.ENTRADA / (nome + ext)
    return None


def regioes(construir=False):
    """As 4 regiões. -> (geojson, mascara 0,05°, mascara 0,1°, descrição para o site)
    Ficam prontas em pipeline/entrada/ (regioes.geojson e mascaras.npz). Elas são montadas uma vez,
    no seu computador (python atualizar_dados.py --regioes), porque os servidores do IBGE não
    respondem a acessos de fora do Brasil, como os do GitHub."""
    arq_geo, arq_m = C.ENTRADA / "regioes.geojson", C.ENTRADA / "mascaras.npz"
    if arq_geo.exists() and arq_m.exists() and not construir:
        z = np.load(arq_m)
        desc = str(z["desc"]).replace("Norte e sul separados pela divisa MT/MS",
                                      "Partes de Mato Grosso (MT) e Mato Grosso do Sul (MS) separadas pela divisa estadual")
        return json.load(open(arq_geo, encoding="utf-8")), z["m05"], z["m10"], desc
    if not construir:
        sys.exit("Faltam as regiões prontas (pipeline/entrada/regioes.geojson e mascaras.npz).\n"
                 "No seu computador, na pasta pipeline, rode:  python atualizar_dados.py --regioes\n"
                 "e depois envie os arquivos para o GitHub.")
    import geopandas as gpd, shapely
    from shapely.geometry import mapping
    from pyproj import Geod
    log("Montando as regiões (seu limite da BAP + IBGE)…")
    arq_bap = _arquivo_entrada("bap")
    if arq_bap is None:
        sys.exit("Não achei pipeline/entrada/bap.geojson (o limite da bacia).")
    bap = _uniao(gpd.read_file(arq_bap).to_crs(4326))

    estado = lambda cod: _uniao(gpd.read_file(baixar_arquivo(C.URL_ESTADO.format(cod=cod), C.CACHE / f"uf_{cod}.geojson")).to_crs(4326))
    mt, ms = estado(51), estado(50)

    arq_p = _arquivo_entrada("pantanal")
    if arq_p:
        pant, desc_p = _uniao(gpd.read_file(arq_p).to_crs(4326)), "Pantanal: limite fornecido pelo autor"
    else:
        bio = gpd.read_file(baixar_arquivo(C.URL_BIOMAS, C.CACHE / "biomas_ibge.zip")).to_crs(4326)
        col = next((c for c in bio.columns if c != bio.geometry.name
                    and bio[c].astype(str).str.lower().str.contains("pantanal").any()), None)
        if col is None:
            sys.exit(f"Não achei o bioma Pantanal no arquivo do IBGE (colunas: {list(bio.columns)}). "
                     "Coloque o limite em pipeline/entrada/pantanal.geojson.")
        pant = _uniao(bio[bio[col].astype(str).str.lower().str.contains("pantanal")])
        desc_p = "Pantanal: bioma do IBGE (2019, 1:250.000)"

    bap_mt, bap_ms = bap.intersection(mt), bap.intersection(ms)
    geoms = {1: bap_mt.difference(pant), 2: bap_mt.intersection(pant),
             3: bap_ms.difference(pant), 4: bap_ms.intersection(pant)}
    geod, total, feats = Geod(ellps="WGS84"), 0.0, []
    nome = {r["cod"]: r for r in C.REGIOES if r["cod"]}
    for c, g in geoms.items():
        area = abs(geod.geometry_area_perimeter(g)[0]) / 1e6
        total += area
        log(f"   {nome[c]['nome']}: {area:,.0f} km²")
        feats.append({"type": "Feature", "properties": {"cod": c, "id": nome[c]["id"], "nome": nome[c]["nome"],
                                                        "area_km2": round(area)},
                      "geometry": mapping(g.simplify(0.01))})
    log(f"   Total: {total:,.0f} km²")
    if not (C.AREA_BAP_ESPERADA_KM2[0] <= total <= C.AREA_BAP_ESPERADA_KM2[1]):
        sys.exit("A área somada das regiões ficou fora do esperado (~362 mil km²). Confira os limites.")

    def mascara(g):
        xx, yy = np.meshgrid(g["lons"], g["lats"])
        m = np.zeros(xx.shape, "uint8")
        for c, geom in geoms.items():
            m[shapely.contains_xy(geom, xx, yy)] = c
        return m
    m05, m10 = mascara(G05), mascara(G10)
    desc = ("Limite da BAP fornecido pelo autor, recortado ao território brasileiro. " + desc_p +
            ". Partes de Mato Grosso (MT) e Mato Grosso do Sul (MS) separadas pela divisa estadual (malha do IBGE).")
    geo = {"type": "FeatureCollection", "features": feats}
    grava(arq_geo, geo)
    np.savez_compressed(arq_m, m05=m05, m10=m10, desc=desc)
    return geo, m05, m10, desc


# =============================================================================
# Chuva: CHIRPS v3
# =============================================================================
_GDAL = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
             GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="10", GDAL_HTTP_TIMEOUT="180")


def _ler_recorte(caminho):
    """Lê do GeoTIFF global só o retângulo da BAP (0,05°). -> float32[ny, nx], NaN = sem dado."""
    import rasterio
    from rasterio.windows import Window
    g = G05
    with rasterio.Env(**_GDAL), rasterio.open(caminho) as ds:
        T = ds.transform
        if abs(T.a - g["d"]) > 1e-6:
            raise ValueError(f"resolução inesperada no CHIRPS: {T.a}")
        col0 = int(round((g["lon0"] - T.c) / T.a))
        lin0 = int(round((T.f - g["lat0"]) / -T.e))
        a = ds.read(1, window=Window(col0, lin0, g["nx"], g["ny"])).astype("float32")
        nd = ds.nodata
    if a.shape != (g["ny"], g["nx"]):
        raise ValueError(f"recorte com tamanho inesperado: {a.shape}")
    a[a <= -9000] = np.nan
    if nd is not None:
        a[a == nd] = np.nan
    return a


def ler_tif_remoto(url):
    """Lê o recorte direto do servidor (sem baixar o arquivo global inteiro). Se não der, baixa inteiro."""
    checar_tempo()
    try:
        return tentar(lambda: _ler_recorte("/vsicurl/" + url), vezes=3, espera=15)
    except TempoEsgotado:
        raise
    except Exception as e:                                         # noqa
        log(f"   leitura parcial falhou ({str(e)[:80]}); baixando o arquivo inteiro")
        with tempfile.TemporaryDirectory() as d:
            arq = baixar_arquivo(url, Path(d) / "x.tif")
            return _ler_recorte(str(arq))


def chirps_mensal():
    """Chuva mensal (mm) desde ANO_INICIAL, só meses finais. -> (P[t, ny, nx], anos, meses)"""
    pasta = C.CACHE / "chirps_mensal"
    pasta.mkdir(parents=True, exist_ok=True)
    hoje = dt.date.today()
    blocos, anos, meses = [], [], []
    a, m = C.ANO_INICIAL, 1
    while (a, m) < (hoje.year, hoje.month):
        arq = pasta / f"{ym(a, m)}.npy"
        if arq.exists():
            x = np.load(arq)
        else:
            url = C.CHIRPS_MENSAL.format(a=a, m=m)
            recente = (hoje.year * 12 + hoje.month) - (a * 12 + m) <= 3
            if recente and not existe(url):
                break                                              # mês final ainda não publicado
            log(f"   CHIRPS mensal {ym(a, m)}")
            x = ler_tif_remoto(url)
            np.save(arq, x)
        blocos.append(x); anos.append(a); meses.append(m)
        a, m = soma_mes(a, m, 1)
    if not blocos:
        sys.exit("Não consegui baixar o CHIRPS mensal. Confira CHIRPS_MENSAL em config.py.")
    return np.stack(blocos), np.array(anos), np.array(meses)


_RX_DATA = re.compile(r'href="([^"?#]*?(\d{4})\.(\d{2})\.(\d{2})\.tif)"', re.I)


def _listar_diarios(base, anos, modelo):
    """{data: url} dos arquivos diários. Lê a listagem do servidor; se não conseguir, usa o padrão de nome."""
    import requests
    achados = {}
    for a in anos:
        for sub in (f"{a}/", ""):
            try:
                r = requests.get(base + sub, timeout=60)
                if r.status_code != 200:
                    continue
                for href, aa, mm, dd in _RX_DATA.findall(r.text):
                    if int(aa) == a:
                        achados[np.datetime64(f"{aa}-{mm}-{dd}")] = urljoin(base + sub, href)
                if achados:
                    break
            except Exception:                                      # noqa
                continue
    if achados:
        return achados, True
    return {}, False


def chirps_diario(n_dias=120):
    """Chuva diária dos últimos n_dias: final quando houver, preliminar depois disso.
    -> (P[t, ny, nx], datas, primeira data preliminar ou None). Devolve (None, None, None) se falhar."""
    hoje = np.datetime64(dt.date.today())
    datas = np.arange(hoje - n_dias, hoje)
    anos = sorted({int(str(d)[:4]) for d in datas})
    final, ok_f = _listar_diarios(C.CHIRPS_DIARIO_FINAL, anos, "rnl")
    prelim, ok_p = _listar_diarios(C.CHIRPS_DIARIO_PRELIM, anos, "sat")
    if not ok_f:
        final = {d: f"{C.CHIRPS_DIARIO_FINAL}{str(d)[:4]}/chirps-v3.0.rnl.{str(d).replace('-', '.')}.tif" for d in datas}
    if not ok_p:
        prelim = {d: f"{C.CHIRPS_DIARIO_PRELIM}{str(d)[:4]}/chirps-v3.0.sat.{str(d).replace('-', '.')}.tif" for d in datas}
    pasta = C.CACHE / "chirps_diario"
    pasta.mkdir(parents=True, exist_ok=True)
    valores, usadas, ini_prelim = [], [], None
    for d in datas:
        tag = str(d).replace("-", "")
        arq_f, arq_p = pasta / f"{tag}_final.npy", pasta / f"{tag}_prelim.npy"
        x = None
        if arq_f.exists():
            x = np.load(arq_f)
        elif d in final and (ok_f or existe(final[d])):
            try:
                x = ler_tif_remoto(final[d]); np.save(arq_f, x)
                if arq_p.exists():
                    arq_p.unlink()
            except TempoEsgotado:
                raise
            except Exception:                                      # noqa
                x = None
        if x is None:
            if arq_p.exists():
                x = np.load(arq_p)
            elif d in prelim and (ok_p or existe(prelim[d])):
                try:
                    x = ler_tif_remoto(prelim[d]); np.save(arq_p, x)
                except TempoEsgotado:
                    raise
                except Exception:                                  # noqa
                    x = None
            if x is not None and ini_prelim is None:
                ini_prelim = d
        if x is None:
            if usadas:
                break                                              # acabou o que já foi publicado
            continue
        valores.append(x); usadas.append(d)
    if len(usadas) < 30:
        log("   CHIRPS diário: dados insuficientes; o bloco 'agora' fica sem chuva nesta execução")
        return None, None, None
    log(f"   CHIRPS diário: {usadas[0]} a {usadas[-1]}" + (f" (preliminar desde {ini_prelim})" if ini_prelim else ""))
    return np.stack(valores), np.array(usadas, dtype="datetime64[D]"), (str(ini_prelim) if ini_prelim else None)


# =============================================================================
# Temperatura: ERA5-Land horário, lido do "ARCO Data Lake" do ECMWF (Zarr, sem fila)
# =============================================================================
def _chave_cds():
    """Chave do Copernicus: variável CDSAPI_KEY (GitHub) ou arquivo ~/.cdsapirc (seu computador)."""
    import os
    k = os.environ.get("CDSAPI_KEY")
    arq = Path.home() / ".cdsapirc"
    if not k and arq.exists():
        for linha in arq.read_text().splitlines():
            if linha.strip().startswith("key:"):
                k = linha.split(":", 1)[1].strip()
    if not k:
        raise RuntimeError("chave do Copernicus não encontrada (CDSAPI_KEY ou ~/.cdsapirc)")
    return k


def abrir_era5land_arco():
    """Abre o Zarr do ERA5-Land (só lê o índice; os dados vêm quando pedidos)."""
    import xarray as xr
    return xr.open_zarr(C.ERA5L_ARCO, consolidated=True, chunks=None,
                        storage_options={"headers": {"Authorization": f"Bearer {_chave_cds()}"}})


def _recorte_arco(ds):
    """Índices do retângulo da BAP no Zarr e a ordem para cair na grade G10."""
    lat, lon = ds["latitude"].values, ds["longitude"].values
    iy = np.array([int(np.argmin(np.abs(lat - v))) for v in G10["lats"]])
    ix = np.array([int(np.argmin(np.abs(lon - v))) for v in G10["lons"]])
    if np.abs(lat[iy] - G10["lats"]).max() > 0.03 or np.abs(lon[ix] - G10["lons"]).max() > 0.03:
        raise ValueError("a grade do ERA5-Land no Zarr não bate com a grade do painel")
    y0, x0 = iy.min(), ix.min()
    return slice(y0, iy.max() + 1), slice(x0, ix.max() + 1), iy - y0, ix - x0


def _diarias(x, t):
    """Horárias (°C) -> Tmax e Tmin do dia local (UTC-4). Horas que sobram no fim voltam como 'resto'."""
    local = t + np.timedelta64(C.FUSO_HORAS, "h")
    hora = (local.astype("datetime64[h]") - local.astype("datetime64[D]")).astype(int)
    zeros = np.flatnonzero(hora == 0)
    if not len(zeros):
        return None, None, None, x, t
    o = zeros[0]
    n = (len(t) - o) // 24
    b = x[o:o + 24 * n].reshape(n, 24, *x.shape[1:])
    dias = local[o:o + 24 * n:24].astype("datetime64[D]")
    return b.max(axis=1), b.min(axis=1), dias, x[o + 24 * n:], t[o + 24 * n:]


def era5land_arco():
    """Tmax e Tmin diárias (°C, 0,1°, dia local) de ANO_INICIAL até o último dia completo no Zarr.
    Baixa em blocos do tamanho dos pedaços do Zarr (~3,9 anos); blocos fechados ficam no cache.
    -> (tmax[t, ny, nx], tmin[t, ny, nx], datas)"""
    ds = abrir_era5land_arco()
    v = ds["t2m"]
    t = ds["time"].values.astype("datetime64[h]")
    ch = v.encoding.get("chunks") or v.encoding.get("preferred_chunks", {}).get("time")
    ct = int(ch[0] if isinstance(ch, (tuple, list)) else (ch or 33792))   # horas por pedaço do Zarr (33792)
    sy, sx, ry, rx = _recorte_arco(ds)
    pasta = C.CACHE / "era5land"
    pasta.mkdir(parents=True, exist_ok=True)
    i_ini = int(np.searchsorted(t, np.datetime64(f"{C.ANO_INICIAL - 1}-12-31T00", "h")))
    k0, k1 = i_ini // ct, (len(t) - 1) // ct
    log(f"   ERA5-Land no Zarr: {str(t[0])[:10]} a {str(t[-1])[:13]}h UTC; {k1 - k0 + 1} blocos de {ct} h")
    mx, mn, ds_ = [], [], []
    resto_x, resto_t = None, None
    for k in range(k0, k1 + 1):
        i0, i1 = max(k * ct, i_ini), min((k + 1) * ct, len(t))
        fechado = (k + 1) * ct <= len(t)
        arq = pasta / f"bloco_{ct}_{k:03d}.npz"
        if fechado and arq.exists():
            z = np.load(arq)
        else:
            checar_tempo()
            log(f"   ERA5-Land: baixando {str(t[i0])[:10]} a {str(t[i1 - 1])[:10]}")
            x = tentar(lambda: v.isel(time=slice(i0, i1), latitude=sy, longitude=sx).values, vezes=3, espera=60)
            x = x[:, ry][:, :, rx].astype("float32") - 273.15
            tt = t[i0:i1]
            if resto_x is not None and len(resto_t):
                x, tt = np.concatenate([resto_x, x]), np.concatenate([resto_t, tt])
            if len(tt) > 1 and (np.diff(tt) != np.timedelta64(1, "h")).any():
                raise ValueError(f"ERA5-Land: horas faltando entre {tt[0]} e {tt[-1]}")
            a, b, d, rx_, rt_ = _diarias(x, tt)
            z = dict(tmax=a, tmin=b, d=d, resto_x=rx_, resto_t=rt_)
            if fechado:
                np.savez(arq, **z)
        resto_x, resto_t = z["resto_x"], z["resto_t"]
        if z["d"] is not None and len(z["d"]):
            mx.append(z["tmax"]); mn.append(z["tmin"]); ds_.append(z["d"])
    d = np.concatenate(ds_).astype("datetime64[D]")
    ok = d >= np.datetime64(f"{C.ANO_INICIAL}-01-01")
    return np.concatenate(mx)[ok], np.concatenate(mn)[ok], d[ok]


# --- dias mais recentes que o Zarr ainda não tem: pedido normal ao CDS, um por vez
def _era5_pedido(estat, ano, mes, dias, destino):
    import cdsapi, xarray as xr
    area = [round(float(v), 2) for v in (G10["lats"].max(), G10["lons"].min(), G10["lats"].min(), G10["lons"].max())]
    cdsapi.Client(quiet=True).retrieve("derived-era5-land-daily-statistics", {
        "variable": ["2m_temperature"], "year": str(ano), "month": [f"{mes:02d}"],
        "day": [f"{x:02d}" for x in dias], "daily_statistic": estat,
        "time_zone": C.FUSO_ERA5, "frequency": "1_hourly", "area": area}, str(destino))
    if zipfile.is_zipfile(destino):
        with zipfile.ZipFile(destino) as z:
            destino.write_bytes(z.read(next(n for n in z.namelist() if n.endswith(".nc"))))
    ds = xr.open_dataset(destino)
    da = ds[next(n for n in ds.data_vars if ds[n].ndim >= 3)]
    acha = lambda ops: next(x for x in da.dims if x.lower() in ops)
    la, lo = acha(("latitude", "lat")), acha(("longitude", "lon"))
    tm = next(x for x in da.dims if x not in (la, lo))
    da = da.transpose(tm, la, lo).sel({la: G10["lats"], lo: G10["lons"]}, method="nearest", tolerance=0.06)
    x, d = np.asarray(da.values, "float32") - 273.15, np.asarray(da[tm].values).astype("datetime64[D]")
    ds.close(); destino.unlink(missing_ok=True)
    o = np.argsort(d)
    return x[o], d[o]


def era5land_cauda(ultimo):
    """Dias depois de 'ultimo' (fim do Zarr) até hoje - ERA5_ATRASO_DIAS, pelo CDS (no máximo alguns meses).
    Se a fila do Copernicus não andar, devolve o que tiver; o resto entra numa próxima execução."""
    import time
    fim = np.datetime64(dt.date.today() - dt.timedelta(days=C.ERA5_ATRASO_DIAS))
    if (fim - ultimo).astype(int) <= C.ERA5_CAUDA_MIN_DIAS:
        return None                                    # o Zarr está quase em dia: não vale entrar na fila do CDS
    log(f"   o Zarr está {(fim - ultimo).astype(int)} dias atrás; pedindo os dias recentes ao CDS (pode esperar na fila)")
    pasta = C.CACHE / "era5land"
    datas = np.arange(ultimo + 1, fim + 1)
    meses = sorted({(int(str(x)[:4]), int(str(x)[5:7])) for x in datas})[-C.ERA5_CAUDA_MESES_MAX:]
    mx, mn, dd = [], [], []
    for ano, mes in meses:
        dias = [int(str(x)[8:]) for x in datas if (int(str(x)[:4]), int(str(x)[5:7])) == (ano, mes)]
        arq = pasta / f"cds_{ano}{mes:02d}_{dias[0]:02d}-{dias[-1]:02d}.npz"
        if not arq.exists():
            par = {}
            for estat in ("daily_maximum", "daily_minimum"):
                for vez in range(C.CDS_ESPERAS_FILA + 1):
                    checar_tempo()
                    try:
                        par[estat] = _era5_pedido(estat, ano, mes, dias, pasta / f"tmp_{estat}.nc")
                        break
                    except TempoEsgotado:
                        raise
                    except Exception as e:                         # noqa
                        if _fila_cheia(e) and vez < C.CDS_ESPERAS_FILA:
                            log(f"   Copernicus com fila cheia; espero {C.CDS_ESPERA_FILA_MIN} min")
                            time.sleep(C.CDS_ESPERA_FILA_MIN * 60)
                            continue
                        log(f"   ERA5-Land recente {ano}-{mes:02d} ficou para depois: {str(e)[:200]}")
                        break
            if len(par) < 2 or len(par["daily_maximum"][1]) != len(par["daily_minimum"][1]):
                break
            for velho in pasta.glob(f"cds_{ano}{mes:02d}_*.npz"):    # versão anterior, mais curta, deste mês
                velho.unlink()
            np.savez(arq, tmax=par["daily_maximum"][0], tmin=par["daily_minimum"][0], d=par["daily_maximum"][1])
        z = np.load(arq)
        mx.append(z["tmax"]); mn.append(z["tmin"]); dd.append(z["d"])
    for velho in pasta.glob("cds_*.npz"):                          # pedaços que o Zarr já cobre
        if np.datetime64(f"{velho.stem[4:8]}-{velho.stem[8:10]}-{velho.stem[-2:]}") <= ultimo:
            velho.unlink()
    if not dd:
        return None
    return np.concatenate(mx), np.concatenate(mn), np.concatenate(dd).astype("datetime64[D]")


def temperatura_diaria():
    """Junta o Zarr (histórico) com os dias recentes do CDS. -> (tmax, tmin, datas)"""
    tmax, tmin, d = era5land_arco()
    log(f"   ERA5-Land (Zarr): {d[0]} a {d[-1]}")
    try:
        cauda = era5land_cauda(d[-1])
    except TempoEsgotado:
        raise
    except Exception as e:                                         # noqa
        log(f"   dias recentes do ERA5-Land indisponíveis: {str(e)[:200]}")
        cauda = None
    if cauda:
        ok = cauda[2] > d[-1]
        tmax, tmin = np.concatenate([tmax, cauda[0][ok]]), np.concatenate([tmin, cauda[1][ok]])
        d = np.concatenate([d, cauda[2][ok]])
        log(f"   + dias recentes pelo CDS até {d[-1]}")
    return tmax, tmin, d


# =============================================================================
# Previsão sazonal — Copernicus C3S
# =============================================================================
def c3s_ler(arq, ano, mes):
    """Lê NetCDF de anomalias do C3S. -> dict(lats, lons, t[membro, lead, y, x] °C, p[...] mm/mês, leads)."""
    import xarray as xr
    ds = xr.open_dataset(arq)

    def pega(chaves):
        for v in ds.data_vars:
            if any(k in v.lower() for k in chaves):
                return ds[v]
        raise KeyError(f"variável {chaves} não encontrada em {list(ds.data_vars)}")

    def norm(da):
        acha = lambda ops: next((d for d in da.dims if d.lower() in ops), None)
        lat, lon = acha(("latitude", "lat")), acha(("longitude", "lon"))
        lead = acha(("forecastmonth", "leadtime_month", "forecast_month", "leadtime"))
        mem = acha(("number", "realization", "member"))
        for d in list(da.dims):
            if d not in (lat, lon, lead, mem):
                da = da.isel({d: 0})
        if mem is None:
            da = da.expand_dims("number"); mem = "number"
        da = da.assign_coords({lon: ((da[lon] + 180) % 360) - 180})
        da = da.sortby(lon).sortby(lat, ascending=False).sortby(lead).transpose(mem, lead, lat, lon)
        return da, lat, lon, lead

    t, lat, lon, lead = norm(pega(("t2a", "t2m", "2m_temperature")))
    p, *_ = norm(pega(("tpara", "tprate", "precip")))
    leads = [int(v) for v in np.asarray(t[lead].values).astype(int)]
    seg = np.array([calendar.monthrange(*soma_mes(ano, mes, L - 1))[1] * 86400.0 for L in leads])
    return {"lats": np.asarray(t[lat].values, float), "lons": np.asarray(t[lon].values, float), "leads": leads,
            "t": np.asarray(t.values, float),
            "p": np.asarray(p.values, float) * 1000.0 * seg[None, :, None, None]}      # m/s -> mm/mês


class FilaCheia(Exception):
    """O Copernicus continuou com a fila cheia depois de todas as esperas."""


def _fila_cheia(e):
    """True se o Copernicus recusou porque já há pedidos demais na fila desta conta."""
    resp = getattr(e, "response", None)
    t = f"{e} {getattr(resp, 'text', '') or ''}".lower()
    return "queued requests" in t or "request data sequentially" in t


def _c3s_juntar(arq):
    """O CDS pode devolver um .zip com um NetCDF por variável: junta tudo num só e confere se veio a chuva."""
    import xarray as xr
    if zipfile.is_zipfile(arq):
        with tempfile.TemporaryDirectory() as d, zipfile.ZipFile(arq) as z:
            z.extractall(d)
            partes = [xr.open_dataset(p).load() for p in sorted(Path(d).glob("*.nc"))]
        xr.merge(partes, compat="override").to_netcdf(arq)
    with xr.open_dataset(arq) as ds:
        nomes = [v.lower() for v in ds.data_vars]
    if not any(k in v for v in nomes for k in ("tpara", "tprate", "precip")):
        arq.unlink()
        raise ValueError(f"o arquivo veio sem a chuva (variáveis: {nomes})")


def c3s_baixar(centro, sistema, ano, mes):
    import cdsapi, time
    arq = C.CACHE / f"c3s2_{centro}_{sistema}_{ano}{mes:02d}.nc"     # "c3s2": versão com chuva e temperatura
    if arq.exists():
        return arq
    cliente = cdsapi.Client(quiet=True)
    for tipo in ("monthly_mean", "ensemble_mean"):                    # membros; se não houver, média do conjunto
        for vez in range(C.CDS_ESPERAS_FILA + 1):
            checar_tempo()
            try:
                cliente.retrieve("seasonal-postprocessed-single-levels", {
                    "originating_centre": centro, "system": sistema,
                    "variable": ["2m_temperature_anomaly", "total_precipitation_anomalous_rate_of_accumulation"],
                    "product_type": [tipo], "year": [str(ano)], "month": [f"{mes:02d}"],
                    "leadtime_month": ["1", "2", "3", "4", "5", "6"],
                    "data_format": "netcdf", "area": C.C3S_AREA}, str(arq))
                _c3s_juntar(arq)
                return arq
            except TempoEsgotado:
                raise
            except Exception as e:                                     # noqa
                if arq.exists():
                    arq.unlink()
                if _fila_cheia(e) and vez < C.CDS_ESPERAS_FILA:
                    log(f"   Copernicus com fila cheia nesta conta; espero {C.CDS_ESPERA_FILA_MIN} min e tento de novo")
                    time.sleep(C.CDS_ESPERA_FILA_MIN * 60)
                    continue
                log(f"   C3S {centro} {ano}-{mes:02d} ({tipo}): {str(e)[:300]}")
                if _fila_cheia(e):
                    raise FilaCheia() from e                           # desiste das previsões nesta execução
                break                                                  # outro erro: tenta o outro tipo
    return None


def c3s_todas():
    """Baixa todas as inicializações desde VERIF_INICIO. -> {modelo_id: {"nome":…, "rodadas": {(ano,mes): dados}}}"""
    hoje = dt.date.today()
    out, parar = {}, False
    for centro, sistema, nome in C.C3S_MODELOS:
        if parar:                                                      # usa só o que já está no cache
            rodadas = {}
            for arq in sorted(C.CACHE.glob(f"c3s2_{centro}_{sistema}_*.nc")):
                a_, m_ = int(arq.stem[-6:-2]), int(arq.stem[-2:])
                try:
                    rodadas[(a_, m_)] = c3s_ler(arq, a_, m_)
                except Exception:                                      # noqa
                    pass
            if rodadas:
                out[centro] = {"nome": nome, "sistema": sistema, "rodadas": rodadas}
            continue
        rodadas = {}
        a, m = C.VERIF_INICIO
        while (a, m) <= (hoje.year, hoje.month):
            if (a, m) == (hoje.year, hoje.month) and hoje.day < 6:
                break                                                  # C3S publica a partir do dia 6
            checar_tempo()
            try:
                arq = c3s_baixar(centro, sistema, a, m)
            except FilaCheia:
                log("   fila do Copernicus não andou; previsões que faltam ficam para a próxima execução")
                parar = True
                break
            if arq:
                try:
                    rodadas[(a, m)] = c3s_ler(arq, a, m)
                except Exception as e:                                 # noqa
                    log(f"   não consegui ler {arq.name}: {e}")
            a, m = soma_mes(a, m, 1)
        if rodadas:
            out[centro] = {"nome": nome, "sistema": sistema, "rodadas": rodadas}
            log(f"   {nome}: {len(rodadas)} inicializações")
        else:
            log(f"   {nome}: nada baixado (confira o número do sistema no CDS e o arquivo ~/.cdsapirc)")
    return out



# =============================================================================
# El Niño: RONI (índice oficial da NOAA desde fev/2026); ONI como reserva
# =============================================================================
def baixar_nino_semanal():
    """Última semana do índice Niño (NOAA/CPC, OISST, anomalia tradicional em relação a 1991-2020).
    -> {"semana": "AAAA-MM-DD" (centro da semana), "nino34": °C, "nino12": °C} ou None"""
    import re, requests
    meses = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
    try:
        r = tentar(lambda: requests.get(C.URL_NINO_SEMANAL, timeout=60), vezes=3, espera=15)
        r.raise_for_status()
        ult = None
        for linha in r.text.splitlines():
            m = re.match(r"\s*(\d{2})([A-Z]{3})(\d{4})(.*)", linha)
            if not m or m.group(2) not in meses:
                continue
            v = [float(x) for x in re.findall(r"-?\d+\.\d+", m.group(4))]   # Niño1+2, 3, 3.4, 4: TSM e anomalia
            if len(v) >= 8:
                ult = {"semana": f"{m.group(3)}-{meses[m.group(2)]:02d}-{m.group(1)}", "nino12": v[1], "nino34": v[5]}
        return ult
    except Exception as e:                                          # noqa
        log(f"   Niño semanal: {str(e)[:120]}")
        return None


def baixar_enso():
    """-> (série [{"t": mês central "AAAA-MM", "v": °C}], nome do índice)"""
    import requests
    ordem = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]
    for url, nome in ((C.URL_RONI, "RONI"), (C.URL_ONI, "ONI")):
        try:
            r = tentar(lambda: requests.get(url, timeout=60), vezes=3, espera=15)
            r.raise_for_status()
            out = []
            for linha in r.text.splitlines():
                p = linha.split()
                if len(p) >= 3 and p[0] in ordem and p[1].isdigit() and int(p[1]) >= C.ANO_INICIAL:
                    out.append({"t": ym(int(p[1]), ordem.index(p[0]) + 1), "v": float(p[-1])})
            if out:
                return out, nome
        except Exception as e:                                     # noqa
            log(f"   {nome}: {str(e)[:120]}")
    return [], None


# =============================================================================
# Rio Paraguai — ANA
# =============================================================================
_ANA_OK = None


def ana_acessivel():
    """Testa uma vez se o serviço da ANA responde (ele pode não aceitar acessos de fora do Brasil)."""
    global _ANA_OK
    if _ANA_OK is None:
        import requests
        try:
            requests.get("https://telemetriaws1.ana.gov.br/ServiceANA.asmx", timeout=(15, 30))
            _ANA_OK = True
        except Exception as e:                                     # noqa
            log(f"   ANA não respondeu ({type(e).__name__}); uso a última série guardada no cache")
            _ANA_OK = False
    return _ANA_OK


def ana_serie(codigo):
    """Nível diário (cm). Histórico (HidroSerieHistorica) + telemetria recente, somados à série guardada
    no cache das execuções anteriores. -> {data ISO: cm}"""
    import requests, xml.etree.ElementTree as ET
    base = "https://telemetriaws1.ana.gov.br/ServiceANA.asmx/"
    arq_cache = C.CACHE / f"ana_{codigo}.json"
    serie = json.load(open(arq_cache)) if arq_cache.exists() else {}
    hoje = dt.date.today()
    if not ana_acessivel():
        return _ana_csv(codigo, serie)
    try:
        r = requests.get(base + "HidroSerieHistorica", timeout=(15, 180), params={
            "codEstacao": codigo, "dataInicio": "01/01/1970", "dataFim": hoje.strftime("%d/%m/%Y"),
            "tipoDados": "1", "nivelConsistencia": ""})
        r.raise_for_status()
        nivel_cons = {}
        for no in ET.fromstring(r.content).iter():
            if not no.tag.endswith("SerieHistorica"):
                continue
            d = {c.tag.split("}")[-1]: (c.text or "").strip() for c in no}
            if d.get("MediaDiaria", "1") not in ("1", ""):
                continue
            ini = dt.datetime.strptime(d["DataHora"][:10], "%Y-%m-%d").date()
            cons = int(d.get("NivelConsistencia") or 1)
            for dia in range(1, calendar.monthrange(ini.year, ini.month)[1] + 1):
                v = d.get(f"Cota{dia:02d}")
                if v:
                    k = dt.date(ini.year, ini.month, dia).isoformat()
                    if cons >= nivel_cons.get(k, 0):
                        serie[k] = float(v.replace(",", ".")); nivel_cons[k] = cons
    except Exception as e:                                             # noqa
        log(f"   ANA histórico {codigo}: {str(e)[:120]}")
    try:
        ini = hoje - dt.timedelta(days=400)
        while ini < hoje:
            fim = min(ini + dt.timedelta(days=60), hoje)
            r = requests.get(base + "DadosHidrometeorologicos", timeout=(15, 180), params={
                "codEstacao": codigo, "dataInicio": ini.strftime("%d/%m/%Y"), "dataFim": fim.strftime("%d/%m/%Y")})
            r.raise_for_status()
            dia_vals = {}
            for no in ET.fromstring(r.content).iter():
                if not no.tag.split("}")[-1].startswith("DadosHidrometereologicos"):
                    continue
                d = {c.tag.split("}")[-1]: (c.text or "").strip() for c in no}
                if d.get("Nivel") and d.get("DataHora"):
                    dia_vals.setdefault(d["DataHora"][:10], []).append(float(d["Nivel"].replace(",", ".")))
            for k, vs in dia_vals.items():
                serie.setdefault(k, float(np.mean(vs)))
            ini = fim + dt.timedelta(days=1)
    except Exception as e:                                             # noqa
        log(f"   ANA telemetria {codigo}: {str(e)[:120]}")
    if serie:
        C.CACHE.mkdir(exist_ok=True)
        json.dump(serie, open(arq_cache, "w"))
    return _ana_csv(codigo, serie)


def _ana_csv(codigo, serie):
    """entrada/nivel_<codigo>.csv (colunas: data,nivel_cm): completa os dias que a ANA não entregou."""
    arq = C.ENTRADA / f"nivel_{codigo}.csv"
    if arq.exists():
        for linha in open(arq, encoding="utf-8").read().splitlines()[1:]:
            p = linha.replace(";", ",").split(",")
            if len(p) >= 2 and p[1].strip():
                serie.setdefault(p[0].strip()[:10], float(p[1]))     # completa só os dias que faltam
    return serie


def gravar_nivel_csv(codigo, serie):
    """Grava a série em entrada/nivel_<codigo>.csv (usado pelo GitHub quando a ANA não responde a ele)."""
    arq = C.ENTRADA / f"nivel_{codigo}.csv"
    with open(arq, "w", encoding="utf-8") as f:
        f.write("data,nivel_cm\n")
        for d in sorted(serie):
            f.write(f"{d},{serie[d]:g}\n")
    return arq


