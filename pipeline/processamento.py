"""
Cálculos do Painel Hidroclimático da BAP (sem acesso à rede: só numpy/scipy).

Referências dos métodos:
- Normal climatológica 1991-2020: WMO (2017), Guidelines on the Calculation of Climate Normals, WMO-No. 1203.
- SPI: McKee, Doesken & Kleist (1993); ajuste gama por máxima verossimilhança aproximada de Thom (1958).
- SPEI: Vicente-Serrano, Beguería & López-Moreno (2010), J. Climate 23; log-logística por momentos
  ponderados por probabilidade (PWM).
- ETo: Hargreaves & Samani (1985); radiação extraterrestre conforme Allen et al. (1998), FAO-56.
- Ondas de calor (CTX90pct): Perkins & Alexander (2013), J. Climate 26 — >= 3 dias consecutivos com
  Tmax acima do percentil 90 do dia do calendário (janela móvel de 15 dias).
"""
import numpy as np
from scipy import special, stats

REF_INI, REF_FIM = 1991, 2020          # normal climatológica (WMO, 2017)
ESCALAS = (1, 3, 6, 12)                # escalas de SPI/SPEI em meses


# ----------------------------------------------------------------------------- utilidades
def pesos_area(lats, nx):
    """Peso proporcional à área da célula (cos da latitude) em grade regular lat/lon."""
    return np.repeat(np.cos(np.deg2rad(lats))[:, None], nx, axis=1)


def media_regional(campo, mascara, pesos):
    """Média ponderada por área de campo[t, y, x] dentro de mascara[y, x] (bool). Ignora NaN."""
    w = np.where(mascara, pesos, 0.0)[None]
    valido = np.isfinite(campo)
    num = np.nansum(np.where(valido, campo, 0.0) * w, axis=(1, 2))
    den = np.sum(valido * w, axis=(1, 2))
    return np.where(den > 0, num / np.maximum(den, 1e-12), np.nan)


def climatologia_mensal(x, anos, meses, ini=REF_INI, fim=REF_FIM):
    """Média por mês do calendário no período de referência. x[t, ...] -> clim[12, ...]."""
    ref = (anos >= ini) & (anos <= fim)
    return np.stack([np.nanmean(x[ref & (meses == m)], axis=0) for m in range(1, 13)])


def anomalia_mensal(x, anos, meses, ini=REF_INI, fim=REF_FIM):
    clim = climatologia_mensal(x, anos, meses, ini, fim)
    return x - clim[meses - 1], clim


def acumular(x, k, soma=True):
    """Acumulado (ou média) móvel de k meses terminando em cada mês. Primeiros k-1 = NaN."""
    if k == 1:
        return x.astype(float).copy()
    c = np.cumsum(np.nan_to_num(x.astype(float)), axis=0)
    out = np.full(x.shape, np.nan)
    out[k - 1:] = c[k - 1:] - np.concatenate([np.zeros((1,) + x.shape[1:]), c[:-k]], axis=0)
    ruim = np.isnan(x).astype(float)
    cb = np.cumsum(ruim, axis=0)
    nb = np.zeros(x.shape)
    nb[k - 1:] = cb[k - 1:] - np.concatenate([np.zeros((1,) + x.shape[1:]), cb[:-k]], axis=0)
    out[nb > 0] = np.nan
    return out if soma else out / k


