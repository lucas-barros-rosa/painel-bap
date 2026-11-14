"""
Dados SIMULADOS para testar o site sem internet (python atualizar_dados.py --demo).
Nada aqui é dado real: limites são polígonos grosseiros e os valores são aleatórios.
O site mostra uma faixa de aviso enquanto meta.json tiver "demo": true.
"""
import datetime as dt
import numpy as np
from matplotlib.path import Path as MPath
import config as C
import processamento as pr
from comum import G05, G10, soma_mes, ym
from saida import gerar_saida, rio_json

POLIGONOS = {   # lon, lat — esboço apenas para a demonstração
    1: [(-59.6, -15.2), (-58.2, -14.2), (-56.0, -14.1), (-54.2, -15.2), (-53.3, -16.8), (-53.6, -17.9), (-55.0, -17.4),
        (-55.6, -16.2), (-56.6, -15.8), (-57.8, -15.9), (-58.4, -16.3), (-59.4, -16.2)],
    2: [(-58.4, -16.3), (-57.8, -15.9), (-56.6, -15.8), (-55.6, -16.2), (-55.0, -17.4), (-55.4, -17.9), (-57.6, -17.9),
        (-58.3, -17.4)],
    3: [(-55.0, -17.4), (-53.6, -17.9), (-53.4, -19.0), (-54.3, -20.6), (-55.6, -21.8), (-57.2, -22.2), (-56.6, -21.0),
        (-56.0, -20.2), (-55.4, -19.0), (-55.4, -17.9)],
    4: [(-57.6, -17.9), (-55.4, -17.9), (-55.4, -19.0), (-56.0, -20.2), (-56.6, -21.0), (-57.2, -22.2), (-57.9, -22.1),
        (-57.9, -20.0), (-57.6, -19.0)],
}


def mascara(g):
    xx, yy = np.meshgrid(g["lons"], g["lats"])
    pts = np.c_[xx.ravel(), yy.ravel()]
    m = np.zeros(xx.size, "uint8")
    for cod, pol in POLIGONOS.items():
        m[MPath(pol).contains_points(pts)] = cod
    return m.reshape(xx.shape)


def campo_suave(rng, n, g, escala=1.0):
    """n campos aleatórios espacialmente suaves na grade g."""
    by, bx = g["ny"] // 12 + 2, g["nx"] // 12 + 2
    base = rng.normal(0, escala, size=(n, by, bx))
    iy = np.linspace(0, by - 1, g["ny"]); ix = np.linspace(0, bx - 1, g["nx"])
    y0 = np.floor(iy).astype(int).clip(0, by - 2); x0 = np.floor(ix).astype(int).clip(0, bx - 2)
    fy = (iy - y0)[None, :, None]; fx = (ix - x0)[None, None, :]
    a = base[:, y0][:, :, x0]; b = base[:, y0][:, :, x0 + 1]; c = base[:, y0 + 1][:, :, x0]; d = base[:, y0 + 1][:, :, x0 + 1]
    return (a * (1 - fy) * (1 - fx) + b * (1 - fy) * fx + c * fy * (1 - fx) + d * fy * fx).astype("float32")


