const axios = require('axios');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
        const authRes = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: process.env.ZOHO_REFRESH_TOKEN,
                client_id: process.env.ZOHO_CLIENT_ID,
                client_secret: process.env.ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            }
        });
        const zohoToken = authRes.data.access_token;

        // Datas simplificadas para YYYY-MM-DD
        const hoje = new Date();
        const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1);
        
        const f = (d) => d.toISOString().split('T')[0];

        // Critério simplificado (sem horas)
        const criteria = `(Data_e_hora_de_inicio_do_formulario >= "${f(inicio)}" && Data_e_hora_de_inicio_do_formulario <= "${f(hoje)}")`;
        
        console.log(`Filtro: ${criteria}`);

        let allProcessed = [];
        let fromIndex = 1;
        const columns = JSON.parse(process.env.REPORT_COLUMN_MAPPING);

        while (true) {
            try {
                const resp = await axios.get(`https://creator.zoho.com/api/v2/${process.env.ZOHO_ACCOUNT_OWNER}/${process.env.ZOHO_APP_LINK_NAME}/report/${process.env.ZOHO_REPORT_LINK_NAME}`, {
                    params: { from: fromIndex, limit: 200, criteria: criteria },
                    headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` }
                });
                const data = resp.data.data || [];
                if (data.length === 0) break;
                data.forEach(rec => allProcessed.push(columns.map(f => processField(rec, f))));
                if (data.length < 200) break;
                fromIndex += 200;
                await sleep(500);
            } catch (err) {
                if (err.response && (err.response.status === 404 || err.response.data.code === 3100)) break;
                throw err;
            }
        }

        if (allProcessed.length > 0) {
            console.log(`Enviando ${allProcessed.length} registros...`);
            await axios.put(
                `https://sheets.googleapis.com/v4/spreadsheets/${process.env.REPORT_SPREADSHEET_ID}/values/${process.env.REPORT_SHEET_NAME}!A2:update?valueInputOption=USER_ENTERED`,
                { values: allProcessed },
                { headers: { 'Authorization': `Bearer ${process.env.GOOGLE_TOKEN}` } }
            );
            console.log("Sucesso.");
        } else {
            console.log("Nenhum dado encontrado.");
        }
    } catch (e) {
        console.error("Erro na execucao.");
        process.exit(1);
    }
}
run();