# ----------------------------------------------------------------------------- SPI
def spi(prec, anos, meses, k, ini=REF_INI, fim=REF_FIM):
    """SPI-k. prec[t, ...] em mm/mês. Gama de 2 parâmetros + probabilidade de zeros (McKee et al., 1993)."""
    acc = acumular(prec, k)
    out = np.full(acc.shape, np.nan)
    ref = (anos >= ini) & (anos <= fim)
    for m in range(1, 13):
        sel = meses == m
        base = acc[sel & ref]
        n = np.sum(np.isfinite(base), axis=0)
        pos = np.where(base > 0, base, np.nan)
        npos = np.sum(np.isfinite(pos), axis=0)
        q = np.where(n > 0, (n - npos) / np.maximum(n, 1), np.nan)      # probabilidade de zero
        with np.errstate(all="ignore"):
            media = np.nanmean(pos, axis=0)
            A = np.log(media) - np.nanmean(np.log(pos), axis=0)
            A = np.maximum(A, 1e-6)
            alfa = (1 + np.sqrt(1 + 4 * A / 3)) / (4 * A)               # Thom (1958)
            beta = media / alfa
            x = acc[sel]
            G = special.gammainc(alfa[None], np.maximum(x, 0) / beta[None])
            H = q[None] + (1 - q[None]) * G
            H = np.where(x <= 0, q[None] / 2, H)                        # zeros: centro da massa de probabilidade
            z = stats.norm.ppf(np.clip(H, 1e-4, 1 - 1e-4))
        z = np.where(np.isfinite(x) & (npos[None] >= 10), z, np.nan)
        out[sel] = z
    return np.clip(out, -3, 3)


# ----------------------------------------------------------------------------- SPEI
def spei(balanco, anos, meses, k, ini=REF_INI, fim=REF_FIM):
    """SPEI-k. balanco[t, ...] = P - ETo (mm/mês). Log-logística de 3 parâmetros via PWM."""
    acc = acumular(balanco, k)
    out = np.full(acc.shape, np.nan)
    ref = (anos >= ini) & (anos <= fim)
    for m in range(1, 13):
        sel = meses == m
        base = acc[sel & ref]
        ok = np.all(np.isfinite(base), axis=0) if base.shape[0] else np.zeros(acc.shape[1:], bool)
        N = base.shape[0]
        if N < 10:
            continue
        s = np.sort(np.where(np.isfinite(base), base, 0.0), axis=0)
        F = ((np.arange(1, N + 1) - 0.35) / N).reshape((N,) + (1,) * (s.ndim - 1))
        w0 = s.mean(axis=0)
        w1 = (s * (1 - F)).mean(axis=0)
        w2 = (s * (1 - F) ** 2).mean(axis=0)
        with np.errstate(all="ignore"):
            b = (2 * w1 - w0) / (6 * w1 - w0 - 6 * w2)
            gg = special.gamma(1 + 1 / b) * special.gamma(1 - 1 / b)
            a = (w0 - 2 * w1) * b / gg
            g = w0 - a * gg
            x = acc[sel]
            razao = a[None] / (x - g[None])
            Fx = 1.0 / (1.0 + np.where(razao > 0, razao, np.nan) ** b[None])
            # fora do domínio da distribuição: cauda inferior (b > 0) ou superior (b < 0, assimetria negativa)
            fora = razao <= 0
            Fx = np.where(fora, np.where(b[None] > 0, 1e-4, 1 - 1e-4), Fx)
            z = stats.norm.ppf(np.clip(Fx, 1e-4, 1 - 1e-4))
        bom = ok & np.isfinite(b) & (np.abs(b) > 1) & np.isfinite(a) & (a * b > 0)
        out[sel] = np.where(bom[None] & np.isfinite(x), z, np.nan)
    return np.clip(out, -3, 3)


# ----------------------------------------------------------------------------- ETo Hargreaves-Samani
def radiacao_extraterrestre(lats, doy):
    """Ra em mm/dia equivalente (Allen et al., 1998, eq. 21). lats[y] em graus; doy[t]. -> Ra[t, y]."""
    phi = np.deg2rad(lats)[None, :]
    J = np.asarray(doy, float)[:, None]
    dr = 1 + 0.033 * np.cos(2 * np.pi * J / 365)
    delta = 0.409 * np.sin(2 * np.pi * J / 365 - 1.39)
    ws = np.arccos(np.clip(-np.tan(phi) * np.tan(delta), -1, 1))
    Ra = (24 * 60 / np.pi) * 0.0820 * dr * (ws * np.sin(phi) * np.sin(delta) + np.cos(phi) * np.cos(delta) * np.sin(ws))
    return 0.408 * Ra


