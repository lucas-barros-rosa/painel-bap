"""Pequenas funções usadas por todos os outros arquivos do pipeline."""
import json, os, time
import numpy as np
import config as C

INICIO = time.time()


class TempoEsgotado(Exception):
    """Levantada quando a execução passa do limite de tempo (usado no GitHub Actions)."""


def checar_tempo():
    """No GitHub, cada execução tem limite de horas. Se TEMPO_MAX_MIN estiver definido e tiver passado,
    paramos de baixar; o que já foi baixado fica no cache e a próxima execução continua dali."""
    limite = os.environ.get("TEMPO_MAX_MIN")
    if limite and (time.time() - INICIO) / 60 > float(limite):
        raise TempoEsgotado()


def log(*a):
    print(time.strftime("[%H:%M:%S]"), *a, flush=True)


def tentar(f, vezes=4, espera=20):
    """Executa f(); se der erro, espera e tenta de novo (servidores às vezes falham por instantes)."""
    for i in range(vezes):
        try:
            return f()
        except TempoEsgotado:
            raise
        except Exception as e:                       # noqa
            if i == vezes - 1:
                raise
            log(f"   falhou ({type(e).__name__}: {str(e)[:600]}); nova tentativa em {espera}s")
            time.sleep(espera)


def grade(d):
    nx, ny = int(round(C.LARG / d)), int(round(C.ALT / d))
    lons = C.LON0 + d * (np.arange(nx) + 0.5)
    lats = C.LAT0 - d * (np.arange(ny) + 0.5)
    return {"d": d, "nx": nx, "ny": ny, "lons": lons, "lats": lats, "lon0": C.LON0, "lat0": C.LAT0}


G05, G10 = grade(0.05), grade(0.1)                 # CHIRPS (0,05°) e temperatura (0,1°)


def arred(a, casas=1):
    """Array -> lista para JSON, com null no lugar de NaN."""
    a = np.asarray(a, float)
    r = np.round(a, casas)
    return [None if not np.isfinite(v) else (int(v) if casas == 0 else float(v)) for v in r.ravel()]


def grava(caminho, obj):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def ym(ano, mes):
    return f"{int(ano):04d}-{int(mes):02d}"


def soma_mes(ano, mes, n):
    i = ano * 12 + (mes - 1) + n
    return i // 12, i % 12 + 1
