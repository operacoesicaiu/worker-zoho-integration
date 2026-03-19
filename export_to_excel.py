import os
import requests
import sys
import time
from datetime import datetime, timedelta

def get_env_config():
    return {
        "client_id": os.getenv('ZOHO_CLIENT_ID'),
        "client_secret": os.getenv('ZOHO_CLIENT_SECRET'),
        "refresh_token": os.getenv('ZOHO_REFRESH_TOKEN'),
        "account_owner": os.getenv('ZOHO_ACCOUNT_OWNER'),
        "app_link_name": os.getenv('ZOHO_APP_LINK_NAME'),
        "report_link_name": os.getenv('ZOHO_REPORT_LINK_NAME'),
        "spreadsheet_id": os.getenv('SPREADSHEET_ID'),
        "google_token": os.getenv('GOOGLE_TOKEN')
    }

def calculate_date_criteria():
    hoje_ref = datetime(2026, 3, 19).date()
    agora = datetime.now().date()
    # Se hoje for 19/03/2026 ou antes, pega tudo do passado
    if agora <= hoje_ref:
        return "Data_e_hora_de_inicio_do_formul_rio < '19-Mar-2026'"
    else:
        # A partir de amanhã, pega o dia anterior
        ontem = (datetime.now() - timedelta(days=1)).strftime('%d-%b-%Y')
        return f"Data_e_hora_de_inicio_do_formul_rio == '{ontem}'"

def send_to_sheets(records, config):
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{config['spreadsheet_id']}/values/ERP_iCaiu!A1:append"
    headers = {"Authorization": f"Bearer {config['google_token']}", "Content-Type": "application/json"}
    
    # Converte JSON em Matriz
    rows = [list(r.values()) for r in records]

    # Envio em lotes de 500 (Limite Google)
    for i in range(0, len(rows), 500):
        batch = rows[i:i+500]
        res = requests.post(f"{url}?valueInputOption=USER_ENTERED", 
                            headers=headers, json={"values": batch})
        if res.status_code != 200:
            print(f"Erro Sheets: {res.text}")
        time.sleep(1.5)

def run():
    conf = get_env_config()
    if not conf['google_token']: sys.exit("Token Google Ausente")

    # 1. Token Zoho
    auth_res = requests.post("https://accounts.zoho.com/oauth/v2/token", params={
        'refresh_token': conf['refresh_token'],
        'client_id': conf['client_id'],
        'client_secret': conf['client_secret'],
        'grant_type': 'refresh_token'
    }).json()
    
    # 2. Busca no Zoho
    headers = {'Authorization': f"Zoho-oauthtoken {auth_res.get('access_token')}"}
    criteria = calculate_date_criteria()
    query_url = f"https://creator.zoho.com/api/v2/{conf['account_owner']}/{conf['app_link_name']}/report/{conf['report_link_name']}"
    
    resp = requests.get(query_url, headers=headers, params={'criteria': criteria})
    if resp.status_code == 200:
        data = resp.json().get('data', [])
        if data:
            send_to_sheets(data, conf)
            print(f"Enviado: {len(data)} linhas.")

if __name__ == "__main__":
    run()