def eto_hargreaves(tmax, tmin, lats, doy):
    """ETo diária (mm/dia). tmax, tmin[t, y, x] em °C."""
    Ra = radiacao_extraterrestre(lats, doy)[:, :, None]
    tmed = (tmax + tmin) / 2
    return 0.0023 * Ra * (tmed + 17.8) * np.sqrt(np.maximum(tmax - tmin, 0))


# ----------------------------------------------------------------------------- ondas de calor
def dia_do_ano_365(datas):
    """Dia do ano 1..365 (29/fev recebe o dia de 28/fev). datas: array datetime64[D]."""
    d = datas.astype("datetime64[D]")
    ano = d.astype("datetime64[Y]")
    doy = (d - ano).astype(int) + 1
    bissexto = ((ano.astype(int) + 1970) % 4 == 0) & (((ano.astype(int) + 1970) % 100 != 0) | ((ano.astype(int) + 1970) % 400 == 0))
    doy = np.where(bissexto & (doy >= 60), doy - 1, doy)
    return doy


def limiar_p90(tmax, datas, ini=REF_INI, fim=REF_FIM, janela=15, q=90):
    """Percentil 90 de Tmax por dia do calendário, janela centrada de 15 dias. -> [365, y, x]."""
    doy = dia_do_ano_365(datas)
    anos = datas.astype("datetime64[Y]").astype(int) + 1970
    ref = (anos >= ini) & (anos <= fim)
    meia = janela // 2
    lim = np.full((365,) + tmax.shape[1:], np.nan, dtype=np.float32)
    for d in range(1, 366):
        dist = np.abs(doy - d)
        dist = np.minimum(dist, 365 - dist)
        sel = ref & (dist <= meia)
        if sel.sum() >= 30:
            lim[d - 1] = np.nanpercentile(tmax[sel], q, axis=0)
    return lim


def dias_onda_calor(tmax, datas, limiar, minimo=3):
    """Booleano[t, y, x]: dia pertence a uma sequência de >= 3 dias com Tmax > limiar do dia."""
    assert minimo == 3
    doy = dia_do_ano_365(datas)
    e = tmax > limiar[doy - 1]
    z = np.zeros((1,) + e.shape[1:], bool)
    a1 = np.concatenate([e[1:], z]); a2 = np.concatenate([e[2:], z, z])
    b1 = np.concatenate([z, e[:-1]]); b2 = np.concatenate([z, z, e[:-2]])
    return e & ((a1 & a2) | (b1 & a1) | (b1 & b2))


def diario_para_mensal(x, datas, soma=False):
    """Agrega x[t, ...] diário para mensal. Só meses completos. -> (valores[m, ...], anos, meses)."""
    ym = datas.astype("datetime64[M]")
    unicos = np.unique(ym)
    vals, anos, meses = [], [], []
    for u in unicos:
        sel = ym == u
        ndias = ((u + 1).astype("datetime64[D]") - u.astype("datetime64[D]")).astype(int)
        if sel.sum() < ndias:
            continue
        vals.append(np.sum(x[sel], axis=0, dtype=np.float64) if soma else np.mean(x[sel], axis=0, dtype=np.float64))
        anos.append(u.astype("datetime64[Y]").astype(int) + 1970)
        meses.append(u.astype(int) % 12 + 1)
    return np.array(vals), np.array(anos), np.array(meses)


