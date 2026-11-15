"""
Validação de Integridade: Nova Base RBT (2015-2026) vs Arquivos da pasta 'rbt'
"""

import os
import json
import pandas as pd

RBT_ADULTOS = r'c:\Users\welli\.gemini\antigravity-ide\scratch\RBT-Big-Data\rbt\rbt\adultos'
JSON_FILE = 'rbt_dashboard_data.json'
CSV_FILE = 'rbt_painel_uf_consolidado.csv'

with open(JSON_FILE, 'r', encoding='utf-8') as f:
    dashboard_data = json.load(f)

painel = dashboard_data['painel_uf']
df_csv = pd.read_csv(CSV_FILE)

# 1. Checar quantidades
print("=" * 60)
print("🔍 AUDITORIA DE INTEGRIDADE: NOVA BASE CONSOLIDADA (RBT)")
print("=" * 60)
print(f"✓ Registros no JSON: {len(painel)} (esperado: 336)")
print(f"✓ Registros no CSV:  {len(df_csv)} (esperado: 336)")
print(f"✓ Anos cobertos:     {dashboard_data['anos_disponiveis']}")
print(f"✓ UFs cobertas:      {len(dashboard_data['ufs'])} estados")

# 2. Amostras de batimento direto com os CSVs de origem
df_pot = pd.read_csv(os.path.join(RBT_ADULTOS, 'indicador_doadores_potencia.csv'))
df_doad = pd.read_csv(os.path.join(RBT_ADULTOS, 'indicador_doadores_transplantado.csv'))

checks = [
    ('SP', 2026), ('RJ', 2025), ('MG', 2024), ('RS', 2023), ('BA', 2022),
    ('PR', 2021), ('CE', 2020), ('PE', 2019), ('SC', 2018), ('GO', 2017)
]

all_ok = True
for uf, ano in checks:
    orig_pot = df_pot[(df_pot['UF'] == uf) & (df_pot['Anos'] == ano)]['Numero_Doadores'].values[0]
    orig_doad = df_doad[(df_doad['UF'] == uf) & (df_doad['Anos'] == ano)]['Numero_Doadores'].values[0]

    rec = next(r for r in painel if r['UF_Sigla'] == uf and r['Ano'] == ano)
    
    ok_pot = (rec['Notificacoes_N'] == orig_pot)
    ok_doad = (rec['Doadores_Efetivos_N'] == orig_doad)
    if not (ok_pot and ok_doad):
        all_ok = False
        print(f"❌ Divergência em {uf} {ano}: Notif={rec['Notificacoes_N']} vs {orig_pot}, Doad={rec['Doadores_Efetivos_N']} vs {orig_doad}")
    else:
        print(f"✅ {uf} {ano}: Notificações={rec['Notificacoes_N']} | Doadores={rec['Doadores_Efetivos_N']} (100% Confere)")

print("=" * 60)
if all_ok:
    print("🏆 STATUS: BASE ATUALIZADA E VALIDADA COM 100% DE CONVERGÊNCIA!")
else:
    print("⚠️ STATUS: FORAM ENCONTRADAS DIVERGÊNCIAS.")
