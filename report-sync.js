const axios = require('axios');

// Função de log seguro: Indica progresso sem expor dados
function secureLog(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [INFO] ${message}`);
}

function processField(record, fieldName) {
    let rawValue = record[fieldName];

    if (fieldName === 'Data_e_hora_de_fim_do_servi_o') {
        const dataInicio = record['Data_e_hora_de_in_cio_do_servi_o'] || '';
        if (dataInicio && rawValue && typeof rawValue === 'string' && rawValue.includes(':')) {
            const dataApenas = dataInicio.split(' ')[0]; // Pega apenas YYYY-MM-DD
            const horaApenas = rawValue.split(':').slice(0, 2).join(':'); // Pega HH:mm
            return `${dataApenas} ${horaApenas}`;
        }
    }

    if (rawValue === null || rawValue === undefined || rawValue === '') return '';

    // 2. Tratamento para Telefones (Remove o +)
    if (fieldName.includes('Telefone_de_contato') && typeof rawValue === 'string') {
        return rawValue.startsWith('+') ? rawValue.substring(1) : rawValue;
    }

    // 3. Tratamento para Objetos (Lookups/Dropdowns - Colunas I, K, L, N)
    if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        // Prioriza o nome de exibição, depois ID, depois string genérica
        return sanitize(rawValue.display_value || rawValue.ID || String(rawValue));
    }

    // 4. Tratamento para Arrays (Multi-select - Coluna J)
    if (Array.isArray(rawValue)) {
        return sanitize(rawValue.map(v => (typeof v === 'object' ? v.display_value || v : v)).join(', '));
    }

    return sanitize(String(rawValue));
}

async function run() {
    try {
        secureLog("Iniciando autenticação no Zoho...");
        const authRes = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: process.env.ZOHO_REFRESH_TOKEN,
                client_id: process.env.ZOHO_CLIENT_ID,
                client_secret: process.env.ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            },
            timeout: 20000 // Timeout de 20s
        });
        const zohoToken = authRes.data.access_token;

        const owner = process.env.ZOHO_ACCOUNT_OWNER;
        const app = process.env.ZOHO_APP_NAME;
        const report = process.env.ZOHO_REPORT_NAME;
        const baseUrl = `https://creator.zoho.com/api/v2.1/${owner}/${app}/report/${report}`;
        const columns = JSON.parse(process.env.REPORT_COLUMN_MAPPING);

        // Ajuste para pegar apenas o dia anterior (Ontem)
        const date = new Date();
        date.setDate(date.getDate() - 1);
        const yesterday = date.toISOString().split('T')[0]; // Formato YYYY-MM-DD

        // Critério restrito ao dia de ontem
        const criteria = `(Data_e_hora_de_inicio_do_formulario >= '${yesterday} 00:00:00' && Data_e_hora_de_inicio_do_formulario <= '${yesterday} 23:59:59')`;

        let allRecords = [];
        let page = 1;
        const limit = 200;

        secureLog(`Iniciando busca de registros para a data: ${yesterday}`);

        while (true) {
            const fromIndex = (page - 1) * limit + 1;
            secureLog(`Processando página ${page}...`);

            const resp = await axios.get(baseUrl, {
                params: { from: fromIndex, limit: limit, criteria: criteria },
                headers: { 
                    'Authorization': `Zoho-oauthtoken ${zohoToken}`,
                    'Accept': 'application/json' 
                },
                timeout: 45000 // Timeout de 45s por página
            });

            const records = resp.data.data || [];
            if (records.length === 0) break;

            allRecords = allRecords.concat(records);
            if (records.length < limit) break;
            page++;
        }

        if (allRecords.length > 0) {
            secureLog(`Total de ${allRecords.length} registros encontrados. Enviando para o Sheets...`);
            const allProcessed = allRecords.map(rec => columns.map(f => processField(rec, f)));
            
            const sheetId = process.env.REPORT_SPREADSHEET_ID;
            const sheetName = process.env.REPORT_SHEET_NAME;
            const urlSheets = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetName}!A2:append?valueInputOption=USER_ENTERED`;

            await axios.post(
                urlSheets,
                { values: allProcessed },
                { 
                    headers: { 'Authorization': `Bearer ${process.env.GOOGLE_TOKEN}` },
                    timeout: 60000 // Timeout de 60s para o upload
                }
            );
            secureLog("Sincronização concluída com sucesso.");
        } else {
            secureLog("Nenhum registro encontrado para ontem.");
        }

    } catch (e) {
        // Log de erro genérico para não expor tokens ou chaves em caso de falha na requisição
        console.error(`[${new Date().toISOString()}] [ERROR] Falha na execução. Verifique os segredos e a conexão.`);
        process.exit(1);
    }
}
run();
