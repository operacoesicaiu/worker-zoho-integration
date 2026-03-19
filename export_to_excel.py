import os
import requests
import json
import pandas as pd
import sys
from datetime import datetime

# Removemos qualquer menção a load_config() que leia arquivos
def get_env_config():
    """Lê as configurações EXCLUSIVAMENTE das variáveis de ambiente do GitHub"""
    return {
        "client_id": os.getenv('ZOHO_CLIENT_ID'),
        "client_secret": os.getenv('ZOHO_CLIENT_SECRET'),
        "refresh_token": os.getenv('ZOHO_REFRESH_TOKEN'),
        "account_owner": os.getenv('ZOHO_ACCOUNT_OWNER'),
        "app_link_name": os.getenv('ZOHO_APP_LINK_NAME'),
        "report_link_name": os.getenv('ZOHO_REPORT_LINK_NAME'),
        "base_url": "https://www.zohoapis.com",
        "auth_url": "https://accounts.zoho.com"
    }

def get_access_token(config):
    """Gera o token de acesso temporário usando o Refresh Token fixo"""
    payload = {
        'refresh_token': config['refresh_token'],
        'client_id': config['client_id'],
        'client_secret': config['client_secret'],
        'grant_type': 'refresh_token'
    }
    response = requests.post(f"{config['auth_url']}/oauth/v2/token", params=payload)
    return response.json().get('access_token')

def run():
    config = get_env_config()
    
    # Validação: se faltar qualquer chave, o script para por segurança
    if not all(config.values()):
        print("Erro: Chaves de configuração ausentes no ambiente.")
        sys.exit(1)

    token = get_access_token(config)
    if not token:
        print("Erro ao gerar Access Token. Verifique as credenciais.")
        sys.exit(1)

    # --- RESTO DA SUA LÓGICA DE BUSCA E EXCEL AQUI ---
    print(f"Processando relatório: {config['report_link_name']}")

if __name__ == "__main__":
    run()
