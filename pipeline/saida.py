"""
Cálculos finais e gravação dos arquivos que o site lê (site/dados/).
"""
import datetime as dt
import numpy as np
import config as C
import processamento as pr
from comum import G05, G10, arred, grava, log, soma_mes, ym

REGIOES = C.REGIOES


def rio_json(series):
    """series: {(codigo, nome): {data: cm}} -> estrutura do site."""
    est = []
    hoje = dt.date.today()
    for (codigo, nome), s in series.items():
        if len(s) < 30:
            continue
        datas = np.array(sorted(s), dtype="datetime64[D]")
        v = np.array([s[str(d)] for d in datas])
        doy = pr.dia_do_ano_365(datas)
        anos = datas.astype("datetime64[Y]").astype(int) + 1970
        ref = (anos >= pr.REF_INI) & (anos <= pr.REF_FIM)
        clim = {k: [] for k in ("p10", "p50", "p90")}
        for d in range(1, 366):
            x = v[ref & (doy == d)]
            for k, q in (("p10", 10), ("p50", 50), ("p90", 90)):
                clim[k].append(float(np.percentile(x, q)) if len(x) >= 10 else np.nan)
        def ano_curva(a):
            c = np.full(365, np.nan)
            sel = anos == a
            c[doy[sel] - 1] = v[sel]
            return arred(c, 0)
        todos = {str(a): ano_curva(a) for a in range(max(C.RIO_ANO_INICIAL, int(anos.min())), hoje.year + 1) if (anos == a).any()}
        padrao = [str(a) for a in C.RIO_ANOS_PADRAO + [hoje.year - 1, hoje.year] if str(a) in todos]
        est.append({"codigo": codigo, "nome": nome, "ultimo": {"data": str(datas[-1]), "cm": round(float(v[-1]))},
                    "ref_anos": int(len(np.unique(anos[ref]))),
                    "clim": {k: arred(c, 0) for k, c in clim.items()}, "anos": todos, "padrao": sorted(set(padrao)),
                    "min_hist": {"cm": round(float(v.min())), "data": str(datas[v.argmin()])}})
    return {"estacoes": est}



def amostrar_vizinho(campo, lats_o, lons_o, g):
    """Amostra campo[..., y, x] (grade de origem) na grade g pelo vizinho mais próximo."""
    iy = np.abs(lats_o[:, None] - g["lats"][None, :]).argmin(axis=0)
    ix = np.abs(lons_o[:, None] - g["lons"][None, :]).argmin(axis=0)
    return campo[..., iy[:, None], ix[None, :]]


