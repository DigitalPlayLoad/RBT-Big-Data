"""
Pipeline de ETL e Engenharia de Dados - Registro Brasileiro de Transplantes (RBT ABTO)
Consolida séries históricas de 2015 a 2025, corrige inconsistências de formatação do Excel
e gera saídas otimizadas para Big Data (Parquet, CSV, JSON e GeoJSON).
"""

import gzip
import json
import urllib.request
from datetime import datetime
import openpyxl
import polars as pl

IBGE_CODE_TO_UF = {
    '11': ('RO', 'Rondônia', 'Norte'),
    '12': ('AC', 'Acre', 'Norte'),
    '13': ('AM', 'Amazonas', 'Norte'),
    '14': ('RR', 'Roraima', 'Norte'),
    '15': ('PA', 'Pará', 'Norte'),
    '16': ('AP', 'Amapá', 'Norte'),
    '17': ('TO', 'Tocantins', 'Norte'),
    '21': ('MA', 'Maranhão', 'Nordeste'),
    '22': ('PI', 'Piauí', 'Nordeste'),
    '23': ('CE', 'Ceará', 'Nordeste'),
    '24': ('RN', 'Rio Grande do Norte', 'Nordeste'),
    '25': ('PB', 'Paraíba', 'Nordeste'),
    '26': ('PE', 'Pernambuco', 'Nordeste'),
    '27': ('AL', 'Alagoas', 'Nordeste'),
    '28': ('SE', 'Sergipe', 'Nordeste'),
    '29': ('BA', 'Bahia', 'Nordeste'),
    '31': ('MG', 'Minas Gerais', 'Sudeste'),
    '32': ('ES', 'Espírito Santo', 'Sudeste'),
    '33': ('RJ', 'Rio de Janeiro', 'Sudeste'),
    '35': ('SP', 'São Paulo', 'Sudeste'),
    '41': ('PR', 'Paraná', 'Sul'),
    '42': ('SC', 'Santa Catarina', 'Sul'),
    '43': ('RS', 'Rio Grande do Sul', 'Sul'),
    '50': ('MS', 'Mato Grosso do Sul', 'Centro-Oeste'),
    '51': ('MT', 'Mato Grosso', 'Centro-Oeste'),
    '52': ('GO', 'Goiás', 'Centro-Oeste'),
    '53': ('DF', 'Distrito Federal', 'Centro-Oeste')
}

UF_TO_IBGE_CODE = {v[0]: k for k, v in IBGE_CODE_TO_UF.items()}

def parse_num(val, default=0.0):
    if val is None or val == '':
        return default
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, datetime):
        # Handle Excel date error where a decimal like 14.1 was parsed as a date
        # E.g. day + month/10 or day
        return default
    try:
        s = str(val).replace(',', '.').strip()
        return float(s)
    except Exception:
        return default

def download_and_enrich_geojson():
    print("Baixando malha geográfica oficial dos estados do IBGE...")
    url = "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=UF"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as resp:
        raw = resp.read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    geo_data = json.loads(raw.decode('utf-8'))
    
    # Enriquecer propriedades de cada estado
    for feat in geo_data['features']:
        cod = str(feat['properties'].get('codarea', ''))
        if cod in IBGE_CODE_TO_UF:
            uf, nome, regiao = IBGE_CODE_TO_UF[cod]
            feat['properties']['UF_Sigla'] = uf
            feat['properties']['UF_Nome'] = nome
            feat['properties']['Regiao'] = regiao
            feat['id'] = uf
            
    with open('brazil_states.geojson', 'w', encoding='utf-8') as f:
        json.dump(geo_data, f, ensure_ascii=False)
    print(f"GeoJSON salvo com sucesso: brazil_states.geojson ({len(geo_data['features'])} estados)")
    return geo_data

