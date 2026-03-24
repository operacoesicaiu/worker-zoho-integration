const axios = require('axios');

function sanitize(val) {
    if (typeof val !== 'string') return val;
    const formulaChars = ['=', '+', '-', '@'];
    if (formulaChars.some(char => val.startsWith(char))) return `'${val}`;
    return val;
}

function processField(record, fieldName) {
    let rawValue = record[fieldName];
    if (rawValue === null || rawValue === undefined || rawValue === '') return '';

    if (fieldName.includes('Telefone_de_contato') && typeof rawValue === 'string') {
        if (rawValue.startsWith('+')) return rawValue.substring(1);
    }

    if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        return sanitize(rawValue.display_value || rawValue.ID || String(rawValue));
    }

    if (Array.isArray(rawValue)) {
        return sanitize(rawValue.map(v => (typeof v === 'object' ? v.display_value || v : v)).join(', '));
    }

    return sanitize(String(rawValue));
}

async function run() {
    try {
        // 1. Auth Zoho
        const authRes = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: process.env.ZOHO_REFRESH_TOKEN,
                client_id: process.env.ZOHO_CLIENT_ID,
                client_secret: process.env.ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            }
        });
        const zohoToken = authRes.data.access_token;

        // 2. Configurações
        const owner = process.env.ZOHO_ACCOUNT_OWNER;
        const app = process.env.ZOHO_APP_NAME;
        const report = process.env.ZOHO_REPORT_NAME;
        const baseUrl = `https://creator.zoho.com/api/v2.1/${owner}/${app}/report/${report}`;
        const columns = JSON.parse(process.env.REPORT_COLUMN_MAPPING);

        let allRecords = [];
        let page = 1;
        const limit = 200;

        console.log(`Iniciando busca paginada no Zoho: ${app}`);

        // LOOP DE PAGINAÇÃO
        while (true) {
            const fromIndex = (page - 1) * limit + 1;
            console.log(`Buscando página ${page} (registros a partir de ${fromIndex})...`);

            const resp = await axios.get(baseUrl, {
                params: { from: fromIndex, limit: limit },
                headers: { 
                    'Authorization': `Zoho-oauthtoken ${zohoToken}`,
                    'Accept': 'application/json'
                }
            });

            const records = resp.data.data || [];
            if (records.length === 0) break;

            allRecords = allRecords.concat(records);
            console.log(`  Encontrados ${records.length} registros nesta página.`);

            if (records.length < limit) break; // Se veio menos que 200, é a última página
            page++;
        }

        // 3. Processar e Enviar para Google Sheets
        if (allRecords.length > 0) {
            const allProcessed = allRecords.map(rec => columns.map(f => processField(rec, f)));
            
            console.log(`Total consolidado: ${allProcessed.length} registros. Enviando ao Sheets...`);
            
            const sheetId = process.env.REPORT_SPREADSHEET_ID;
            const sheetName = process.env.REPORT_SHEET_NAME;
            
            // Usamos PUT com o range !A2 para sobrescrever os dados antigos
            const urlSheets = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetName}!A2?valueInputOption=USER_ENTERED`;

            await axios.put(
                urlSheets,
                { values: allProcessed },
                { headers: { 'Authorization': `Bearer ${process.env.GOOGLE_TOKEN}` } }
            );
            console.log("Sincronizacao concluida com sucesso.");
        } else {
            console.log("Nenhum registro encontrado no Zoho.");
        }

    } catch (e) {
        console.error("Erro critico:");
        console.error(e.response ? JSON.stringify(e.response.data, null, 2) : e.message);
        process.exit(1);
    }
}
run();
