"""
Fogo: focos de calor (NASA FIRMS, MODIS/Aqua) e índice de perigo de fogo FWI (Copernicus CEMS, a partir do ERA5).
"""
import csv, datetime as dt, io, os, time, zipfile
from pathlib import Path
import numpy as np
import config as C
import processamento as pr
from comum import G05, G10, TempoEsgotado, arred, checar_tempo, log, tentar


# =============================================================================
# Focos de calor — NASA FIRMS (MODIS, satélite Aqua: passagem no início da tarde, como o "satélite de referência" do INPE)
# =============================================================================
def _firms_chave():
    k = os.environ.get("FIRMS_MAP_KEY")
    arq = Path.home() / ".firms_key"                       # no seu computador: um arquivo com a chave
    if not k and arq.exists():
        k = arq.read_text().strip()
    if not k:
        raise RuntimeError("chave do FIRMS não encontrada (segredo FIRMS_MAP_KEY ou arquivo ~/.firms_key)")
    return k


def _firms_disponivel(chave):
    """{fonte: (data mínima, data máxima)} segundo o FIRMS."""
    import requests
    r = tentar(lambda: requests.get(f"{C.FIRMS_API}data_availability/csv/{chave}/ALL", timeout=60), vezes=3, espera=20)
    r.raise_for_status()
    out = {}
    for l in csv.DictReader(io.StringIO(r.text)):
        try:
            out[l["data_id"]] = (np.datetime64(l["min_date"]), np.datetime64(l["max_date"]))
        except Exception:                                          # noqa
            pass
    return out


def _firms_bloco(chave, fonte, d0, n):
    """Focos de n dias (máx. 10) a partir de d0 no retângulo da BAP. -> lista [data, lat, lon]"""
    import requests
    w, s, e, n_ = C.LON0, C.LAT0 - C.ALT, C.LON0 + C.LARG, C.LAT0
    url = f"{C.FIRMS_API}area/csv/{chave}/{fonte}/{w:.2f},{s:.2f},{e:.2f},{n_:.2f}/{n}/{d0}"
    r = tentar(lambda: requests.get(url, timeout=120), vezes=3, espera=30)
    r.raise_for_status()
    txt = r.text.strip()
    if not txt.lower().startswith("latitude"):
        if not txt:
            return []
        raise RuntimeError(f"FIRMS respondeu: {txt[:200]}")
    out = []
    for l in csv.DictReader(io.StringIO(txt)):
        sat = (l.get("satellite") or "").strip().lower()
        if sat not in ("aqua", "a"):
            continue
        try:
            conf = float(l.get("confidence") or 0)
        except ValueError:                                         # VIIRS usa letras; aqui é sempre MODIS
            conf = 100
        if conf < C.FIRMS_CONF_MIN:
            continue
        out.append([l["acq_date"], round(float(l["latitude"]), 4), round(float(l["longitude"]), 4)])
    return out


def focos():
    """Todos os focos MODIS/Aqua (confiança ≥ 30) na BAP desde FIRMS_INICIO. -> (datas, lat, lon, última data)"""
    import json
    chave = _firms_chave()
    pasta = C.CACHE / "firms"
    pasta.mkdir(parents=True, exist_ok=True)
    disp = _firms_disponivel(chave)
    fim_sp = disp.get("MODIS_SP", (None, np.datetime64("2000-01-01")))[1]
    hoje = np.datetime64(dt.date.today())
    regs = []
    d = np.datetime64(C.FIRMS_INICIO)
    n_novos = 0
    while d <= fim_sp:                                             # arquivo consolidado: blocos de 10 dias, guardados
        n = int(min(10, (fim_sp - d).astype(int) + 1))
        arq = pasta / f"sp_{d}_{n}.json"
        if arq.exists():
            regs += json.load(open(arq))
        else:
            checar_tempo()
            b = _firms_bloco(chave, "MODIS_SP", str(d), n)
            json.dump(b, open(arq, "w")); regs += b; n_novos += 1
            time.sleep(0.4)
        d += np.timedelta64(n, "D")
    if n_novos:
        log(f"   FIRMS: {n_novos} blocos novos do arquivo consolidado (até {fim_sp})")
    ini_nrt = max(fim_sp + 1, disp.get("MODIS_NRT", (fim_sp + 1, hoje))[0])
    d = ini_nrt
    while d <= hoje:                                               # tempo quase real: sempre baixado de novo
        checar_tempo()
        n = int(min(10, (hoje - d).astype(int) + 1))
        regs += _firms_bloco(chave, "MODIS_NRT", str(d), n)
        d += np.timedelta64(n, "D")
        time.sleep(0.4)
    datas = np.array([r[0] for r in regs], dtype="datetime64[D]")
    lat = np.array([r[1] for r in regs]); lon = np.array([r[2] for r in regs])
    ult = min(hoje - 1, disp.get("MODIS_NRT", (None, hoje - 1))[1])
    log(f"   FIRMS: {len(regs)} focos de {C.FIRMS_INICIO} a {ult}")
    return datas, lat, lon, ult


