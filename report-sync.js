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

        // 2. Filtro de Datas (Últimos 2 meses)
        const hoje = new Date();
        const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1);
        const f = (d) => d.toISOString().split('T')[0];

        const criteria = `(Data_e_hora_de_inicio_do_formulario >= "${f(inicio)}" && Data_e_hora_de_inicio_do_formulario <= "${f(hoje)}")`;
        const columns = JSON.parse(process.env.REPORT_COLUMN_MAPPING);
        
        console.log(`Tentando buscar com filtro: ${f(inicio)} ate ${f(hoje)}`);

        async function fetchRecords(queryCriteria) {
            const resp = await axios.get(`https://creator.zoho.com/api/v2/${process.env.ZOHO_ACCOUNT_OWNER}/${process.env.ZOHO_APP_LINK_NAME}/report/${process.env.ZOHO_REPORT_LINK_NAME}`, {
                params: { from: 1, limit: 200, criteria: queryCriteria },
                headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` }
            });
            return resp.data.data || [];
        }

        let data = [];
        try {
            data = await fetchRecords(criteria);
        } catch (e) {
            console.log("Erro no filtro de data. Tentando busca sem filtro...");
            data = await fetchRecords(""); 
        }

        if (data.length === 0 && criteria !== "") {
            console.log("Nenhum dado com filtro. Tentando busca geral...");
            data = await fetchRecords("");
        }

        // 3. Processar e Enviar
        if (data.length > 0) {
            const allProcessed = data.map(rec => columns.map(f => processField(rec, f)));
            console.log(`Enviando ${allProcessed.length} registros para o Google Sheets.`);
            
            await axios.put(
                `https://sheets.googleapis.com/v4/spreadsheets/${process.env.REPORT_SPREADSHEET_ID}/values/${process.env.REPORT_SHEET_NAME}!A2:update?valueInputOption=USER_ENTERED`,
                { values: allProcessed },
                { headers: { 'Authorization': `Bearer ${process.env.GOOGLE_TOKEN}` } }
            );
            console.log("Concluido com sucesso.");
        } else {
            console.log("O Zoho retornou zero registros mesmo sem filtros. Verifique os nomes das APIs.");
        }

    } catch (e) {
        console.error("Erro critico na execucao:", e.message);
        process.exit(1);
    }
}
run();
