const axios = require('axios');

function secureLog(message, isError = false) {
    const timestamp = new Date().toISOString();
    const logLevel = isError ? 'ERROR' : 'INFO';
    const cleanMessage = message.replace(/[a-zA-Z0-9]{20,}/g, '[MASKED]');
    console.log(`[${timestamp}] [${logLevel}] ${cleanMessage}`);
}

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
    if (fieldName === 'Data_e_hora_de_fim_do_servi_o' && typeof rawValue === 'string') {
        const inicio = record['Data_e_hora_de_in_cio_do_servi_o'];
        if (inicio && typeof inicio === 'string') {
            const dataPart = inicio.split(' ')[0];
            return sanitize(`${dataPart} ${rawValue}`);
        }
    }
    if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        return sanitize(rawValue.display_value || rawValue.ID || String(rawValue));
    }
    if (Array.isArray(rawValue)) {
        return sanitize(rawValue.map(v => (typeof v === 'object' ? v.display_value || v.ID : v)).join(', '));
    }
    return sanitize(String(rawValue));
}

async function run() {
    try {
        secureLog('Iniciando sincronização (Utilizando API v2 - Mesma do Python)');

        // 1. Token
        const authRes = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: process.env.ZOHO_REFRESH_TOKEN,
                client_id: process.env.ZOHO_CLIENT_ID,
                client_secret: process.env.ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            }
        });
        const zohoToken = authRes.data.access_token;

        // 2. Datas (Exatamente como o Python espera)
        const today = new Date();
        const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        
        const formatZohoDate = (date) => {
            const d = String(date.getDate()).padStart(2, '0');
            const m = months[date.getMonth()];
            const y = date.getFullYear();
            return `${d}-${m}-${y}`;
        };

        const criteria = `(Data_e_hora_de_inicio_do_formulario >= "${formatZohoDate(startDate)}" && Data_e_hora_de_inicio_do_formulario <= "${formatZohoDate(today)}")`;
        secureLog(`Critério v2: ${criteria}`);

        // 3. Busca v2 (Paginada)
        let allRecords = [];
        let fromIndex = 1;
        const limit = 200;
        // URL alterada para v2 para respeitar o critério de data
        const baseUrl = `https://creator.zoho.com/api/v2/${process.env.ZOHO_ACCOUNT_OWNER}/${process.env.ZOHO_APP_NAME}/report/${process.env.ZOHO_REPORT_NAME}`;

        while (allRecords.length < 10000) { // Trava de segurança em 10k
            try {
                const resp = await axios.get(baseUrl, {
                    params: { from: fromIndex, limit: limit, criteria: criteria },
                    headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` }
                });

                const records = resp.data.data || [];
                if (records.length === 0) break;

                allRecords = allRecords.concat(records);
                secureLog(`Coletados: ${allRecords.length} registros...`);
                
                if (records.length < limit) break;
                fromIndex += limit;
            } catch (err) {
                if (err.response && err.response.data && err.response.data.code === 9280) break;
                throw err;
            }
        }

        // 4. Update Sheets
        if (allRecords.length > 0) {
            const columns = JSON.parse(process.env.REPORT_COLUMN_MAPPING);
            const allProcessed = allRecords.map(rec => columns.map(f => processField(rec, f)));
            
            const sheetId = process.env.REPORT_SPREADSHEET_ID;
            const sheetName = process.env.REPORT_SHEET_NAME;
            const urlSheets = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/'${sheetName}'!A2?valueInputOption=USER_ENTERED`;

            await axios.put(
                urlSheets,
                { values: allProcessed },
                { headers: { 'Authorization': `Bearer ${process.env.GOOGLE_TOKEN}` } }
            );
            secureLog(`Sucesso: ${allRecords.length} registros sincronizados.`);
        }

    } catch (e) {
        secureLog(`Erro: ${e.message}`, true);
        process.exit(1);
    }
}

run();