def rodar():
    rng = np.random.default_rng(7)
    hoje = dt.date.today()
    fim = np.datetime64(hoje) - 7                                      # ERA5-Land: ~1 semana de atraso
    fim_mes = np.datetime64(hoje.replace(day=1)) - 1
    datas = np.arange(np.datetime64(f"{C.ANO_INICIAL}-01-01"), fim + 1)
    m05, m10 = mascara(G05), mascara(G10)
    geo = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"cod": c, "id": r["id"], "nome": r["nome"]},
         "geometry": {"type": "Polygon", "coordinates": [[list(p) for p in pol + [pol[0]]]]}}
        for c, pol in POLIGONOS.items() for r in C.REGIOES if r["cod"] == c]}

    # chuva mensal (termina um mês antes da temperatura, como costuma ocorrer com o CHIRPS)
    nm = (fim_mes.astype("datetime64[M]").astype(int) - (C.ANO_INICIAL - 1970) * 12)
    anos_p = np.array([C.ANO_INICIAL + i // 12 for i in range(nm)]); meses_p = np.array([i % 12 + 1 for i in range(nm)])
    saz = np.array([230, 200, 160, 90, 45, 15, 8, 15, 50, 110, 170, 220.0])[meses_p - 1]
    grad = (1.15 - 0.3 * (G05["lats"][:, None] - G05["lats"].max()) / (G05["lats"].min() - G05["lats"].max())) * np.ones((1, G05["nx"]))
    fator = np.exp(0.45 * campo_suave(rng, nm, G05) + 0.25 * rng.normal(size=(nm, 1, 1)))
    seco = np.ones(nm); seco[-7:] = [0.75, 0.6, 0.55, 0.6, 0.5, 0.65, 0.7]   # estiagem simulada recente
    P = (saz[:, None, None] * grad[None] * fator * seco[:, None, None]).astype("float32")

    # temperatura diária
    doy = pr.dia_do_ano_365(datas)
    ciclo = 33 + 3.0 * np.sin(2 * np.pi * (doy - 215) / 365)
    tend = 0.03 * (datas.astype("datetime64[Y]").astype(int) + 1970 - 1990)
    ar = np.zeros(len(datas)); e = rng.normal(0, 1.6, len(datas))
    for i in range(1, len(datas)):
        ar[i] = 0.8 * ar[i - 1] + e[i]
    ar[-200:] += 2.0                                                    # calor simulado recente
    esp = campo_suave(rng, 1, G10, 1.0)[0] - 2.0 * (G10["lats"][:, None] - G10["lats"].max()) / 9
    ruido = np.repeat(campo_suave(rng, len(datas) // 5 + 1, G10, 0.8), 5, axis=0)[:len(datas)]
    tmax = ((ciclo + tend + ar)[:, None, None] + esp[None] + ruido).astype("float32")
    tmin = (tmax - 11 - 2 * np.cos(2 * np.pi * (doy - 30) / 365)[:, None, None] + 0.5 * ruido).astype("float32")

    # previsões simuladas (grade de 1°)
    lats = np.arange(-13.0, -23.5, -1.0); lons = np.arange(-61.0, -51.5, 1.0)
    gp = {"ny": len(lats), "nx": len(lons)}
    prev = {}
    for mid, nome, vies in (("ecmwf", "ECMWF SEAS5 (simulado)", 0.0), ("cmcc", "CMCC SPS3.5 (simulado)", 8.0)):
        rod = {}
        a, m = C.VERIF_INICIO
        while (a, m) <= (hoje.year, hoje.month):
            saz_l = np.array([230, 200, 160, 90, 45, 15, 8, 15, 50, 110, 170, 220.0])[[soma_mes(a, m, L)[1] - 1 for L in range(6)]]
            p = rng.normal(vies - 5, 12, size=(25, 6, 1, 1)) * (saz_l / 120)[None, :, None, None] + campo_suave(rng, 25 * 6, gp, 6).reshape(25, 6, gp["ny"], gp["nx"])
            t = rng.normal(0.9, 0.5, size=(25, 6, 1, 1)) + campo_suave(rng, 25 * 6, gp, 0.2).reshape(25, 6, gp["ny"], gp["nx"])
            rod[(a, m)] = {"lats": lats, "lons": lons, "leads": [1, 2, 3, 4, 5, 6], "t": t, "p": p}
            a, m = soma_mes(a, m, 1)
        prev[mid] = {"nome": nome, "sistema": "demo", "rodadas": rod}

    # rio simulado
    dr = np.arange(np.datetime64("1970-01-01"), np.datetime64(hoje))
    d2 = pr.dia_do_ano_365(dr); an = dr.astype("datetime64[Y]").astype(int) + 1970
    amp = {a: rng.normal(1, 0.3) for a in np.unique(an)}; amp[2020] = 0.35; amp[2021] = 0.25; amp[2024] = 0.2; amp[hoje.year] = 0.45
    niv = 80 + np.array([amp[a] for a in an]) * 330 * np.clip(np.sin(np.pi * ((d2 - 20) % 365) / 365) ** 1.5, 0, 1) - 60 * (np.array([amp[a] for a in an]) < 0.5)
    rio = rio_json({("66825000", "Ladário (simulado)"): {str(d): float(v) for d, v in zip(dr, niv)}})
    oni = [{"t": ym(1990 + i // 12, i % 12 + 1), "v": round(float(1.3 * np.sin(i / 7.0) + 0.3 * np.sin(i / 2.3)), 1)} for i in range(nm)]
    for k, v in zip(range(-12, 0), [-0.3, -0.2, 0.0, 0.2, 0.4, 0.6, 0.9, 1.3, 1.7, 2.0, 2.1, 2.2]):
        oni[k]["v"] = v

    # chuva diária dos últimos 120 dias (os últimos 25 "preliminares")
    dd = np.arange(np.datetime64(hoje) - 120, np.datetime64(hoje) - 2)
    mesd = dd.astype("datetime64[M]").astype(int) % 12
    taxa = np.array([230, 200, 160, 90, 45, 15, 8, 15, 50, 110, 170, 220.0])[mesd] / 30
    chuva = rng.gamma(0.5, 2 * taxa[:, None, None] * 0.6, size=(len(dd), G05["ny"], G05["nx"])).astype("float32")
    chuva_diaria = (chuva, dd, str(dd[-25]))
    gerar_saida(P, anos_p, meses_p, tmax, tmin, datas, m05, m10, geo, prev, rio, (oni, 'RONI'), chuva_diaria=chuva_diaria, demo=True,
                  fontes={"chuva": "dados simulados", "regioes": "Limites esquemáticos, apenas para demonstração."})
