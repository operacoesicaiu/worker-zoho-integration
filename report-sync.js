const axios = require('axios');

/**
 * Evita injeção de fórmulas no Google Sheets
 */
function sanitize(val) {
    if (typeof val !== 'string') return val;
    const formulaChars = ['=', '+', '-', '@'];
    if (formulaChars.some(char => val.startsWith(char))) return `'${val}`;
    return val;
}

/**
 * Processa campos do Zoho Creator
 * Extrai display_value para objetos e trata arrays
 */
function processField(record, fieldName) {
    const rawValue = record[fieldName];
    if (rawValue === null || rawValue === undefined || rawValue === '') return '';
    
    if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        return sanitize(rawValue.display_value || rawValue.ID || String(rawValue));
    }
    
    if (Array.isArray(rawValue)) {
        return sanitize(rawValue.map(v => (typeof v === 'object' ? v.display_value || v : v)).join(', '));
    }
    
    return sanitize(String(rawValue));
}

async function run() {
    // Mascara o token no log do GitHub Actions
    if (process.env.GOOGLE_TOKEN) {
        process.stdout.write(`::add-mask::${process.env.GOOGLE_TOKEN}\n`);
    }

    try {
        console.log("Iniciando Sincronizacao iCaiu");

        // 1. Autenticação Zoho
        const authRes = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: process.env.ZOHO_REFRESH_TOKEN,
                client_id: process.env.ZOHO_CLIENT_ID,
                client_secret: process.env.ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            }
        });
        const zohoToken = authRes.data.access_token;
        console.log("Zoho Auth: OK");

        // 2. Variaveis de Ambiente
        const owner = process.env.ZOHO_ACCOUNT_OWNER;
        const app = process.env.ZOHO_APP_NAME;
        const report = process.env.ZOHO_REPORT_NAME;
        const baseUrl = `https://creator.zoho.com/api/v2.1/${owner}/${app}/report/${report}`;

        // 3. Filtro de Datas (Ultimos 2 meses)
        const hoje = new Date();
        const inicio = new Date();
        inicio.setMonth(hoje.getMonth() - 2);
        inicio.setDate(1); 
        
        const f = (d) => d.toISOString().split('T')[0];
        const criteria = `(Data_e_hora_de_inicio_do_formulario >= "${f(inicio)}")`;
        
        const columns = JSON.parse(process.env.REPORT_COLUMN_MAPPING);
        console.log(`Buscando registros desde: ${f(inicio)}`);

        async function fetchRecords(queryCriteria) {
            const resp = await axios.get(baseUrl, {
                params: { from: 1, limit: 200, criteria: queryCriteria },
                headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` }
            });
            return resp.data.data || [];
        }

        let data = [];
        try {
            data = await fetchRecords(criteria);
        } catch (e) {
            console.log("Erro no filtro de data. Tentando busca sem filtro.");
            data = await fetchRecords(""); 
        }

        if (data.length === 0 && criteria !== "") {
            console.log("Nenhum dado com filtro. Tentando busca geral.");
            data = await fetchRecords("");
        }

        // 4. Processar e Enviar
        if (data.length > 0) {
            const allProcessed = data.map(rec => columns.map(colName => processField(rec, colName)));
            console.log(`Enviando ${allProcessed.length} registros para o Sheets.`);
            
            await axios.put(
                `https://sheets.googleapis.com/v4/spreadsheets/${process.env.REPORT_SPREADSHEET_ID}/values/${process.env.REPORT_SHEET_NAME}!A2:update?valueInputOption=USER_ENTERED`,
                { values: allProcessed },
                { headers: { 'Authorization': `Bearer ${process.env.GOOGLE_TOKEN}` } }
            );
            console.log("Sincronizacao concluida.");
        } else {
            console.log("Zoho retornou zero registros.");
        }

    } catch (e) {
        console.error("Erro Critico:");
        if (e.response) {
            console.error(JSON.stringify(e.response.data, null, 2));
        } else {
            console.error(e.message);
        }
        process.exit(1);
    }
}

run();