def process_rbt_data():
    excel_path = "Base Big Data - Registro Brasileiro de Transplantes (RBT ABTO 2015-2025).xlsx"
    print(f"Lendo planilha: {excel_path}...")
    wb = openpyxl.load_workbook(excel_path, data_only=True)
    
    # 1. Unificar Painel_UF_2015_2019 e Painel_UF_2020_2025
    s1 = wb['Painel_UF_2015_2019']
    s2 = wb['Painel_UF_2020_2025']
    
    rows1 = list(s1.iter_rows(values_only=True))
    rows2 = list(s2.iter_rows(values_only=True))
    
    header = [c for c in rows1[0] if c is not None]
    raw_records = rows1[1:] + rows2[1:]
    
    col_idx = {name: i for i, name in enumerate(header)}
    
    cleaned_rows = []
    for r in raw_records:
        if r[0] is None or r[col_idx['UF_Sigla']] is None:
            continue
        
        ano = int(parse_num(r[col_idx['Ano']]))
        uf_sigla = str(r[col_idx['UF_Sigla']]).strip()
        uf_nome = str(r[col_idx['UF_Nome']]).strip()
        regiao = str(r[col_idx['Regiao']]).strip()
        pop = parse_num(r[col_idx['Populacao_IBGE']])
        
        notif_n = parse_num(r[col_idx['Notificacoes_N']])
        doad_efetivos_n = parse_num(r[col_idx['Doadores_Efetivos_N']])
        doad_elegiveis_n = parse_num(r[col_idx['Doadores_Elegiveis_N']])
        nao_doadores_n = parse_num(r[col_idx['Nao_Doadores_N']])
        doad_orgaos_tx_n = parse_num(r[col_idx['Doadores_Orgaos_Tx_N']])
        doad_multiplos_n = parse_num(r[col_idx['Doadores_Multiplos_N']])
        
        entrevistas_n = parse_num(r[col_idx['Entrevistas_Realizadas_N']])
        recusa_fam_n = parse_num(r[col_idx['Recusa_Familiar_N']])
        
        # Recusa familiar %
        if entrevistas_n > 0:
            recusa_pct = round((recusa_fam_n / entrevistas_n) * 100, 1)
        else:
            recusa_raw = r[col_idx['Recusa_Familiar_Pct']]
            recusa_pct = round(parse_num(recusa_raw) * (100 if parse_num(recusa_raw) < 1.0 else 1.0), 1)
            
        contraind_n = parse_num(r[col_idx['Contraindicacao_Medica_N']])
        parada_card_n = parse_num(r[col_idx['Parada_Cardiaca_N']])
        me_nao_conf_n = parse_num(r[col_idx['ME_Nao_Confirmada_N']])
        outros_motivos_n = parse_num(r[col_idx['Outros_Motivos_N']])
        
        doad_masc = parse_num(r[col_idx['Doador_Masc']])
        doad_fem = parse_num(r[col_idx['Doador_Fem']])
        causa_tce = parse_num(r[col_idx['Causa_TCE']])
        causa_avc = parse_num(r[col_idx['Causa_AVC']])
        
        sangue_a = parse_num(r[col_idx['Sangue_A']])
        sangue_ab = parse_num(r[col_idx['Sangue_AB']])
        sangue_b = parse_num(r[col_idx['Sangue_B']])
        sangue_o = parse_num(r[col_idx['Sangue_O']])
        
        tx_cornea = parse_num(r[col_idx['Tx_Cornea']])
        tx_rim_total = parse_num(r[col_idx['Tx_Rim_Total']])
        tx_rim_vivo = parse_num(r[col_idx['Tx_Rim_Vivo']])
        tx_rim_falecido = parse_num(r[col_idx['Tx_Rim_Falecido']])
        tx_figado = parse_num(r[col_idx['Tx_Figado']])
        tx_pancreas = parse_num(r[col_idx['Tx_Pancreas']])
        tx_coracao = parse_num(r[col_idx['Tx_Coracao']])
        tx_pulmao = parse_num(r[col_idx['Tx_Pulmao']])
        
        tx_orgaos_solidos = tx_rim_total + tx_figado + tx_coracao + tx_pulmao + tx_pancreas
        tx_total_geral = tx_orgaos_solidos + tx_cornea
        
        # PMP (Por Milhão de População) com cálculo exato
        notif_pmp = round((notif_n / pop * 1e6), 2) if pop > 0 else 0.0
        doad_pmp = round((doad_efetivos_n / pop * 1e6), 2) if pop > 0 else 0.0
        tx_cornea_pmp = round((tx_cornea / pop * 1e6), 2) if pop > 0 else 0.0
        tx_rim_pmp = round((tx_rim_total / pop * 1e6), 2) if pop > 0 else 0.0
        tx_figado_pmp = round((tx_figado / pop * 1e6), 2) if pop > 0 else 0.0
        tx_coracao_pmp = round((tx_coracao / pop * 1e6), 2) if pop > 0 else 0.0
        tx_pulmao_pmp = round((tx_pulmao / pop * 1e6), 2) if pop > 0 else 0.0
        tx_orgaos_pmp = round((tx_orgaos_solidos / pop * 1e6), 2) if pop > 0 else 0.0
        tx_total_pmp = round((tx_total_geral / pop * 1e6), 2) if pop > 0 else 0.0
        
        fila_rim = parse_num(r[col_idx['Lista_Ativos_Rim']])
        fila_figado = parse_num(r[col_idx['Lista_Ativos_Figado']])
        fila_coracao = parse_num(r[col_idx['Lista_Ativos_Coracao']])
        fila_pulmao = parse_num(r[col_idx['Lista_Ativos_Pulmao']])
        fila_cornea = parse_num(r[col_idx['Lista_Ativos_Cornea']])
        fila_total_geral = parse_num(r[col_idx['Lista_Ativos_Total_Geral']])
        fila_pediatrico = parse_num(r[col_idx['Lista_Ativos_Total_Pediatrico']])
        
        fila_ingresso_anual = parse_num(r[col_idx['Lista_Ingresso_Anual_Total']])
        fila_mortalidade_anual = parse_num(r[col_idx['Lista_Mortalidade_Anual_Total']])
        
        # Taxa de aproveitamento de elegíveis para efetivos (%)
        taxa_conversao_elegiveis = round((doad_efetivos_n / doad_elegiveis_n * 100), 1) if doad_elegiveis_n > 0 else 0.0
        # Taxa de notificação convertida em doador efetivo (%)
        taxa_conversao_notif = round((doad_efetivos_n / notif_n * 100), 1) if notif_n > 0 else 0.0
        
        cleaned_rows.append({
            'Ano': ano,
            'UF_Sigla': uf_sigla,
            'UF_Nome': uf_nome,
            'Regiao': regiao,
            'Populacao_IBGE': int(pop),
            'Notificacoes_N': int(notif_n),
            'Notificacoes_PMP': notif_pmp,
            'Doadores_Elegiveis_N': int(doad_elegiveis_n),
            'Doadores_Efetivos_N': int(doad_efetivos_n),
            'Doadores_Efetivos_PMP': doad_pmp,
            'Doadores_Orgaos_Tx_N': int(doad_orgaos_tx_n),
            'Doadores_Multiplos_N': int(doad_multiplos_n),
            'Nao_Doadores_N': int(nao_doadores_n),
            'Entrevistas_Realizadas_N': int(entrevistas_n),
            'Recusa_Familiar_N': int(recusa_fam_n),
            'Recusa_Familiar_Pct': recusa_pct,
            'Contraindicacao_Medica_N': int(contraind_n),
            'Parada_Cardiaca_N': int(parada_card_n),
            'ME_Nao_Confirmada_N': int(me_nao_conf_n),
            'Outros_Motivos_N': int(outros_motivos_n),
            'Doador_Masc': int(doad_masc),
            'Doador_Fem': int(doad_fem),
            'Causa_TCE': int(causa_tce),
            'Causa_AVC': int(causa_avc),
            'Sangue_A': int(sangue_a),
            'Sangue_AB': int(sangue_ab),
            'Sangue_B': int(sangue_b),
            'Sangue_O': int(sangue_o),
            'Tx_Cornea_N': int(tx_cornea),
            'Tx_Cornea_PMP': tx_cornea_pmp,
            'Tx_Rim_Total_N': int(tx_rim_total),
            'Tx_Rim_PMP': tx_rim_pmp,
            'Tx_Rim_Vivo_N': int(tx_rim_vivo),
            'Tx_Rim_Falecido_N': int(tx_rim_falecido),
            'Tx_Figado_N': int(tx_figado),
            'Tx_Figado_PMP': tx_figado_pmp,
            'Tx_Pancreas_N': int(tx_pancreas),
            'Tx_Coracao_N': int(tx_coracao),
            'Tx_Coracao_PMP': tx_coracao_pmp,
            'Tx_Pulmao_N': int(tx_pulmao),
            'Tx_Pulmao_PMP': tx_pulmao_pmp,
            'Tx_Orgaos_Solidos_N': int(tx_orgaos_solidos),
            'Tx_Orgaos_Solidos_PMP': tx_orgaos_pmp,
            'Tx_Total_Geral_N': int(tx_total_geral),
            'Tx_Total_Geral_PMP': tx_total_pmp,
            'Lista_Ativos_Rim': int(fila_rim),
            'Lista_Ativos_Figado': int(fila_figado),
            'Lista_Ativos_Coracao': int(fila_coracao),
            'Lista_Ativos_Pulmao': int(fila_pulmao),
            'Lista_Ativos_Cornea': int(fila_cornea),
            'Lista_Ativos_Total_Geral': int(fila_total_geral),
            'Lista_Ativos_Total_Pediatrico': int(fila_pediatrico),
            'Lista_Ingresso_Anual_Total': int(fila_ingresso_anual),
            'Lista_Mortalidade_Anual_Total': int(fila_mortalidade_anual),
            'Taxa_Conversao_Elegiveis_Pct': taxa_conversao_elegiveis,
            'Taxa_Conversao_Notif_Pct': taxa_conversao_notif
        })

    # Criar DataFrame Polars para Big Data
    df = pl.DataFrame(cleaned_rows)
    print(f"Dataset consolidado: {df.height} linhas, {df.width} colunas.")
    
    # Salvar formatos Big Data
    df.write_csv("rbt_painel_uf_consolidado.csv")
    print("Salvo: rbt_painel_uf_consolidado.csv")
    
    df.write_parquet("rbt_painel_uf_consolidado.parquet")
    print("Salvo: rbt_painel_uf_consolidado.parquet")
    
    # Processar Série Nacional 2008-2025
    s_nac = wb['Serie_Nacional_2008_2025']
    rows_nac = list(s_nac.iter_rows(values_only=True))
    head_nac = [c for c in rows_nac[0] if c is not None]
    nac_records = []
    for r in rows_nac[1:]:
        if r[0] is None:
            continue
        rec = {}
        for idx, col in enumerate(head_nac):
            rec[col] = parse_num(r[idx])
        rec['Ano'] = int(rec['Ano'])
        nac_records.append(rec)
        
    # Processar Infraestrutura e Sobrevida
    s_infra = wb['Infraestrutura_e_Sobrevida']
    rows_infra = list(s_infra.iter_rows(values_only=True))
    head_infra = [c for c in rows_infra[1] if c is not None] # Row 1 has headers
    infra_records = []
    for r in rows_infra[2:]:
        if r[0] is None:
            continue
        rec = {}
        for idx, col in enumerate(head_infra):
            rec[col] = parse_num(r[idx])
        rec['Ano'] = int(rec['Ano'])
        infra_records.append(rec)

    # Processar Série Regional 2008-2025
    s_reg = wb['Serie_Regional_2008_2025']
    rows_reg = list(s_reg.iter_rows(values_only=True))
    head_reg = [c for c in rows_reg[0] if c is not None]
    reg_records = []
    for r in rows_reg[1:]:
        if r[0] is None or r[1] is None:
            continue
        rec = {}
        for idx, col in enumerate(head_reg):
            val = r[idx]
            if col in ['Ano']:
                rec[col] = int(parse_num(val))
            elif col in ['Regiao']:
                rec[col] = str(val).strip()
            else:
                rec[col] = parse_num(val)
        reg_records.append(rec)

    # Gerar JSON para o Dashboard Web Interativo
    dashboard_payload = {
        'metadata': {
            'titulo': 'Registro Brasileiro de Transplantes (RBT - ABTO)',
            'periodo_uf': '2015-2025',
            'periodo_nacional': '2008-2025',
            'fonte': 'Associação Brasileira de Transplante de Órgãos (ABTO) & Big Data Analytics',
            'total_registros_uf': len(cleaned_rows),
            'data_processamento': datetime.now().isoformat()
        },
        'anos_disponiveis': sorted(list(set(r['Ano'] for r in cleaned_rows))),
        'ufs': sorted(list(set(r['UF_Sigla'] for r in cleaned_rows if r['UF_Sigla'] != 'BR'))),
        'painel_uf': cleaned_rows,
        'serie_nacional': nac_records,
        'serie_regional': reg_records,
        'infraestrutura': infra_records
    }
    
    with open('rbt_dashboard_data.json', 'w', encoding='utf-8') as f:
        json.dump(dashboard_payload, f, ensure_ascii=False)
    print("Salvo: rbt_dashboard_data.json com estrutura analítica completa!")

if __name__ == '__main__':
    download_and_enrich_geojson()
    process_rbt_data()
    print("ETL concluído com sucesso!")
