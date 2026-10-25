#!/usr/bin/env bash
# Baixa os dados geográficos brutos (IBGE + municípios com lat/lon). Rode uma vez; os arquivos ficam em scripts/geo/raw/.
set -e
cd "$(dirname "$0")/raw"
curl -sL -o municipios.json "https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/json/municipios.json"
curl -sL -o br_ufs.geojson "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=intermediaria&intrarregiao=UF"
curl -sgL -o pop.json "https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/2024/variaveis/9324?localidades=N6[all]"
curl -sL -o br_pais.geojson "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=intermediaria"
curl -sL -o ne_rivers.geojson "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson"
curl -sL -o br_ufs_max.geojson "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=maxima&intrarregiao=UF"
curl -sL -o br_pais_max.geojson "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=maxima"
ls -la
