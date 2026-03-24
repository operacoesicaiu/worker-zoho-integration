const axios = require('axios');

function secureLog(message, isError = false) {
    const timestamp = new Date().toISOString();
    const level = isError ? 'ERROR' : 'INFO';
    console.log(`[${timestamp}] [${level}] ${message}`);
}

function processField(record, fieldName) {
    let rawValue = record[fieldName];

    // Correção Coluna F: Combina Data de Início com Hora de Fim
    if (fieldName === 'Data_e_hora_de_fim_do_servi_o') {
        const dataInicio = record['Data_e_hora_de_in_cio_do_servi_o'] || '';
        if (dataInicio && rawValue && typeof rawValue === 'string' && rawValue.includes(':')) {
            const dataApenas = dataInicio.split(' ')[0]; 
            const horaApenas = rawValue.split(':').slice(0, 2).join(':');
            return `${dataApenas} ${horaApenas}`;
        }
    }

    if (rawValue === null || rawValue === undefined || rawValue === '') return '';

    // Limpeza de Telefone (conforme seu Python)
    if (fieldName.includes('Telefone_de_contato') && typeof rawValue === 'string') {
        return rawValue.startsWith('+') ? rawValue.substring(1) : rawValue;
    }

    // Tratamento de Objetos/Lookups (evita [object Object])
    if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        return rawValue.display_value || rawValue.ID || String(rawValue);
    }

    // Tratamento de Arrays (Multi-select)
    if (Array.isArray(rawValue)) {
        return rawValue.map(v => (typeof v === 'object' ? v.display_value || v : v)).join(', ');
    }

    return String(rawValue);
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
            timeout: 20000
        });
        const zohoToken = authRes.data.access_token;

        // Datas
        const date = new Date();
        date.setDate(date.getDate() - 1);
        const yesterday = date.toISOString().split('T')[0];
        
        // Formato para o critério do Zoho v2 (DD-Mon-YYYY)
        const meses = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const zDate = `${String(date.getDate()).padStart(2, '0')}-${meses[date.getMonth()]}-${date.getFullYear()}`;

        const criteria = `(Data_e_hora_de_inicio_do_formulario >= "${zDate} 00:00:00" && Data_e_hora_de_inicio_do_formulario <= "${zDate} 23:59:59")`;
        const baseUrl = `https://creator.zoho.com/api/v2/${process.env.ZOHO_ACCOUNT_OWNER}/${process.env.ZOHO_APP_NAME}/report/${process.env.ZOHO_REPORT_NAME}`;
        
        // Parse seguro do mapeamento
        const rawMapping = JSON.parse(process.env.REPORT_COLUMN_MAPPING);
        const columns = Array.isArray(rawMapping) ? rawMapping : Object.values(rawMapping);

        let allRecords = [];
        let page = 1;
        const limit = 200;

        secureLog(`Buscando registros de: ${zDate}`);

        while (true) {
            const fromIndex = (page - 1) * limit + 1;
            const resp = await axios.get(baseUrl, {
                params: { from: fromIndex, limit: limit, criteria: criteria },
                headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` },
                timeout: 45000
            });

            const records = resp.data.data || [];
            if (records.length === 0) break;
            allRecords = allRecords.concat(records);
            if (records.length < limit) break;
            page++;
        }

        if (allRecords.length > 0) {
            secureLog(`Processando ${allRecords.length} registros...`);
            const allProcessed = allRecords.map(rec => columns.map(f => processField(rec, f)));
            
            const urlSheets = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.REPORT_SPREADSHEET_ID}/values/${process.env.REPORT_SHEET_NAME}!A:append?valueInputOption=USER_ENTERED`;

            await axios.post(urlSheets, { values: allProcessed }, {
                headers: { 'Authorization': `Bearer ${process.env.GOOGLE_TOKEN}` },
                timeout: 60000
            });
            secureLog("Sincronização concluída com sucesso.");
        } else {
            secureLog("Nenhum dado encontrado.");
        }

    } catch (e) {
        secureLog("Falha na execução. Verifique as permissões do Google Token ou o mapeamento de colunas.", true);
        process.exit(1);
    }
}
run();