def gerar_saida(P, anos_p, meses_p, tmax, tmin, datas, m05, m10, geo, previsoes=None, rio=None, enso=None,
                chuva_diaria=None, demo=False, fontes=None):
    """Calcula índices, médias regionais e grava todos os JSON do site.
    P: chuva mensal [t, y, x]; tmax/tmin: diárias [d, y, x] (podem incluir o mês em curso, incompleto);
    enso: (série, nome do índice); chuva_diaria: (P_d [d, y, x], datas_d, primeira data preliminar)."""
    C.SAIDA.mkdir(parents=True, exist_ok=True)
    for velho in (C.SAIDA / "mapas").glob("*.json") if (C.SAIDA / "mapas").exists() else []:
        velho.unlink()
    w05, w10 = pr.pesos_area(G05["lats"], G05["nx"]), pr.pesos_area(G10["lats"], G10["nx"])
    masc = lambda m, r: (m > 0) if r["cod"] is None else (m == r["cod"])

    # ---------------- temperatura: diário -> mensal, ETo, ondas de calor
    log("Calculando temperatura, ETo e ondas de calor…")
    doy = pr.dia_do_ano_365(datas)
    eto = np.empty(tmax.shape, dtype="float32")
    for i in range(0, len(datas), 366):
        s = slice(i, i + 366)
        eto[s] = pr.eto_hargreaves(tmax[s], tmin[s], G10["lats"], doy[s])
    limiar = pr.limiar_p90(tmax, datas)
    onda = pr.dias_onda_calor(tmax, datas, limiar)
    tmax_m, anos_t, meses_t = pr.diario_para_mensal(tmax, datas)
    tmin_m, _, _ = pr.diario_para_mensal(tmin, datas)
    eto_m, _, _ = pr.diario_para_mensal(eto, datas, soma=True)
    calor_m, _, _ = pr.diario_para_mensal(onda, datas, soma=True)
    del eto
    tmed_m = (tmax_m + tmin_m) / 2

    # ---------------- eixo mensal comum (1990-01 até o último mês com algum dado)
    i0 = C.ANO_INICIAL * 12
    ult = max(anos_p[-1] * 12 + meses_p[-1] - 1, anos_t[-1] * 12 + meses_t[-1] - 1)
    T = ult - i0 + 1
    anos = np.array([(i0 + i) // 12 for i in range(T)]); meses = np.array([(i0 + i) % 12 + 1 for i in range(T)])
    rot = [ym(a, m) for a, m in zip(anos, meses)]

    def no_eixo(x, a, m):
        out = np.full((T,) + x.shape[1:], np.nan, dtype="float32")
        out[a * 12 + m - 1 - i0] = x
        return out
    P = no_eixo(P, anos_p, meses_p)
    tmax_m, tmin_m, tmed_m = (no_eixo(x, anos_t, meses_t) for x in (tmax_m, tmin_m, tmed_m))
    eto_m, calor_m = no_eixo(eto_m, anos_t, meses_t), no_eixo(calor_m, anos_t, meses_t)
    fora05, fora10 = m05 == 0, m10 == 0

    # ---------------- campos em grade
    log("Calculando anomalias e índices de seca em grade…")
    P_anom, P_clim = pr.anomalia_mensal(P, anos, meses)
    with np.errstate(all="ignore"):
        P_pct = 100 * P_anom / np.where(P_clim[meses - 1] > 1, P_clim[meses - 1], np.nan)
    tmax_anom, _ = pr.anomalia_mensal(tmax_m, anos, meses)
    tmed_anom, _ = pr.anomalia_mensal(tmed_m, anos, meses)
    P10 = pr.reduzir_2x(P)
    bal = P10 - eto_m
    campos = {"chuva_pct": (P_pct, G05, 0), "chuva_anom": (P_anom, G05, 0),
              "tmax_anom": (tmax_anom, G10, 1), "tmed_anom": (tmed_anom, G10, 1), "calor": (calor_m, G10, 0)}
    for k in (3, 6, 12):
        campos[f"spi{k}"] = (pr.spi(P, anos, meses, k), G05, 1)
        campos[f"spei{k}"] = (pr.spei(bal, anos, meses, k), G10, 1)

    meses_mapas = {}
    for var, (campo, g, casas) in campos.items():
        fora = fora05 if g is G05 else fora10
        lista = []
        for t in range(T - 1, max(T - 1 - C.MESES_MAPAS, -1), -1):
            c = np.where(fora, np.nan, campo[t])
            if not np.isfinite(c).any():
                continue
            grava(C.SAIDA / "mapas" / f"{var}_{rot[t]}.json",
                  {"lon0": g["lon0"], "lat0": g["lat0"], "d": g["d"], "nx": g["nx"], "ny": g["ny"], "v": arred(c, casas)})
            lista.append(rot[t])
        meses_mapas[var] = sorted(lista)

    # ---------------- séries regionais
    log("Calculando séries regionais…")
    series, reg_P, reg_T = {}, {}, {}
    for r in REGIOES:
        k05, k10 = masc(m05, r), masc(m10, r)
        p = pr.media_regional(P, k05, w05)
        tx, tn = pr.media_regional(tmax_m, k10, w10), pr.media_regional(tmin_m, k10, w10)
        tm = (tx + tn) / 2
        et = pr.media_regional(eto_m, k10, w10)
        ca = pr.media_regional(calor_m, k10, w10)
        pa, pc = pr.anomalia_mensal(p, anos, meses)
        s = {"chuva": arred(p, 0), "chuva_clim": arred(pc[meses - 1], 0), "chuva_anom": arred(pa, 0),
             "chuva_pct": arred(100 * pa / np.maximum(pc[meses - 1], 1), 0),
             "tmax": arred(tx), "tmax_anom": arred(pr.anomalia_mensal(tx, anos, meses)[0]),
             "tmed_anom": arred(pr.anomalia_mensal(tm, anos, meses)[0]),
             "tmin_anom": arred(pr.anomalia_mensal(tn, anos, meses)[0]),
             "calor": arred(ca), "calor_clim": arred(pr.climatologia_mensal(ca, anos, meses)[meses - 1])}
        for k in pr.ESCALAS:
            s[f"spi{k}"] = arred(pr.spi(p[:, None], anos, meses, k)[:, 0], 2)
            s[f"spei{k}"] = arred(pr.spei((p - et)[:, None], anos, meses, k)[:, 0], 2)
        series[r["id"]] = s
        reg_P[r["id"]], reg_T[r["id"]] = p, tm
    # ---------------- El Niño: série, eventos e início do evento atual
    serie_enso, nome_enso = (enso[0], enso[1]) if enso else ([], None)
    semanal = enso[2] if enso and len(enso) > 2 else None
    eventos = pr.eventos_enso(serie_enso)
    ninos = [e for e in eventos if e["tipo"] == "El Niño"]
    atual = next((e for e in reversed(ninos) if e["em_curso"]), ninos[-1] if ninos else None)
    info_enso = {"indice": nome_enso, "serie": serie_enso, "eventos": eventos, "atual": atual, "aviso": C.EL_NINO_AVISO,
                 "semanal": semanal}

    # ---------------- ano hidrológico (chuva acumulada desde outubro)
    hidro = ano_hidrologico_json(reg_P, anos, meses, chuva_diaria, m05, w05, masc)

    grava(C.SAIDA / "series.json", {"meses": rot, "regioes": series, "enso": info_enso, "hidro": hidro})

    # ---------------- "agora": últimos dias (chuva diária preliminar e calor do mês em curso)
    agora = agora_json(P_clim, chuva_diaria, tmax, datas, onda, m05, m10, w05, w10, masc)
    grava(C.SAIDA / "agora.json", agora)
    del onda

    # ---------------- previsão e previsto x observado (anomalias em relação a 1993-2016, clima dos modelos no C3S)
    prev_json, verif_json = {"ref": "1993–2016", "modelos": []}, {"ref": "1993–2016", "modelos": []}
    obs_anom = {}
    for r in REGIOES:
        obs_anom[r["id"]] = {"chuva": pr.anomalia_mensal(reg_P[r["id"]], anos, meses, 1993, 2016),
                             "temp": pr.anomalia_mensal(reg_T[r["id"]], anos, meses, 1993, 2016)}
    for mid, mod in (previsoes or {}).items():
        rodadas = mod["rodadas"]
        ver = {r["id"]: {"chuva": [], "temp": []} for r in REGIOES}
        ult_rodada = max(rodadas)
        for (a, m), d in sorted(rodadas.items()):
            t10 = amostrar_vizinho(d["t"], d["lats"], d["lons"], G10)       # [membro, lead, ny, nx]
            p10 = amostrar_vizinho(d["p"], d["lats"], d["lons"], G10)
            reg_prev = {}
            for r in REGIOES:
                k10 = masc(m10, r)
                tr = np.array([pr.media_regional(x, k10, w10) for x in t10])  # [membro, lead]
                pr_ = np.array([pr.media_regional(x, k10, w10) for x in p10])
                reg_prev[r["id"]] = (pr_, tr)
                for j, L in enumerate(d["leads"]):
                    aa, mm = soma_mes(a, m, L - 1)
                    it = aa * 12 + mm - 1 - i0
                    for nome_v, arr, obs in (("chuva", pr_, obs_anom[r["id"]]["chuva"][0]), ("temp", tr, obs_anom[r["id"]]["temp"][0])):
                        o = obs[it] if 0 <= it < T and np.isfinite(obs[it]) else None
                        ponto = {"inic": ym(a, m), "alvo": ym(aa, mm), "lead": L,
                                 "prev": round(float(arr[:, j].mean()), 2),
                                 "obs": None if o is None else round(float(o), 2)}
                        if arr.shape[0] >= 10:                     # faixa do conjunto (membros), não só a média
                            q10, q90 = np.percentile(arr[:, j], [10, 90])
                            ponto.update(p10=round(float(q10), 2), p90=round(float(q90), 2))
                        ver[r["id"]][nome_v].append(ponto)
            if (a, m) == ult_rodada:
                alvos = [ym(*soma_mes(a, m, L - 1)) for L in d["leads"]]
                regs = {}
                for r in REGIOES:
                    pr_, tr = reg_prev[r["id"]]
                    clim = [float(obs_anom[r["id"]]["chuva"][1][soma_mes(a, m, L - 1)[1] - 1]) for L in d["leads"]]
                    def resumo(x, casas):
                        o = {"media": arred(x.mean(0), casas)}
                        if x.shape[0] >= 10:
                            o.update(p10=arred(np.percentile(x, 10, 0), casas), p90=arred(np.percentile(x, 90, 0), casas),
                                     frac_neg=arred(100 * (x < 0).mean(0), 0))
                        return o
                    regs[r["id"]] = {"chuva": resumo(pr_, 0), "temp": resumo(tr, 2), "chuva_clim_obs": arred(clim, 0)}
                d1 = float(abs(d["lats"][1] - d["lats"][0])) if len(d["lats"]) > 1 else 1.0
                gr = {"lon0": float(d["lons"].min() - d1 / 2), "lat0": float(d["lats"].max() + d1 / 2), "d": d1,
                      "nx": len(d["lons"]), "ny": len(d["lats"])}
                prev_json["modelos"].append({
                    "id": mid, "nome": mod["nome"], "inic": ym(a, m), "alvos": alvos, "membros": int(d["t"].shape[0]),
                    "grade": gr, "regioes": regs,
                    "mapas": {"chuva": [arred(x, 0) for x in d["p"].mean(0)], "temp": [arred(x, 2) for x in d["t"].mean(0)]}})
        verif_json["modelos"].append({"id": mid, "nome": mod["nome"], "regioes": ver})
    grava(C.SAIDA / "previsao.json", prev_json)
    grava(C.SAIDA / "verificacao.json", verif_json)
    grava(C.SAIDA / "rio.json", rio or {"estacoes": []})
    grava(C.SAIDA / "regioes.geojson", geo)

    ult_p = ym(anos_p[-1], meses_p[-1]); ult_t = ym(anos_t[-1], meses_t[-1])
    grava(C.SAIDA / "meta.json", {
        "demo": bool(demo), "atualizado": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "ref": f"{pr.REF_INI}–{pr.REF_FIM}", "ultimo_chuva": ult_p, "ultimo_temp": ult_t,
        "regioes": [{"id": r["id"], "nome": r["nome"], "curto": r.get("curto", r["nome"])} for r in REGIOES], "mapas": meses_mapas,
        "fontes": fontes or {}, "ultimo_diario_temp": str(datas[-1]),
        "ultimo_diario_chuva": str(chuva_diaria[1][-1]) if chuva_diaria and chuva_diaria[0] is not None else None})
    log(f"Pronto. Chuva até {ult_p}; temperatura até {ult_t}. Arquivos em {C.SAIDA}")




def ano_hidrologico_json(reg_P, anos, meses, chuva_diaria, m05, w05, masc):
    """Curvas de chuva acumulada no ano hidrológico por região, com a faixa de 1991–2020."""
    mi = C.MES_INICIO_ANO_HIDRO
    ordem = list(range(mi, 13)) + list(range(1, mi))
    out = {"meses": [ym(2000, m)[5:] for m in ordem], "mes_inicio": mi, "ref": "1990/91–2019/20", "regioes": {}}
    P_d, datas_d, ini_prelim = chuva_diaria if chuva_diaria else (None, None, None)
    for r in REGIOES:
        curvas = pr.ano_hidrologico(reg_P[r["id"]], anos, meses, mi)
        ref = np.array([c for a, c in curvas.items() if 1990 <= a <= 2019 and np.isfinite(c[-1])])
        reg = {"clim": {k: arred(np.percentile(ref, q, axis=0), 0) for k, q in (("p10", 10), ("p50", 50), ("p90", 90))}
               if len(ref) >= 20 else None, "anos": {}}
        for a in sorted(set(C.ANOS_HIDRO_DESTAQUE) | set(list(curvas)[-2:])):
            if a in curvas:
                reg["anos"][f"{a}/{str(a + 1)[2:]}"] = arred(curvas[a], 0)
        # acréscimo parcial com a chuva diária depois do último mês completo
        ult = max(curvas) if curvas else None
        if ult is not None and P_d is not None:
            c = curvas[ult]
            k = int(np.where(np.isfinite(c))[0].max())                      # último mês completo (índice)
            a_ult, m_ult = (ult if ordem[k] >= mi else ult + 1), ordem[k]
            a_n, m_n = soma_mes(a_ult, m_ult, 1)
            ini = np.datetime64(f"{a_n:04d}-{m_n:02d}-01")
            sel = datas_d >= ini
            if sel.any() and datas_d[0] <= ini:
                v = float(np.nansum(pr.media_regional(P_d[sel], masc(m05, r), w05)))
                if k < 11:                                   # ano hidrológico em curso
                    ano_p, base = ult, float(c[k])
                else:                                        # setembro fechado: começou um novo ano hidrológico
                    ano_p, base = ult + 1, 0.0
                idx = ordem.index(int(str(datas_d[-1])[5:7]))   # mês do último dia com chuva diária
                reg["parcial"] = {"ano": f"{ano_p}/{str(ano_p + 1)[2:]}", "indice": idx, "ate": str(datas_d[-1]),
                                  "valor": round(base + v), "preliminar": ini_prelim is not None}
        out["regioes"][r["id"]] = reg
    return out


def agora_json(P_clim, chuva_diaria, tmax, datas, onda, m05, m10, w05, w10, masc):
    """Indicadores dos últimos dias: chuva de 30 e 90 dias (% da normal), dias em onda de calor no mês em curso
    e anomalia de Tmax dos últimos 30 dias."""
    out = {"regioes": {r["id"]: {} for r in REGIOES}}
    anos_d = datas.astype("datetime64[Y]").astype(int) + 1970
    ref = (anos_d >= pr.REF_INI) & (anos_d <= pr.REF_FIM)

    # --- chuva
    P_d, datas_d, ini_prelim = chuva_diaria if chuva_diaria else (None, None, None)
    if P_d is not None:
        taxa = pr.clima_diaria_epstein(np.nan_to_num(P_clim))                 # [365, y, x] mm/dia
        fim = datas_d[-1]
        out["chuva"] = {"ate": str(fim), "preliminar_desde": ini_prelim}
        for n in (30, 90):
            sel = datas_d > fim - n
            if sel.sum() < n:
                continue
            obs = np.nansum(P_d[sel], axis=0)
            esp = pr.esperado_janela(taxa, datas_d[sel])
            for r in REGIOES:
                k = masc(m05, r)
                o = float(np.nansum(np.where(k, obs, 0) * w05) / np.sum(np.where(k, w05, 0)))
                e = float(np.nansum(np.where(k, esp, 0) * w05) / np.sum(np.where(k, w05, 0)))
                out["regioes"][r["id"]][f"chuva{n}"] = {"mm": round(o), "normal": round(e), "pct": round(100 * o / e) if e > 1 else None}
            if n == 30:
                with np.errstate(all="ignore"):
                    pct = np.where(m05 > 0, 100 * obs / np.where(esp > 1, esp, np.nan), np.nan)
                out["mapa_chuva30"] = {"lon0": G05["lon0"], "lat0": G05["lat0"], "d": G05["d"], "nx": G05["nx"],
                                       "ny": G05["ny"], "v": arred(pct, 0), "de": str(fim - (n - 1)), "ate": str(fim)}

    # --- calor no mês em curso (até o último dia com dado)
    fim_t = datas[-1]
    mes_ini = fim_t.astype("datetime64[M]").astype("datetime64[D]")
    dia_lim = int((fim_t - mes_ini).astype(int)) + 1
    mes_n = int(str(fim_t)[5:7])
    sel_mes = datas >= mes_ini
    dias_mes = (datas.astype("datetime64[M]").astype(int) % 12 + 1 == mes_n) & \
               ((datas - datas.astype("datetime64[M]").astype("datetime64[D]")).astype(int) < dia_lim)
    n_ref = len(np.unique(anos_d[ref & dias_mes]))
    clim_calor = onda[ref & dias_mes].sum(axis=0) / max(n_ref, 1)
    obs_calor = onda[sel_mes].sum(axis=0)
    # --- Tmax dos últimos 30 dias
    sel30 = datas > fim_t - 30
    doy = pr.dia_do_ano_365(datas)
    doys30 = set(doy[sel30].tolist())
    clim_tmax = np.nanmean(tmax[ref & np.isin(doy, list(doys30))], axis=0)
    anom30 = np.nanmean(tmax[sel30], axis=0) - clim_tmax
    out["temp"] = {"ate": str(fim_t), "mes": str(fim_t)[:7], "dia": dia_lim}
    for r in REGIOES:
        k = masc(m10, r)
        media = lambda x: float(np.nansum(np.where(k, x, 0) * w10) / np.sum(np.where(k, w10, 0)))
        out["regioes"][r["id"]]["calor_mes"] = {"dias": round(media(obs_calor), 1), "normal": round(media(clim_calor), 1)}
        out["regioes"][r["id"]]["tmax30_anom"] = round(media(anom30), 1)
    return out
