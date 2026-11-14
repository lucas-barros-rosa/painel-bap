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


def regioes():
    """Monta as 4 regiões. -> (geojson, mascara 0,05°, mascara 0,1°, descrição para o site)"""
    arq_geo, arq_m = C.CACHE / "regioes.geojson", C.CACHE / "mascaras.npz"
    if arq_geo.exists() and arq_m.exists():
        z = np.load(arq_m)
        return json.load(open(arq_geo, encoding="utf-8")), z["m05"], z["m10"], str(z["desc"])
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
        col = next((c for c in bio.columns if bio[c].dtype == object
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
            ". Norte e sul separados pela divisa MT/MS (malha do IBGE).")
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
# Temperatura: ERA5-Land (Copernicus CDS)
# =============================================================================
def _para_grade(da, g):
    """DataArray[tempo, lat, lon] -> numpy[tempo, ny, nx] na grade g (vizinho mais próximo)."""
    acha = lambda ops: next(d for d in da.dims if d.lower() in ops)
    lat, lon = acha(("latitude", "lat")), acha(("longitude", "lon"))
    tempo = next(d for d in da.dims if d not in (lat, lon))
    da = da.transpose(tempo, lat, lon).sortby(lat).sortby(lon)
    da = da.sel({lat: g["lats"], lon: g["lons"]}, method="nearest", tolerance=g["d"] * 0.6)
    return np.asarray(da.values, dtype="float32"), np.asarray(da[tempo].values).astype("datetime64[D]")


def _era5_pedido(estat, ano, meses, dias, destino):
    """Faz um pedido ao CDS e devolve (valores °C, datas)."""
    import cdsapi, xarray as xr
    area = [round(float(v), 2) for v in (G10["lats"].max(), G10["lons"].min(), G10["lats"].min(), G10["lons"].max())]
    cdsapi.Client(quiet=True).retrieve("derived-era5-land-daily-statistics", {
        "variable": ["2m_temperature"], "year": str(ano), "month": [f"{m:02d}" for m in meses],
        "day": [f"{d:02d}" for d in dias], "daily_statistic": estat,
        "time_zone": C.FUSO_ERA5, "frequency": "1_hourly", "area": area}, str(destino))
    if zipfile.is_zipfile(destino):
        with zipfile.ZipFile(destino) as z:
            dados = z.read(next(n for n in z.namelist() if n.endswith(".nc")))
        destino.write_bytes(dados)
    ds = xr.open_dataset(destino)
    v = next(n for n in ds.data_vars if ds[n].ndim >= 3)
    x, d = _para_grade(ds[v], G10)
    ds.close()
    o = np.argsort(d)
    return x[o] - 273.15, d[o]


def era5_diario(estat):
    """Tmax ('daily_maximum') ou Tmin ('daily_minimum') diária, °C, 0,1°, de ANO_INICIAL até ~hoje - 7 dias.
    -> (x[t, ny, nx], datas)"""
    hoje = dt.date.today()
    limite = hoje - dt.timedelta(days=C.ERA5_ATRASO_DIAS)
    pasta = C.CACHE / "era5"
    pasta.mkdir(parents=True, exist_ok=True)
    # blocos: anos passados inteiros; meses completos do ano corrente; o pedaço do mês em curso
    blocos = []
    for ano in range(C.ANO_INICIAL, limite.year):
        blocos.append((f"{estat}_{ano}", ano, list(range(1, 13)), list(range(1, 32))))
    for m in range(1, limite.month):
        blocos.append((f"{estat}_{limite.year}_{m:02d}", limite.year, [m], list(range(1, 32))))
    blocos.append((f"{estat}_{limite.year}_{limite.month:02d}_ate{limite.day:02d}", limite.year, [limite.month],
                   list(range(1, limite.day + 1))))
    for velho in pasta.glob(f"{estat}_*_ate*.npz"):                 # pedaços parciais antigos
        if velho.stem != blocos[-1][0]:
            velho.unlink()

    def esperado(ano, meses, dias):
        return [np.datetime64(dt.date(ano, m, d)) for m in meses for d in dias if d <= calendar.monthrange(ano, m)[1]]

    def fazer(bloco):
        nome, ano, meses, dias = bloco
        checar_tempo()
        tmp = pasta / f"{nome}.nc"
        try:
            x, d = tentar(lambda: _era5_pedido(estat, ano, meses, dias, tmp), vezes=2, espera=60)
        except TempoEsgotado:
            raise
        except Exception as e:                                     # noqa — pedido grande recusado: mês a mês
            if len(meses) == 1:
                raise
            log(f"   {nome}: pedido anual falhou ({str(e)[:80]}); tentando mês a mês")
            partes = [tentar(lambda m=m: _era5_pedido(estat, ano, [m], dias, tmp), vezes=3, espera=60) for m in meses]
            x = np.concatenate([p[0] for p in partes]); d = np.concatenate([p[1] for p in partes])
        tmp.unlink(missing_ok=True)
        esp = np.array(esperado(ano, meses, dias), dtype="datetime64[D]")
        if len(d) != len(esp) or (d != esp).any():
            raise ValueError(f"ERA5-Land {nome}: esperava {len(esp)} dias, vieram {len(d)}")
        np.savez(pasta / f"{nome}.npz", x=x.astype("float32"), d=d)
        return nome

    faltam = [b for b in blocos if not (pasta / f"{b[0]}.npz").exists()]
    if faltam:
        log(f"   ERA5-Land {estat}: {len(faltam)} pedidos ao Copernicus (fila; a primeira carga demora)")
        with ThreadPoolExecutor(max_workers=C.ERA5_PEDIDOS_SIMULTANEOS) as ex:
            futuros = {ex.submit(fazer, b): b for b in faltam}
            for f in as_completed(futuros):
                log(f"   ERA5-Land pronto: {f.result()}")
    xs, ds = [], []
    for nome, *_ in blocos:
        z = np.load(pasta / f"{nome}.npz")
        xs.append(z["x"]); ds.append(z["d"])
    return np.concatenate(xs), np.concatenate(ds).astype("datetime64[D]")


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


def c3s_baixar(centro, sistema, ano, mes):
    import cdsapi
    arq = C.CACHE / f"c3s_{centro}_{sistema}_{ano}{mes:02d}.nc"
    if arq.exists():
        return arq
    cliente = cdsapi.Client(quiet=True)
    for tipo in ("monthly_mean", "ensemble_mean"):                    # membros; se não houver, média do conjunto
        try:
            cliente.retrieve("seasonal-postprocessed-single-levels", {
                "originating_centre": centro, "system": sistema,
                "variable": ["2m_temperature_anomaly", "total_precipitation_anomaly"],
                "product_type": [tipo], "year": [str(ano)], "month": [f"{mes:02d}"],
                "leadtime_month": ["1", "2", "3", "4", "5", "6"],
                "data_format": "netcdf", "area": C.C3S_AREA}, str(arq))
            return arq
        except Exception as e:                                         # noqa
            log(f"   C3S {centro} {ano}-{mes:02d} ({tipo}): {str(e)[:150]}")
            if arq.exists():
                arq.unlink()
    return None


def c3s_todas():
    """Baixa todas as inicializações desde VERIF_INICIO. -> {modelo_id: {"nome":…, "rodadas": {(ano,mes): dados}}}"""
    hoje = dt.date.today()
    out = {}
    for centro, sistema, nome in C.C3S_MODELOS:
        rodadas = {}
        a, m = C.VERIF_INICIO
        while (a, m) <= (hoje.year, hoje.month):
            if (a, m) == (hoje.year, hoje.month) and hoje.day < 6:
                break                                                  # C3S publica a partir do dia 6
            checar_tempo()
            arq = c3s_baixar(centro, sistema, a, m)
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
def ana_serie(codigo):
    """Nível diário (cm). Histórico (HidroSerieHistorica) + telemetria recente. -> {data ISO: cm}"""
    import requests, xml.etree.ElementTree as ET
    base = "https://telemetriaws1.ana.gov.br/ServiceANA.asmx/"
    serie = {}
    hoje = dt.date.today()
    try:
        r = requests.get(base + "HidroSerieHistorica", timeout=180, params={
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
            r = requests.get(base + "DadosHidrometeorologicos", timeout=180, params={
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
    # arquivo manual opcional: entrada/nivel_<codigo>.csv  (colunas: data,nivel_cm) — tem prioridade
    arq = C.ENTRADA / f"nivel_{codigo}.csv"
    if arq.exists():
        for linha in open(arq, encoding="utf-8").read().splitlines()[1:]:
            p = linha.replace(";", ",").split(",")
            if len(p) >= 2 and p[1].strip():
                serie[p[0].strip()[:10]] = float(p[1])
    return serie


