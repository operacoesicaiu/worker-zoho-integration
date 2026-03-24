const axios = require('axios');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function secureLog(message, isError = false) {
    const timestamp = new Date().toISOString();
    const logLevel = isError ? 'ERROR' : 'INFO';
    console.log(`[${timestamp}] [${logLevel}] ${message}`);
}

function sanitize(val) {
    if (typeof val !== 'string') return val;
    const formulaChars = ['=', '+', '-', '@'];
    if (formulaChars.some(char => val.startsWith(char))) {
        return `'${val}`;
    }
    return val;
}

function processField(record, fieldName) {
    let rawValue = record[fieldName];

    // Correção Coluna F: Combina Data de Início com Hora de Fim (Lógica do Python)
    if (fieldName === 'Data_e_hora_de_fim_do_servi_o') {
        const dataInicio = record['Data_e_hora_de_in_cio_do_servi_o'] || '';
        if (dataInicio && rawValue && typeof rawValue === 'string' && rawValue.includes(':')) {
            const dataApenas = dataInicio.split(' ')[0]; 
            const horaApenas = rawValue.split(':').slice(0, 2).join(':');
            return sanitize(`${dataApenas} ${horaApenas}`);
        }
    }

    if (rawValue === null || rawValue === undefined || rawValue === '') return '';

    // Limpeza de Telefone
    if (fieldName.includes('Telefone_de_contato') && typeof rawValue === 'string') {
        const tel = rawValue.startsWith('+') ? rawValue.substring(1) : rawValue;
        return sanitize(tel);
    }

    // Tratamento de Objetos/Lookups (evita [object Object])
    if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        return sanitize(rawValue.display_value || rawValue.ID || String(rawValue));
    }

    // Tratamento de Arrays (Multi-select)
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
            timeout: 20000
        });
        const zohoToken = authRes.data.access_token;

        // Configurações de Data (Ontem)
        const date = new Date();
        date.setDate(date.getDate() - 1);
        const meses = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const zDate = `${String(date.getDate()).padStart(2, '0')}-${meses[date.getMonth()]}-${date.getFullYear()}`;
        
        const criteria = `(Data_e_hora_de_inicio_do_formulario >= "${zDate} 00:00:00" && Data_e_hora_de_inicio_do_formulario <= "${zDate} 23:59:59")`;
        const baseUrl = `https://creator.zoho.com/api/v2.1/${process.env.ZOHO_ACCOUNT_OWNER}/${process.env.ZOHO_APP_NAME}/report/${process.env.ZOHO_REPORT_NAME}`;
        
        const rawMapping = JSON.parse(process.env.REPORT_COLUMN_MAPPING);
        const columns = Array.isArray(rawMapping) ? rawMapping : Object.values(rawMapping);

        let allRecords = [];
        let page = 1;
        const limit = 200;

        secureLog(`Buscando registros de ontem: ${zDate}`);

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
            
            const sheetId = process.env.REPORT_SPREADSHEET_ID;
            const rawSheetName = process.env.REPORT_SHEET_NAME;
            const sheetName = rawSheetName.includes(' ') ? `'${rawSheetName}'` : rawSheetName;
            
            // Endpoint de Append para adicionar ao final da planilha
            const urlSheets = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetName}!A1:append?valueInputOption=USER_ENTERED`;

            // Envio em lotes de 500 para maior estabilidade
            for (let i = 0; i < allProcessed.length; i += 500) {
                const batch = allProcessed.slice(i, i + 500);
                await axios.post(urlSheets, { values: batch }, {
                    headers: { 'Authorization': `Bearer ${process.env.GOOGLE_TOKEN}` },
                    timeout: 60000
                });
                secureLog(`Lote enviado: ${i + batch.length} de ${allProcessed.length}`);
                if (allProcessed.length > 500) await sleep(1500); 
            }
            secureLog("Sincronização concluída com sucesso.");
        } else {
            secureLog("Nenhum registro encontrado para ontem.");
        }

    } catch (e) {
        const errorMsg = e.response?.data?.error?.message || e.message;
        secureLog(`Falha na execução: ${errorMsg}`, true);
        process.exit(1);
    }
}

run();