def reduzir_2x(x):
    """Média em blocos 2x2 (0,05° -> 0,1°). x[..., ny, nx] com ny e nx pares."""
    s = x.shape
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmean(x.reshape(s[:-2] + (s[-2] // 2, 2, s[-1] // 2, 2)), axis=(-3, -1))


def classe_seca(z):
    """Classes de McKee et al. (1993)."""
    if z is None or not np.isfinite(z):
        return "sem dado"
    if z <= -2: return "seca extrema"
    if z <= -1.5: return "seca severa"
    if z <= -1: return "seca moderada"
    if z < 1: return "próximo do normal"
    if z < 1.5: return "moderadamente úmido"
    if z < 2: return "muito úmido"
    return "extremamente úmido"


# ----------------------------------------------------------------------------- climatologia diária da chuva
DIAS_MES = np.array([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])


def clima_diaria_epstein(clim_mensal):
    """Climatologia diária (mm/dia) a partir das 12 médias mensais (mm/mês), por harmônicos que preservam as
    médias mensais (Epstein, 1991, J. Climate 4: 365-368). clim_mensal[12, ...] -> taxa[365, ...]."""
    r = clim_mensal / DIAS_MES.reshape((12,) + (1,) * (clim_mensal.ndim - 1))      # mm/dia em cada mês
    centros = 2 * np.pi * (np.arange(12) + 0.5) / 12
    # posição de cada dia do ano (365) em "meses", 0..12
    t = np.concatenate([m + (np.arange(n) + 0.5) / n for m, n in enumerate(DIAS_MES)])
    fi = 2 * np.pi * t / 12
    forma = (-1,) + (1,) * (clim_mensal.ndim - 1)
    out = np.repeat(r.mean(axis=0)[None], 365, axis=0)
    for k in range(1, 7):
        a = (2 / 12) * np.tensordot(np.cos(k * centros), r, axes=(0, 0))
        b = (2 / 12) * np.tensordot(np.sin(k * centros), r, axes=(0, 0))
        if k == 6:
            a, b = a / 2, b * 0
        f = (np.pi * k / 12) / np.sin(np.pi * k / 12)                           # correção de Epstein
        out = out + f * (np.cos(k * fi).reshape(forma) * a[None] + np.sin(k * fi).reshape(forma) * b[None])
    return np.maximum(out, 0)


def esperado_janela(taxa_diaria, datas):
    """Soma da climatologia diária nos dias informados. taxa[365, ...], datas datetime64[D] -> [...]"""
    return taxa_diaria[dia_do_ano_365(datas) - 1].sum(axis=0)


# ----------------------------------------------------------------------------- ano hidrológico
def ano_hidrologico(p, anos, meses, mes_ini=10):
    """Chuva acumulada mês a mês no ano hidrológico (out-set). p[t] mensal.
    -> {ano_inicial: array[12] acumulado (NaN onde falta)}"""
    out = {}
    for a in np.unique(anos):
        idx = [np.where((anos == (a if m >= mes_ini else a + 1)) & (meses == m))[0] for m in
               list(range(mes_ini, 13)) + list(range(1, mes_ini))]
        v = np.array([p[i[0]] if len(i) else np.nan for i in idx])
        if np.isfinite(v[0]):
            c = np.cumsum(np.nan_to_num(v))
            ult = np.where(np.isfinite(v))[0]
            c[ult.max() + 1:] = np.nan
            if not np.all(np.isfinite(v[:ult.max() + 1])):
                continue
            out[int(a)] = c
    return out


# ----------------------------------------------------------------------------- El Niño
def eventos_enso(serie, limiar=0.5, minimo=5, minimo_provisorio=3):
    """Eventos pelo critério da NOAA/CPC: >= 5 trimestres móveis consecutivos com índice >= +0,5 °C
    (El Niño) ou <= -0,5 °C (La Niña). serie: [{"t": "AAAA-MM" (mês central), "v": valor}].
    -> [{"tipo", "inicio", "fim", "pico", "em_curso"}]"""
    ev = []
    for tipo, cond in (("El Niño", lambda v: v >= limiar), ("La Niña", lambda v: v <= -limiar)):
        i = 0
        while i < len(serie):
            if cond(serie[i]["v"]):
                j = i
                while j + 1 < len(serie) and cond(serie[j + 1]["v"]):
                    j += 1
                em_curso = j == len(serie) - 1
                if j - i + 1 >= minimo or (em_curso and j - i + 1 >= minimo_provisorio):
                    # em curso com menos de 5 trimestres: evento provisório (confirma-se ao completar 5)
                    vs = [s["v"] for s in serie[i:j + 1]]
                    ev.append({"tipo": tipo, "inicio": serie[i]["t"], "fim": serie[j]["t"],
                               "pico": max(vs) if tipo == "El Niño" else min(vs), "em_curso": em_curso,
                               "provisorio": j - i + 1 < minimo, "trimestres": j - i + 1})
                i = j + 1
            else:
                i += 1
    return sorted(ev, key=lambda e: e["inicio"])
