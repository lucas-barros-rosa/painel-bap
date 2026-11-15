"""
Configuração do Painel Hidroclimático da BAP.
Tudo o que você pode querer ajustar fica neste arquivo; os outros só leem daqui.
"""
from pathlib import Path

# ----------------------------------------------------------------------------- pastas
AQUI = Path(__file__).resolve().parent
CACHE = AQUI / "cache"                 # downloads guardados entre execuções (não vai para o GitHub)
ENTRADA = AQUI / "entrada"             # arquivos fornecidos por você (limite da BAP, CSVs de nível)
SAIDA = AQUI.parent / "site" / "dados" # o que o site lê

# ----------------------------------------------------------------------------- período e grade
ANO_INICIAL = 1990                     # 1 ano antes da normal 1991-2020, para o SPI/SPEI-12
MESES_MAPAS = 24                       # quantos meses recentes ganham mapa no site
LON0, LAT0 = -60.05, -13.55            # canto noroeste da grade (alinhado às grades do CHIRPS e do ERA5-Land)
LARG, ALT = 7.3, 9.1                   # largura e altura da grade, em graus

# ----------------------------------------------------------------------------- limites
# A BAP vem do seu arquivo entrada/bap.geojson. Para trocar o limite do Pantanal (padrão: bioma do IBGE),
# coloque entrada/pantanal.geojson (ou .shp/.gpkg).
URL_ESTADO = ("https://servicodados.ibge.gov.br/api/v3/malhas/estados/{cod}"
              "?formato=application/vnd.geo+json&qualidade=intermediaria")
URL_BIOMAS = "https://geoftp.ibge.gov.br/informacoes_ambientais/estudos_ambientais/biomas/vetores/Biomas_250mil.zip"
AREA_BAP_ESPERADA_KM2 = (320_000, 400_000)   # só para conferir (BAP no Brasil ~ 362 mil km²)

REGIOES = [
    {"id": "bap", "nome": "Bacia do Alto Paraguai (toda)", "curto": "Bacia toda", "cod": None},
    {"id": "pln", "nome": "Planalto MT", "curto": "Planalto MT", "cod": 1},
    {"id": "ptn", "nome": "Pantanal MT", "curto": "Pantanal MT", "cod": 2},
    {"id": "pls", "nome": "Planalto MS", "curto": "Planalto MS", "cod": 3},
    {"id": "pts", "nome": "Pantanal MS", "curto": "Pantanal MS", "cod": 4},
]

# ----------------------------------------------------------------------------- chuva: CHIRPS v3 (Climate Hazards Center)
CHIRPS = "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/"
CHIRPS_MENSAL = CHIRPS + "monthly/global/tifs/chirps-v3.0.{a}.{m:02d}.tif"
CHIRPS_DIARIO_FINAL = CHIRPS + "daily/final/rnl/"     # diário final (desagregado com ERA5)
CHIRPS_DIARIO_PRELIM = CHIRPS + "daily/prelim/sat/"   # diário preliminar (desagregado com IMERG)

# ----------------------------------------------------------------------------- temperatura: ERA5-Land (ECMWF)
# Histórico: ERA5-Land horário no "ARCO Data Lake" do ECMWF (Zarr lido direto, sem a fila do CDS; mesma chave).
ERA5L_ARCO = ("https://arco.datastores.ecmwf.int/cadl-arco-geo-007/arco/reanalysis_era5_land/"
              "sfc-2m-temperature/geoChunked.zarr")
FUSO_HORAS = -4                        # dia local de MT/MS (UTC-4) para Tmax e Tmin diárias
FUSO_ERA5 = "utc-04:00"                # o mesmo, no formato do CDS (dias recentes)
ERA5_ATRASO_DIAS = 7                   # o ERA5-Land sai com ~5 dias de atraso; pedimos até hoje - 7
ERA5_CAUDA_MIN_DIAS = 7                # só pede ao CDS se o Zarr estiver mais de tantos dias atrás
ERA5_CAUDA_MESES_MAX = 3               # no máximo tantos meses recentes pedidos ao CDS (se o Zarr atrasar)

# ----------------------------------------------------------------------------- previsão sazonal: C3S
# (centro, sistema, nome). Os números de sistema mudam com o tempo: confira no CDS se um modelo falhar.
C3S_MODELOS = [
    ("ecmwf", "51", "ECMWF SEAS5"),
    ("cmcc", "4", "CMCC SPS4"),             # SPS4 substituiu o SPS3.5 no C3S em ago/2025
]
VERIF_INICIO = (2026, 1)               # primeira emissão usada em "Previsto × observado"
C3S_AREA = [-13, -61, -23, -52]        # N, O, S, L (graus inteiros; grade de 1°)
CDS_ESPERA_FILA_MIN = 10              # se o Copernicus disser "fila cheia", espera estes minutos…
CDS_ESPERAS_FILA = 2                  # …no máximo estas vezes (depois fica para a próxima execução)

# ----------------------------------------------------------------------------- El Niño (NOAA/CPC)
URL_RONI = "https://www.cpc.ncep.noaa.gov/data/indices/RONI.ascii.txt"   # índice oficial desde fev/2026
URL_ONI = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"     # reserva, se o RONI falhar
URL_NINO_SEMANAL = "https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for"  # Niño semanal (OISST, 1991-2020)
EL_NINO_AVISO = "2026-06-11"           # data em que a NOAA emitiu o "El Niño Advisory" (só para exibição)

# ----------------------------------------------------------------------------- rio Paraguai (ANA)
ESTACOES_RIO = [("66825000", "Ladário"), ("66070004", "Cáceres"), ("67100000", "Porto Murtinho")]
RIO_ANO_INICIAL = 1980                 # anos que o site deixa escolher para comparar no gráfico do rio
RIO_ANOS_PADRAO = [2023, 2024]         # além do ano atual e do anterior: El Niño 2023-24 e a seca recorde de 2024

# ----------------------------------------------------------------------------- ano hidrológico
MES_INICIO_ANO_HIDRO = 10              # outubro: ~80% da chuva da BAP cai de out a mar (Thielen et al., 2020)
ANOS_HIDRO_DESTAQUE = [2019, 2023]     # anos hidrológicos 2019/20 e 2023/24 (ano inicial)
