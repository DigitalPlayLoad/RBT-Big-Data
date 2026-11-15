"""
Script de Auditoria e Reconciliação de Dados (Data Integrity & Reconciliation)
Compara a planilha original 'Base Big Data - Registro Brasileiro de Transplantes (RBT ABTO 2015-2025).xlsx'
com os arquivos extraídos utilizados no Dashboard ('rbt_dashboard_data.json', 'rbt_painel_uf_consolidado.csv' e 'data_store.js').
"""

import sys
import json
import csv
from datetime import datetime
import openpyxl

# Garantir saída UTF-8 no terminal Windows
if sys.platform == 'win32' and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

EXCEL_FILE = "Base Big Data - Registro Brasileiro de Transplantes (RBT ABTO 2015-2025).xlsx"
JSON_FILE = "rbt_dashboard_data.json"
CSV_FILE = "rbt_painel_uf_consolidado.csv"
DATASTORE_FILE = "data_store.js"

def parse_num(val):
    if val is None or val == '':
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, datetime):
        return 0.0
    try:
        return float(str(val).replace(',', '.').strip())
    except Exception:
        return 0.0

def run_audit():
    print("=" * 70)
    print("📊 INICIANDO AUDITORIA E RECONCILIAÇÃO DE DADOS (RBT BIG DATA)")
    print("=" * 70)
    
    # 1. Carregar Planilha Excel Fonte
    print(f"\n[1/5] Carregando fonte primária: {EXCEL_FILE}...")
    try:
        wb = openpyxl.load_workbook(EXCEL_FILE, data_only=True)
    except Exception as e:
        print(f"❌ Erro ao abrir a planilha Excel: {e}")
        return False

    s1 = wb['Painel_UF_2015_2019']
    s2 = wb['Painel_UF_2020_2025']
    rows1 = list(s1.iter_rows(values_only=True))
    rows2 = list(s2.iter_rows(values_only=True))
    head_excel = [c for c in rows1[0] if c is not None]
    col_idx = {name: i for i, name in enumerate(head_excel)}
    
    raw_uf_rows = [r for r in (rows1[1:] + rows2[1:]) if r[0] is not None and r[col_idx['UF_Sigla']] is not None]
    print(f"  ✓ Total de registros na planilha (abas UF): {len(raw_uf_rows)} linhas")

    # 2. Carregar JSON do Dashboard
    print(f"\n[2/5] Carregando JSON do Dashboard: {JSON_FILE}...")
    try:
        with open(JSON_FILE, 'r', encoding='utf-8') as f:
            json_data = json.load(f)
    except Exception as e:
        print(f"❌ Erro ao abrir JSON: {e}")
        return False
    
    extracted_uf = json_data.get('painel_uf', [])
    print(f"  ✓ Total de registros no JSON: {len(extracted_uf)} linhas")

    # 3. Carregar CSV Consolidado
    print(f"\n[3/5] Carregando CSV consolidado: {CSV_FILE}...")
    csv_rows = []
    try:
        with open(CSV_FILE, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            csv_rows = list(reader)
        print(f"  ✓ Total de registros no CSV: {len(csv_rows)} linhas")
    except Exception as e:
        print(f"❌ Erro ao abrir CSV: {e}")
        return False

    # 4. Validar data_store.js
    print(f"\n[4/5] Validando integridade do bundle do frontend: {DATASTORE_FILE}...")
    try:
        with open(DATASTORE_FILE, 'r', encoding='utf-8') as f:
            ds_content = f.read()
        if 'window.RBT_DATA' in ds_content and 'window.BRAZIL_GEOJSON' in ds_content:
            print("  ✓ data_store.js contém window.RBT_DATA e window.BRAZIL_GEOJSON.")
        else:
            print("  ❌ data_store.js está incompleto ou corrompido.")
            return False
    except Exception as e:
        print(f"❌ Erro ao ler data_store.js: {e}")
        return False

    # 5. Batimento de Integridade Detalhado (Registro a Registro)
    print("\n[5/5] Executando batimento campo a campo...")

    json_dict = {(int(r['Ano']), str(r['UF_Sigla']).strip()): r for r in extracted_uf}
    csv_dict = {(int(r['Ano']), str(r['UF_Sigla']).strip()): r for r in csv_rows}

    # Mapeamento: Coluna na Planilha Excel -> Chave no JSON / CSV
    campos_validacao = {
        'Populacao_IBGE': 'Populacao_IBGE',
        'Notificacoes_N': 'Notificacoes_N',
        'Doadores_Efetivos_N': 'Doadores_Efetivos_N',
        'Doadores_Elegiveis_N': 'Doadores_Elegiveis_N',
        'Nao_Doadores_N': 'Nao_Doadores_N',
        'Entrevistas_Realizadas_N': 'Entrevistas_Realizadas_N',
        'Recusa_Familiar_N': 'Recusa_Familiar_N',
        'Contraindicacao_Medica_N': 'Contraindicacao_Medica_N',
        'Parada_Cardiaca_N': 'Parada_Cardiaca_N',
        'ME_Nao_Confirmada_N': 'ME_Nao_Confirmada_N',
        'Doador_Masc': 'Doador_Masc',
        'Doador_Fem': 'Doador_Fem',
        'Causa_TCE': 'Causa_TCE',
        'Causa_AVC': 'Causa_AVC',
        'Tx_Cornea': 'Tx_Cornea_N',
        'Tx_Rim_Total': 'Tx_Rim_Total_N',
        'Tx_Rim_Vivo': 'Tx_Rim_Vivo_N',
        'Tx_Rim_Falecido': 'Tx_Rim_Falecido_N',
        'Tx_Figado': 'Tx_Figado_N',
        'Tx_Coracao': 'Tx_Coracao_N',
        'Tx_Pulmao': 'Tx_Pulmao_N',
        'Tx_Pancreas': 'Tx_Pancreas_N',
        'Lista_Ativos_Rim': 'Lista_Ativos_Rim',
        'Lista_Ativos_Figado': 'Lista_Ativos_Figado',
        'Lista_Ativos_Coracao': 'Lista_Ativos_Coracao',
        'Lista_Ativos_Pulmao': 'Lista_Ativos_Pulmao',
        'Lista_Ativos_Cornea': 'Lista_Ativos_Cornea',
        'Lista_Ativos_Total_Geral': 'Lista_Ativos_Total_Geral',
        'Lista_Mortalidade_Anual_Total': 'Lista_Mortalidade_Anual_Total'
    }

    totais_excel = {k: 0.0 for k in campos_validacao}
    totais_json = {k: 0.0 for k in campos_validacao}
    totais_csv = {k: 0.0 for k in campos_validacao}

    divergencias_detalhadas = []
    total_comparacoes = 0
    total_sucesso = 0

    for r in raw_uf_rows:
        ano = int(parse_num(r[col_idx['Ano']]))
        uf = str(r[col_idx['UF_Sigla']]).strip()
        key = (ano, uf)

        if key not in json_dict:
            divergencias_detalhadas.append(f"Registro ({ano}, {uf}) não encontrado no JSON")
            continue
        if key not in csv_dict:
            divergencias_detalhadas.append(f"Registro ({ano}, {uf}) não encontrado no CSV")
            continue

        rec_json = json_dict[key]
        rec_csv = csv_dict[key]

        for col_ex, col_js in campos_validacao.items():
            val_ex = parse_num(r[col_idx[col_ex]])
            val_js = parse_num(rec_json.get(col_js, 0))
            val_csv = parse_num(rec_csv.get(col_js, 0))

            totais_excel[col_ex] += val_ex
            totais_json[col_ex] += val_js
            totais_csv[col_ex] += val_csv

            total_comparacoes += 2  # Excel vs JSON e Excel vs CSV

            # Comparação Excel vs JSON
            if abs(val_ex - val_js) > 0.001:
                divergencias_detalhadas.append(
                    f"[{ano} - {uf}] {col_ex}: Excel={val_ex} != JSON({col_js})={val_js}"
                )
            else:
                total_sucesso += 1

            # Comparação Excel vs CSV
            if abs(val_ex - val_csv) > 0.001:
                divergencias_detalhadas.append(
                    f"[{ano} - {uf}] {col_ex}: Excel={val_ex} != CSV({col_js})={val_csv}"
                )
            else:
                total_sucesso += 1

    # 6. Exibir Tabela de Totais de Controle (Checksums)
    print("\n" + "=" * 70)
    print("📈 TOTAIS DE CONTROLE CONSOLIDADOS (EXCEL vs JSON vs CSV):")
    print("=" * 70)
    print(f"{'Métrica':<30} | {'Planilha Excel':<14} | {'JSON Dashboard':<14} | {'Status':<8}")
    print("-" * 70)

    indicadores_chave = [
        ('Notificações Totais', 'Notificacoes_N'),
        ('Doadores Efetivos', 'Doadores_Efetivos_N'),
        ('Recusa Familiar', 'Recusa_Familiar_N'),
        ('Transplantes Córnea', 'Tx_Cornea'),
        ('Transplantes Rim Total', 'Tx_Rim_Total'),
        ('Transplantes Fígado', 'Tx_Figado'),
        ('Transplantes Coração', 'Tx_Coracao'),
        ('Transplantes Pulmão', 'Tx_Pulmao'),
        ('Transplantes Pâncreas', 'Tx_Pancreas'),
        ('Fila Ativa Rim', 'Lista_Ativos_Rim'),
        ('Fila Ativa Geral', 'Lista_Ativos_Total_Geral')
    ]

    todos_checksums_iguais = True
    for rotulo, campo in indicadores_chave:
        tot_ex = totais_excel[campo]
        tot_js = totais_json[campo]
        status = "✅ 100%" if abs(tot_ex - tot_js) < 0.001 else "❌ DIVERGENTE"
        if status != "✅ 100%":
            todos_checksums_iguais = False
        print(f"{rotulo:<30} | {tot_ex:>14,.0f} | {tot_js:>14,.0f} | {status:<8}")

    print("=" * 70)
    print(f"Total de checagens individuais realizadas: {total_comparacoes:,}")
    print(f"Checagens com 100% de exatidão: {total_sucesso:,}")
    print(f"Total de divergências encontradas: {len(divergencias_detalhadas)}")

    if len(divergencias_detalhadas) == 0 and todos_checksums_iguais:
        print("\n🎉 RESULTADO: AUDITORIA APROVADA COM SUCESSO!")
        print("Todos os dados do aplicativo batem perfeitamente (100%) com a planilha original.")
        return True
    else:
        print("\n⚠️ RESULTADO: AUDITORIA APONTOU DISCREPÂNCIAS:")
        for div in divergencias_detalhadas[:15]:
            print("  -", div)
        if len(divergencias_detalhadas) > 15:
            print(f"  ... e mais {len(divergencias_detalhadas) - 15} divergências.")
        return False

if __name__ == '__main__':
    sucesso = run_audit()
    sys.exit(0 if sucesso else 1)