def _regiao_do_ponto(lat, lon, m05):
    j = np.floor((C.LAT0 - lat) / 0.05).astype(int)
    i = np.floor((lon - C.LON0) / 0.05).astype(int)
    ok = (j >= 0) & (j < G05["ny"]) & (i >= 0) & (i < G05["nx"])
    cod = np.zeros(len(lat), int)
    cod[ok] = m05[j[ok], i[ok]]
    return cod


def focos_json(datas, lat, lon, ult, m05, regioes, rot_meses):
    """Produtos do site a partir dos focos. -> (bloco 'focos' do fogo.json, séries mensais por região)"""
    cod = _regiao_do_ponto(lat, lon, m05)
    dentro = cod > 0
    datas, lat, lon, cod = datas[dentro], lat[dentro], lon[dentro], cod[dentro]
    d0 = np.datetime64(C.FIRMS_INICIO)
    dias = np.arange(d0, ult + 1)
    doy = pr.dia_do_ano_365(dias)
    anos_d = dias.astype("datetime64[Y]").astype(int) + 1970
    a0, a1 = C.FOCOS_REF
    out, mensal = {"regioes": {}, "ref": f"{a0}–{a1}", "ultimo": str(ult), "inicio": C.FIRMS_INICIO}, {}
    for r in regioes:
        sel = np.ones(len(cod), bool) if r["cod"] is None else cod == r["cod"]
        diario = np.bincount((datas[sel] - d0).astype(int), minlength=len(dias))[:len(dias)].astype(float)
        # acumulado no ano, por dia do ano (365)
        anos = {}
        for a in range(int(anos_d[0]), int(anos_d[-1]) + 1):
            s = anos_d == a
            c = np.full(365, np.nan)
            c[doy[s] - 1] = np.cumsum(diario[s])
            anos[a] = c
        ref = np.array([anos[a] for a in range(a0, a1 + 1) if a in anos])
        clim = {k: arred(np.nanpercentile(ref, q, axis=0), 0) for k, q in (("p10", 10), ("p50", 50), ("p90", 90))}
        # últimos 30 dias e ano até hoje, comparados à média do mesmo período em a0–a1
        u30 = float(diario[-30:].sum())
        d_ult = int(doy[-1])
        janela = [(d_ult - 29 + k - 1) % 365 + 1 for k in range(30)]
        n30 = np.mean([np.nansum([diario[(anos_d == a) & (doy == q)].sum() for q in janela]) for a in range(a0, a1 + 1)])
        ano_atual = int(anos_d[-1])
        ytd = float(np.nan_to_num(anos[ano_atual][d_ult - 1]))
        n_ytd = float(np.nanmean(ref[:, d_ult - 1]))
        ordem = sorted(((float(np.nan_to_num(anos[a][d_ult - 1])), a) for a in anos), reverse=True)
        out["regioes"][r["id"]] = {
            "anos": {str(a): arred(c, 0) for a, c in anos.items()}, "clim": clim,
            "ult30": round(u30), "normal30": round(float(n30), 1), "ano": round(ytd), "normal_ano": round(n_ytd, 1),
            "posicao_ano": 1 + [a for _, a in ordem].index(ano_atual), "n_anos": len(ordem)}
        # mensal (para as séries e para os El Niños anteriores)
        m = {}
        for dd, v in zip(dias.astype("datetime64[M]"), diario):
            m[str(dd)] = m.get(str(dd), 0) + v
        ultimo_mes_completo = str((ult + 1).astype("datetime64[M]") - 1) if (ult + 1).astype("datetime64[M]") != ult.astype("datetime64[M]") else str(ult.astype("datetime64[M]") - 1)
        mensal[r["id"]] = [m.get(k) if k <= ultimo_mes_completo else None for k in rot_meses]
    # pontos dos últimos 30 dias (mapa)
    rec = datas >= ult - 29
    out["pontos"] = [[float(a), float(b), int((ult - d).astype(int))] for a, b, d in zip(lat[rec], lon[rec], datas[rec])]
    return out, mensal


