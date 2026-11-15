#!/usr/bin/env python3
"""
Painel Hidroclimático da Bacia do Alto Paraguai — atualização dos dados.
Autor do painel: Lucas Barros da Rosa (University of British Columbia).

Uso:
    python atualizar_dados.py            # baixa tudo, calcula e grava em ../site/dados
    python atualizar_dados.py --demo     # gera dados SIMULADOS, sem internet, só para ver o site
    python atualizar_dados.py --sem-previsao --sem-rio   # pula etapas

Arquivos do pipeline:
    config.py          tudo o que dá para ajustar (fontes, períodos, regiões)
    fontes.py          downloads (IBGE, CHIRPS, ERA5-Land, C3S, ANA, NOAA)
    processamento.py   cálculos (anomalias, SPI, SPEI, ondas de calor, ano hidrológico, El Niño)
    saida.py           monta e grava os arquivos que o site lê
"""
import argparse, sys
import numpy as np
import config as C
import fontes
import fogo
from comum import TempoEsgotado, log
from saida import gerar_saida, rio_json


def principal():
    ap = argparse.ArgumentParser(description="Atualiza os dados do painel hidroclimático da BAP.")
    ap.add_argument("--demo", action="store_true", help="gera dados simulados (não usa internet)")
    ap.add_argument("--sem-previsao", action="store_true", help="não baixa as previsões sazonais")
    ap.add_argument("--sem-rio", action="store_true", help="não baixa o nível do rio")
    ap.add_argument("--regioes", action="store_true",
                    help="só monta as regiões (BAP x MT/MS x Pantanal) e grava em entrada/; rode no seu computador")
    ap.add_argument("--rio", action="store_true",
                    help="só baixa o nível do rio da ANA e grava CSVs em entrada/; rode no seu computador")
    args = ap.parse_args()
    if args.demo:
        import demo
        return demo.rodar()

    C.CACHE.mkdir(exist_ok=True)
    if args.regioes:
        fontes.regioes(construir=True)
        log("Regiões gravadas em pipeline/entrada/ (regioes.geojson e mascaras.npz). Agora envie para o GitHub.")
        return 0
    if args.rio:
        ok = 0
        for c, n in C.ESTACOES_RIO:
            serie = fontes.ana_serie(c)
            if serie:
                fontes.gravar_nivel_csv(c, serie); ok += 1
                ult = max(serie)
                log(f"   {n}: {len(serie)} dias, último {ult} = {serie[ult]:g} cm")
            else:
                log(f"   {n}: sem dados")
        if not ok:
            log("A ANA não respondeu. Tente de novo mais tarde.")
            return 1
        log("Níveis gravados em pipeline/entrada/nivel_*.csv. Agora envie para o GitHub.")
        return 0
    try:
        geo, m05, m10, desc = fontes.regioes()

        log("Chuva mensal (CHIRPS v3)…")
        P, anos_p, meses_p = fontes.chirps_mensal()
        log("Chuva diária recente (CHIRPS v3, final + preliminar)…")
        try:
            chuva_diaria = fontes.chirps_diario()
        except TempoEsgotado:
            raise
        except Exception as e:                                     # noqa
            log(f"   CHIRPS diário indisponível: {str(e)[:150]}")
            chuva_diaria = None
        if chuva_diaria and chuva_diaria[0] is None:
            chuva_diaria = None

        log("Temperatura diária (ERA5-Land, ECMWF)…")
        tmax, tmin, datas = fontes.temperatura_diaria()

        previsoes = None
        if not args.sem_previsao:
            log("Previsões sazonais (C3S)…")
            try:
                previsoes = fontes.c3s_todas()
            except TempoEsgotado:
                raise
            except Exception as e:                                 # noqa
                log(f"   previsão indisponível: {str(e)[:200]}")
        rio = None
        if not args.sem_rio:
            log("Nível do rio Paraguai (ANA)…")
            rio = rio_json({(c, n): fontes.ana_serie(c) for c, n in C.ESTACOES_RIO})
            if not rio["estacoes"]:
                log("   sem dados de nível; dá para usar CSVs em pipeline/entrada/nivel_<codigo>.csv (data,nivel_cm)")
        log("Índice do El Niño (NOAA/CPC)…")
        enso = fontes.baixar_enso() + (fontes.baixar_nino_semanal(),)
        fogo_d = {}
        for chave_f, nome_f, func in (("focos", "Focos de calor (NASA FIRMS)", fogo.focos),
                                      ("fwi", "Perigo de fogo (FWI, Copernicus CEMS)", fogo.fwi_diario)):
            log(nome_f + "…")
            try:
                fogo_d[chave_f] = func()
            except TempoEsgotado:
                log("   tempo desta execução esgotado; fica para a próxima")
            except Exception as e:                                 # noqa
                log(f"   indisponível nesta execução: {str(e)[:250]}")
    except TempoEsgotado:
        log("Tempo limite desta execução atingido. O que já foi baixado está no cache; "
            "a próxima execução continua de onde parou. O site não foi atualizado desta vez.")
        return 0

    fontes_txt = {"chuva": "CHIRPS v3, 0,05° (Funk et al., 2026)", "regioes": desc}
    gerar_saida(P, anos_p, meses_p, tmax, tmin, datas, m05, m10, geo, previsoes, rio, enso,
                chuva_diaria=chuva_diaria, fontes=fontes_txt, fogo=fogo_d)
    (C.AQUI / ".completo").write_text("ok")                       # sinal para o GitHub publicar o site
    return 0


if __name__ == "__main__":
    sys.exit(principal())
