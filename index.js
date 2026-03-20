const axios = require('axios');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Impede Formula Injection no Google Sheets
function sanitize(val) {
    if (typeof val !== 'string') return val;
    const formulaChars = ['=', '+', '-', '@'];
    if (formulaChars.some(char => val.startsWith(char))) {
        return `'${val}`;
    }
    return val;
}

// Processa campos complexos do Zoho (Lookups, Multi-select, etc)
function extractValue(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'object' && !Array.isArray(value)) {
        return sanitize(value.display_value || value.ID || String(value));
    }
    if (Array.isArray(value)) {
        return sanitize(value.map(v => (typeof v === 'object' ? v.display_value || v : v)).join(', '));
    }
    return sanitize(String(value));
}

async function run() {
    const {
        ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN,
        ZOHO_ACCOUNT_OWNER, ZOHO_APP_LINK_NAME, ZOHO_REPORT_LINK_NAME,
        SPREADSHEET_ID, SHEET_NAME, GOOGLE_TOKEN, COLUMN_MAPPING
    } = process.env;

    // Verificação de integridade dos Secrets
    if (!ZOHO_CLIENT_ID || !GOOGLE_TOKEN || !COLUMN_MAPPING) {
        console.error("Erro: Variáveis de ambiente obrigatorias ausentes.");
        process.exit(1);
    }

    const mapping = JSON.parse(COLUMN_MAPPING);
    const gHeaders = { 'Authorization': `Bearer ${GOOGLE_TOKEN}`, 'Content-Type': 'application/json' };

    try {
        // 1. Autenticação Zoho
        console.log("--- ETAPA 1: Autenticação Zoho ---");
        const authRes = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: ZOHO_REFRESH_TOKEN,
                client_id: ZOHO_CLIENT_ID,
                client_secret: ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            },
            timeout: 20000
        });
        const zohoToken = authRes.data.access_token;
        console.log("Autenticação realizada.");

        // 2. Lógica de Carga Total (Gatilho: 20/03/2026)
        const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const isFullLoadDay = (hoje === "20/03/2026");

        if (isFullLoadDay) {
            console.log("AVISO: Data 20/03/2026 detectada. Iniciando CARGA TOTAL da base.");
        } else {
            console.log(`Modo Incremental ativo. Data atual: ${hoje}.`);
        }

        let allProcessed = [];
        let fromIndex = 0;
        const limit = 200;

        // 3. Loop de Captura de Dados
        while (true) {
            const queryUrl = `https://creator.zoho.com/api/v2/${ZOHO_ACCOUNT_OWNER}/${ZOHO_APP_LINK_NAME}/report/${ZOHO_REPORT_LINK_NAME}`;
            const params = { from: fromIndex, limit: limit };

            if (!isFullLoadDay) {
                params.criteria = "Data_e_hora_de_inicio_do_formul_rio < '19-Mar-2026'";
            }

            console.log(`Buscando registros: indice ${fromIndex}...`);
            const resp = await axios.get(queryUrl, {
                params,
                headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` },
                timeout: 45000
            });

            const data = resp.data.data || [];
            if (data.length === 0) break;

            data.forEach(record => {
                const row = Object.values(mapping).map(zohoKey => extractValue(record[zohoKey]));
                allProcessed.push(row);
            });

            fromIndex += limit;
            const maxRows = isFullLoadDay ? 200000 : 50000;
            if (fromIndex > maxRows) {
                console.log("Limite de seguranca do loop atingido.");
                break;
            }
        }

        // 4. Envio para Google Sheets
        if (allProcessed.length > 0) {
            console.log(`Iniciando envio de ${allProcessed.length} linhas para a aba ${SHEET_NAME}.`);
            const urlAppend = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A1:append?valueInputOption=USER_ENTERED`;

            for (let i = 0; i < allProcessed.length; i += 500) {
                const batch = allProcessed.slice(i, i + 500);
                await axios.post(urlAppend, { values: batch }, { headers: gHeaders, timeout: 60000 });
                console.log(`Lote enviado: ${i + batch.length} de ${allProcessed.length}`);
                await sleep(1500);
            }
            console.log("Processo concluido com sucesso.");
        } else {
            console.log("Nenhum dado retornado pela API para processamento.");
        }

    } catch (e) {
        console.error("\n--- FALHA NO PROCESSO ---");
        if (e.response) {
            console.error(`Status: ${e.response.status}`);
            console.error(`Servico: ${e.config.url.includes('zoho') ? 'ZOHO' : 'GOOGLE'}`);
            console.error(`Resposta da API: ${JSON.stringify(e.response.data)}`);
        } else if (e.request) {
            console.error("Erro de Rede ou Timeout. O servidor nao respondeu a tempo.");
            console.error(`URL Alvo: ${e.config.url}`);
        } else {
            console.error(`Erro de Execucao: ${e.message}`);
        }
        process.exit(1);
    }
}

run();