# =============================================================================
# FWI — Copernicus Emergency Management Service (EWDS), reanálise ERA5, sistema 4.1
# =============================================================================
def _fwi_area():
    return [round(C.LAT0 + 0.25, 2), round(C.LON0 - 0.25, 2), round(C.LAT0 - C.ALT - 0.25, 2), round(C.LON0 + C.LARG + 0.25, 2)]


def _fwi_pedido(tipo, ano, meses, destino):
    import cdsapi, xarray as xr
    from fontes import _chave_cds
    cliente = cdsapi.Client(url=C.EWDS_URL, key=_chave_cds(), quiet=True)
    cliente.retrieve("cems-fire-historical-v1", {
        "product_type": "reanalysis", "variable": ["fire_weather_index"], "dataset_type": tipo,
        "system_version": ["4_1"], "year": [str(ano)], "month": [f"{m:02d}" for m in meses],
        "day": [f"{d:02d}" for d in range(1, 32)], "data_format": "netcdf",
        "area": _fwi_area()}, str(destino))
    if zipfile.is_zipfile(destino):
        with zipfile.ZipFile(destino) as z:
            destino.write_bytes(z.read(next(n for n in z.namelist() if n.endswith(".nc"))))
    ds = xr.open_dataset(destino)
    da = ds[next(n for n in ds.data_vars if ds[n].ndim >= 3)]
    la = next(x for x in da.dims if x.lower() in ("latitude", "lat"))
    lo = next(x for x in da.dims if x.lower() in ("longitude", "lon"))
    tm = next(x for x in da.dims if x not in (la, lo))
    da = da.transpose(tm, la, lo)
    lons = np.asarray(da[lo].values, float); lons = np.where(lons > 180, lons - 360, lons)
    x = np.asarray(da.values, "float32"); d = np.asarray(da[tm].values).astype("datetime64[D]")
    lats = np.asarray(da[la].values, float)
    ds.close(); destino.unlink(missing_ok=True)
    o = np.argsort(d)
    return x[o], d[o], lats, lons


