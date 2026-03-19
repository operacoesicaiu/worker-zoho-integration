import os
import requests
import pandas as pd
import sys
import time
from datetime import datetime, timedelta

def get_env_config():
    """Configurações via Secrets do GitHub"""
    return {
        "client_id": os.getenv('ZOHO_CLIENT_ID'),
        "client_secret": os.getenv('ZOHO_CLIENT_SECRET'),
        "refresh_token": os.getenv('ZOHO_REFRESH_TOKEN'),
        "account_owner": os.getenv('ZOHO_ACCOUNT_OWNER'),
        "app_link_name": os.getenv('ZOHO_APP_LINK_NAME'),
        "report_link_name": os.getenv('ZOHO_REPORT_LINK_NAME'),
        "spreadsheet_id": os.getenv('SPREADSHEET_ID'), # ID da planilha enviado via Secret
        "google_token": os.getenv('GOOGLE_TOKEN')     # Recebido do Worker do Google
    }

def calculate_date_criteria():
    """Define o filtro: Tudo antes de 19/03/2026 ou apenas ontem"""
    hoje = datetime(2026, 3, 19).date() # Data de referência solicitada
    agora = datetime.now().date()
    
    if agora <= hoje:
        # Pega tudo estritamente antes de 19/03/2026
        return f"Data_e_hora_de_inicio_do_formul_rio < '19-Mar-2026'"
    else:
        # A partir de amanhã, pega apenas o dia anterior
        ontem = (datetime.now() - timedelta(days=1)).strftime('%d-%b-%Y')
        return f"Data_e_hora_de_inicio_do_formul_rio == '{ontem}'"

def send_to_sheets(df, config):
    """Envia dados para o Google Sheets respeitando limites de API"""
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{config['spreadsheet_id']}/values/ERP_iCaiu!A1:append"
    headers = {"Authorization": f"Bearer {config['google_token']}", "Content-Type": "application/json"}
    
    # Converte DataFrame para lista de listas (formato Sheets)
    values = [df.columns.tolist()] + df.values.tolist() if df.index.empty else df.values.tolist()
    
    # Lógica de Chunking para evitar estouro de limite (batches de 500 linhas)
    for i in range(0, len(values), 500):
        batch = values[i:i+500]
        body = {"values": batch}
        res = requests.post(f"{url}?valueInputOption=USER_ENTERED", headers=headers, json=body)
        if res.status_code != 200:
            print(f"Erro no envio: {res.text}")
        time.sleep(1) # Pausa de 1s entre batches para respeitar o quota

def run():
    config = get_env_config()
    if not config['google_token']:
        sys.exit("Erro: Google Token ausente")

    # 1. Gera Access Token Zoho
    auth_res = requests.post("https://accounts.zoho.com/oauth/v2/token", params={
        'refresh_token': config['refresh_token'],
        'client_id': config['client_id'],
        'client_secret': config['client_secret'],
        'grant_type': 'refresh_token'
    }).json()
    
    zoho_token = auth_res.get('access_token')
    
    # 2. Busca dados no Zoho
    criteria = calculate_date_criteria()
    url = f"https://creator.zoho.com/api/v2/{config['account_owner']}/{config['app_link_name']}/report/{config['report_link_name']}"
    headers = {'Authorization': f'Zoho-oauthtoken {zoho_token}'}
    
    response = requests.get(url, headers=headers, params={'criteria': criteria})
    
    if response.status_code == 200:
        data = response.json().get('data', [])
        if data:
            df = pd.DataFrame(data)
            # Aqui você mantém a lógica de limpeza de campos do seu script original
            send_to_sheets(df, config)
            print(f"Sucesso: {len(data)} registros enviados.")
        else:
            print("Nenhum dado novo para enviar.")

if __name__ == "__main__":
    run()
