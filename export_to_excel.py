import os
import requests
import json
import sys
import time
from datetime import datetime, timedelta

def get_env_config():
    """Carrega absolutamente tudo dos Secrets do GitHub"""
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
            "sheet_name": os.getenv('SHEET_NAME'),
            "google_token": os.getenv('GOOGLE_TOKEN'),
            "mapping": json.loads(mapping_str)
        }
    except Exception as e:
        sys.exit(f"Erro ao carregar configuracoes dos Secrets: {e}")

def extract_value(value):
    if value is None or value == '': return ''
    if isinstance(value, dict): return value.get('display_value', value.get('ID', ''))
    if isinstance(value, list):
        return ', '.join([str(v.get('display_value', v)) if isinstance(v, dict) else str(v) for v in value])
    return str(value)

def send_to_sheets(rows, config):
    """Usa o SHEET_NAME vindo dos secrets para endereçamento"""
    aba = config['sheet_name']
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{config['spreadsheet_id']}/values/{aba}!A1:append"
    headers = {"Authorization": f"Bearer {config['google_token']}", "Content-Type": "application/json"}
    
    for i in range(0, len(rows), 500):
        batch = rows[i:i+500]
        res = requests.post(f"{url}?valueInputOption=USER_ENTERED", headers=headers, json={"values": batch})
        if res.status_code != 200:
            print(f"Erro Sheets ({aba}): {res.text}")
        else:
            print(f"Enviado lote de {len(batch)} linhas para a aba {aba}.")
        time.sleep(2)

def run():
    conf = get_env_config()
    
    # 1. Autenticação Zoho
    auth_res = requests.post("https://accounts.zoho.com/oauth/v2/token", params={
        'refresh_token': conf['refresh_token'],
        'client_id': conf['client_id'],
        'client_secret': conf['client_secret'],
        'grant_type': 'refresh_token'
    }).json()
    zoho_token = auth_res.get('access_token')

    # 2. Paginação para milhares de linhas
    all_processed = []
    from_index = 0
    limit = 200
    
    print(f"Iniciando captura para a planilha: {conf['spreadsheet_id']}")
    
    while True:
        query_url = f"https://creator.zoho.com/api/v2/{conf['account_owner']}/{conf['app_link_name']}/report/{conf['report_link_name']}"
        headers = {'Authorization': f"Zoho-oauthtoken {zoho_token}"}
        
        params = {
            'criteria': "Data_e_hora_de_inicio_do_formul_rio < '19-Mar-2026'",
            'from': from_index,
            'limit': limit
        }
        
        resp = requests.get(query_url, headers=headers, params=params)
        if resp.status_code != 200: break
            
        data = resp.json().get('data', [])
        if not data: break
            
        for record in data:
            # Segue a ordem exata definida no COLUMN_MAPPING do Secret
            row = [extract_value(record.get(zoho_key, '')) for zoho_key in conf['mapping'].values()]
            all_processed.append(row)
            
        from_index += limit

    # 3. Envio final
    if all_processed:
        send_to_sheets(all_processed, conf)
    else:
        print("Nenhum dado encontrado.")

if __name__ == "__main__":
    run()