def fwi_diario():
    """FWI diário (grade de 0,25°) de FWI_ANO_INICIAL até ~3 dias atrás. Um pedido por ano (consolidado) e,
    no período ainda não consolidado, um por mês (intermediário). -> (x[t, y, x], datas, lats, lons)"""
    from fontes import _fila_cheia
    pasta = C.CACHE / "fwi"
    pasta.mkdir(parents=True, exist_ok=True)
    hoje = dt.date.today()
    partes = []
    t0 = time.time()

    def pedir(nome, tipo, ano, meses):
        arq = pasta / f"{nome}.npz"
        if arq.exists():
            z = np.load(arq)
            return z["x"], z["d"], z["la"], z["lo"]
        if (time.time() - t0) / 60 > C.FWI_MAX_MIN:
            raise RuntimeError(f"carga do FWI pausada após {C.FWI_MAX_MIN} min; continua na próxima execução")
        for vez in range(C.CDS_ESPERAS_FILA + 1):
            checar_tempo()
            try:
                x, d, la, lo = _fwi_pedido(tipo, ano, meses, pasta / "tmp.nc")
                return x, d, la, lo
            except TempoEsgotado:
                raise
            except Exception as e:                                 # noqa
                if _fila_cheia(e) and vez < C.CDS_ESPERAS_FILA:
                    log(f"   EWDS com fila cheia; espero {C.CDS_ESPERA_FILA_MIN} min")
                    time.sleep(C.CDS_ESPERA_FILA_MIN * 60)
                    continue
                if _fila_cheia(e):
                    raise RuntimeError("fila do Copernicus (EWDS) não andou") from e
                return str(e)

    for ano in range(C.FWI_ANO_INICIAL, hoje.year + 1):
        if ano < hoje.year:
            r = pedir(f"ano_{ano}", "consolidated_dataset", ano, range(1, 13))
            if not isinstance(r, str):
                if not (pasta / f"ano_{ano}.npz").exists():
                    np.savez(pasta / f"ano_{ano}.npz", x=r[0], d=r[1], la=r[2], lo=r[3])
                partes.append(r); continue
        # ano corrente (ou ano ainda não consolidado): mês a mês
        for mes in range(1, 13):
            if dt.date(ano, mes, 1) > hoje - dt.timedelta(days=C.FWI_ATRASO_DIAS):
                break
            ultimo_dia = (dt.date(ano + mes // 12, mes % 12 + 1, 1) - dt.timedelta(days=1))
            completo = ultimo_dia <= hoje - dt.timedelta(days=C.FWI_ATRASO_DIAS + 30)
            nome = f"mes_{ano}{mes:02d}"
            if not completo:
                (pasta / f"{nome}.npz").unlink(missing_ok=True)     # mês recente: sempre pede de novo
            r = None
            for tipo in ("consolidated_dataset", "intermediate_dataset"):
                r = pedir(nome, tipo, ano, [mes])
                if not isinstance(r, str) and len(r[1]):
                    break
            if isinstance(r, str) or r is None or not len(r[1]):
                log(f"   FWI {ano}-{mes:02d} indisponível: {str(r)[:200]}")
                continue
            if completo and not (pasta / f"{nome}.npz").exists():
                np.savez(pasta / f"{nome}.npz", x=r[0], d=r[1], la=r[2], lo=r[3])
            partes.append(r)
    if not partes:
        raise RuntimeError("nenhum dado de FWI")
    la, lo = partes[0][2], partes[0][3]
    x = np.concatenate([p[0] for p in partes]); d = np.concatenate([p[1] for p in partes])
    o = np.argsort(d); x, d = x[o], d[o]
    _, u = np.unique(d, return_index=True)
    return x[u], d[u], la, lo


def fwi_json(x, d, lats, lons, m10, regioes, rot_meses, w10):
    """Série dos últimos 180 dias com a climatologia do dia do ano, mapa do último dia e médias mensais."""
    iy = np.abs(lats[:, None] - G10["lats"][None, :]).argmin(axis=0)
    ix = np.abs(lons[:, None] - G10["lons"][None, :]).argmin(axis=0)
    doy = pr.dia_do_ano_365(d)
    anos = d.astype("datetime64[Y]").astype(int) + 1970
    ref = (anos >= pr.REF_INI) & (anos <= pr.REF_FIM)
    out = {"regioes": {}, "ultimo": str(d[-1]), "ref": f"{pr.REF_INI}–{pr.REF_FIM}", "ref_anos": int(len(np.unique(anos[ref])))}
    mensal = {}
    rec = slice(max(0, len(d) - 180), len(d))
    for r in regioes:
        k10 = (m10 > 0) if r["cod"] is None else (m10 == r["cod"])
        serie = np.concatenate([pr.media_regional(x[i:i + 1000][:, iy][:, :, ix], k10, w10) for i in range(0, len(x), 1000)])
        p50, p90 = np.full(365, np.nan), np.full(365, np.nan)
        for q in range(1, 366):
            janela = np.abs(((doy - q + 182) % 365) - 182) <= 7         # ±7 dias, circular
            v = serie[ref & janela]
            if len(v) > 30:
                p50[q - 1], p90[q - 1] = np.percentile(v, 50), np.percentile(v, 90)
        dr = doy[rec] - 1
        ult = float(serie[-1])
        v_hoje = serie[ref & (np.abs(((doy - doy[-1] + 182) % 365) - 182) <= 7)]
        out["regioes"][r["id"]] = {"datas": [str(z) for z in d[rec]], "v": arred(serie[rec], 1),
                                   "p50": arred(p50[dr], 1), "p90": arred(p90[dr], 1), "ultimo": round(ult, 1),
                                   "percentil": round(float((v_hoje < ult).mean() * 100)) if len(v_hoje) else None,
                                   "dias_acima_p90_30": int(np.sum(serie[-30:] > p90[doy[-30:] - 1]))}
        mm = {}
        for dd, v in zip(d.astype("datetime64[M]"), serie):
            mm.setdefault(str(dd), []).append(v)
        mensal[r["id"]] = [float(np.mean(mm[k])) if k in mm and len(mm[k]) >= 25 else None for k in rot_meses]
    passo = float(abs(lats[1] - lats[0])) if len(lats) > 1 else 0.25
    cima = lats.max() + passo / 2
    ordem = np.argsort(-lats)
    out["mapa"] = {"lon0": float(lons.min() - passo / 2), "lat0": float(cima), "d": passo, "nx": len(lons), "ny": len(lats),
                   "v": arred(x[-1][ordem][:, np.argsort(lons)], 1), "data": str(d[-1])}
    return out, mensal
