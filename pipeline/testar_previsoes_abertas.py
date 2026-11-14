"""
Procura o SEAS5 (previsão sazonal do ECMWF) no "open data", espelho público da Amazon.
Uso (terminal do VS Code, ambiente "dados" ativo, pasta pipeline):
    python testar_previsoes_abertas.py
Só lista nomes de pastas e arquivos (não baixa nada grande). Mande a saída inteira para o Claude.
"""
import re
import requests

S3 = "https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/"


def pastas(prefixo):
    """Subpastas logo abaixo de 'prefixo' (a Amazon devolve no máximo 1000 por vez; aqui são poucas)."""
    r = requests.get(S3, params={"list-type": "2", "prefix": prefixo, "delimiter": "/"}, timeout=60)
    return re.findall(r"<Prefix>([^<]+/)</Prefix>", r.text)[1:] if "<CommonPrefixes>" in r.text else []


def arquivos(prefixo, limite=30):
    r = requests.get(S3, params={"list-type": "2", "prefix": prefixo, "max-keys": str(limite)}, timeout=60)
    return re.findall(r"<Key>([^<]+)</Key>", r.text)


for data in ("20261105", "20261006", "20260105", "20261102"):
    print(f"\n=== rodada {data} ===")
    for hora in pastas(f"{data}/"):                          # ex.: 20261101/00z/
        for modelo in pastas(hora):                          # ex.: .../ifs/  .../aifs-single/
            for resol in pastas(modelo):                     # ex.: .../0p25/  .../1p0/
                streams = [p.rstrip("/").split("/")[-1] for p in pastas(resol)]
                print(f"  {resol}  ->  {', '.join(streams)}")
                for s in streams:
                    if s in ("mmsf", "msmm", "mmsa", "seas", "seasonal"):
                        for a in arquivos(f"{resol}{s}/"):
                            print("       ", a)
