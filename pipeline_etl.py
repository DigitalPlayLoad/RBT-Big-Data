"""
Pipeline de ETL e Engenharia de Dados - Registro Brasileiro de Transplantes (RBT ABTO)
Consolida as séries históricas a partir da pasta 'rbt' (2015 a 2026).
"""

from etl_rbt_nova_base import build_consolidated_dataset

if __name__ == '__main__':
    print("Executando pipeline consolidado oficial a partir da pasta rbt...")
    build_consolidated_dataset()
