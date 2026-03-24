const axios = require('axios');

function sanitize(val) {
    if (typeof val !== 'string') return val;
    const formulaChars = ['=', '+', '-', '@'];
    if (formulaChars.some(char => val.startsWith(char))) return `'${val}`;
    return val;
}

function processField(record, fieldName) {
    const rawValue = record[fieldName];
    if (rawValue === null || rawValue === undefined || rawValue === '') return '';
    if (typeof rawValue === 'object' && !Array.isArray(rawValue)) return sanitize(rawValue.display_value || rawValue.ID || String(rawValue));
    if (Array.isArray(rawValue)) return sanitize(rawValue.map(v => (typeof v === 'object' ? v.display_value || v : v)).join(', '));
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

        // 2. Filtro de Datas
        const hoje = new Date();
        const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1);
        const f = (d) => d.toISOString().split('T')[0];
        const criteria = `(Data_e_hora_de_inicio_do_formulario >= "${f(inicio)}")`;
        
        const columns = JSON.parse(process.env.REPORT_COLUMN_MAPPING);
        const baseUrl = `https://creator.zoho.com/api/v2.1/${process.env.ZOHO_ACCOUNT_OWNER}/${process.env.ZOHO_APP_LINK_NAME}/report/${process.env.ZOHO_REPORT_LINK_NAME}`;

        async function fetchRecords(queryCriteria) {
            const resp = await axios.get(baseUrl, {
                params: { from: 1, limit: 200, criteria: queryCriteria },
                headers: { 
                    'Authorization': `Zoho-oauthtoken ${zohoToken}`,
                    'Accept': 'application/json'
                }
            });
            return resp.data.data || [];
        }

        console.log("Buscando dados no Zoho...");
        let data = [];
        try {
            data = await fetchRecords(criteria);
        } catch (e) {
            console.log("Erro no filtro. Tentando busca geral.");
            data = await fetchRecords(""); 
        }

        // 3. Processar e Enviar para Google Sheets
        if (data.length > 0) {
            const allProcessed = data.map(rec => columns.map(f => processField(rec, f)));
            console.log(`Enviando ${allProcessed.length} registros.`);
    
            const sheetId = process.env.REPORT_SPREADSHEET_ID;
            const range = `${process.env.REPORT_SHEET_NAME}!A2`;
            const urlSheets = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=USER_ENTERED`;

            await axios.put(
                urlSheets,
                { values: allProcessed },
                { headers: { 'Authorization': `Bearer ${process.env.GOOGLE_TOKEN}` } }
            );
            console.log("Sincronizacao concluida com sucesso.");
        } else {
            console.log("Nenhum registro encontrado.");
        }

    } catch (e) {
        console.error("Erro critico na execucao:");
        if (e.response && e.response.data) {
            console.error(JSON.stringify(e.response.data, null, 2));
        } else {
            console.error(e.message);
        }
        process.exit(1);
    }
}
run();
