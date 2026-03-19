import os
import requests
import json
import sys
import time
from datetime import datetime, timedelta

def get_env_config():
    """Carrega as configurações das variáveis de ambiente do GitHub"""
    try:
        mapping_str = os.getenv('COLUMN_MAPPING', '{}')
        return {
            "client_id": os.getenv('ZOHO_CLIENT_ID'),
            "client_secret": os.getenv('ZOHO_CLIENT_SECRET'),
            "refresh_token": os.getenv('ZOHO_REFRESH_TOKEN'),
            "account_owner": os.getenv('ZOHO_ACCOUNT_OWNER'),
            "app_link_name": os.getenv('ZOHO_APP_LINK_NAME'),
            "report_link_name": os.getenv('ZOHO_REPORT_LINK_NAME'),
            "spreadsheet_id": os.getenv('SPREADSHEET_ID'),
            "google_token": os.getenv('GOOGLE_TOKEN'),
            "mapping": json.loads(mapping_str)
        }
    except Exception as e:
        sys.exit(f"Erro ao carregar configurações: {e}")

def extract_value(value):
    """Trata dados do Zoho (converte objetos/listas em texto para o Sheets)"""
    if value is None or value == '':
        return ''
    # Tratamento para campos de Lookup/Seleção do Zoho
    if isinstance(value, dict):
        return value.get('display_value', value.get('ID', ''))
    # Tratamento para listas (multi-select)
    if isinstance(value, list):
        return ', '.join([str(v.get('display_value', v)) if isinstance(v, dict) else str(v) for v in value])
    return str(value)

def calculate_date_criteria():
    """Define o filtro de data: histórico ou dia anterior"""
    hoje_ref = datetime(2026, 3, 19).date()
    agora = datetime.now().date()
    
    if agora <= hoje_ref:
        # Carga inicial: tudo estritamente antes de 19/03/2026
        return "Data_e_hora_de_inicio_do_formul_rio < '19-Mar-2026'"
    else:
        # Rotina diária: captura os dados do dia anterior
        ontem = (datetime.now() - timedelta(days=1)).strftime('%d-%b-%Y')
        return f"Data_e_hora_de_inicio_do_formul_rio == '{ontem}'"

def send_to_sheets(processed_records, config):
    """Envia os dados formatados para o Google Sheets em blocos"""
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{config['spreadsheet_id']}/values/ERP_iCaiu!A1:append"
    headers = {
        "Authorization": f"Bearer {config['google_token']}",
        "Content-Type": "application/json"
    }
    
    # Converte a lista de dicionários numa matriz (lista de listas)
    rows = [list(record.values()) for record in processed_records]

    # Envio em lotes para respeitar limites de quota da API
    for i in range(0, len(rows), 500):
        batch = rows[i:i+500]
        payload = {"values": batch}
        
        res = requests.post(
            f"{url}?valueInputOption=USER_ENTERED", 
            headers=headers, 
            json=payload
        )
        
        if res.status_code != 200:
            print(f"Erro ao enviar lote para o Sheets: {res.text}")
        else:
            print(f"Lote de {len(batch)} linhas enviado com sucesso.")
        
        time.sleep(1.5)

def run():
    conf = get_env_config()
    
    if not conf['google_token']:
        sys.exit("Abortando: Token do Google não encontrado.")

    # 1. Obter Access Token do Zoho
    print("Autenticando no Zoho...")
    auth_url = "https://accounts.zoho.com/oauth/v2/token"
    auth_params = {
        'refresh_token': conf['refresh_token'],
        'client_id': conf['client_id'],
        'client_secret': conf['client_secret'],
        'grant_type': 'refresh_token'
    }
    auth_res = requests.post(auth_url, params=auth_params).json()
    zoho_token = auth_res.get('access_token')

    if not zoho_token:
        sys.exit("Erro ao gerar token do Zoho. Verifique as credenciais nos Secrets.")

    # 2. Requisitar dados ao Zoho Creator
    print("Capturando dados do relatório Zoho...")
    criteria = calculate_date_criteria()
    query_url = f"https://creator.zoho.com/api/v2/{conf['account_owner']}/{conf['app_link_name']}/report/{conf['report_link_name']}"
    
    headers = {'Authorization': f"Zoho-oauthtoken {zoho_token}"}
    params = {'criteria': criteria}
    
    resp = requests.get(query_url, headers=headers, params=params)
    
    if resp.status_code == 200:
        raw_data = resp.json().get('data', [])
        if not raw_data:
            print("Nenhum dado encontrado para o critério atual.")
            return

        # 3. Mapeamento dinâmico baseado no COLUMN_MAPPING
        processed_records = []
        mapping = conf['mapping']

        for record in raw_data:
            row_dict = {}
            # sheet_column: nome na planilha | zoho_key: chave no JSON do Zoho
            for sheet_column, zoho_key in mapping.items():
                row_dict[sheet_column] = extract_value(record.get(zoho_key, ''))
            processed_records.append(row_dict)

        # 4. Upload para Google Sheets
        send_to_sheets(processed_records, conf)
        print(f"Processo finalizado. Total de registos: {len(processed_records)}")
    else:
        print(f"Erro na API do Zoho: {resp.status_code} - {resp.text}")

if __name__ == "__main__":
    run()
