const axios = require('axios');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function sanitize(val) {
    if (typeof val !== 'string') return val;
    const formulaChars = ['=', '+', '-', '@'];
    if (formulaChars.some(char => val.startsWith(char))) return `'${val}`;
    return val;
}

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

// Trata campos específicos baseado no nome da coluna
function processField(record, fieldName) {
    const rawValue = record[fieldName];

    // 1. Tratamento de Telefone
    if (fieldName.includes("Telefone_de_contato")) {
        const phone = String(rawValue || '');
        return phone.startsWith('+') ? phone.slice(1) : phone;
    }

    // 2. Tratamento de Data Combinada (Início + Fim)
    // Se for o campo de início, e quisermos a lógica de combinar com o fim
    if (fieldName === "Data_e_hora_de_in_cio_do_servi_o") {
        const dateStart = String(rawValue || '').split(' ')[0];
        const timeEnd = record["Data_e_hora_de_fim_do_servi_o"];
        if (timeEnd && String(timeEnd).includes(':')) {
            const t = String(timeEnd).split(':');
            return `${dateStart} ${t[0]}:${t[1]}`;
        }
        return dateStart;
    }

    // 3. Padrão: Extração de objetos/strings
    return extractValue(rawValue);
}

async function run() {
    const {
        ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN,
        ZOHO_ACCOUNT_OWNER, ZOHO_APP_LINK_NAME, ZOHO_REPORT_LINK_NAME,
        GOOGLE_TOKEN, REPORT_SPREADSHEET_ID, REPORT_SHEET_NAME,
        REPORT_COLUMN_MAPPING 
    } = process.env;

    if (!REPORT_COLUMN_MAPPING) {
        console.error("Erro: Secret REPORT_COLUMN_MAPPING não configurado.");
        process.exit(1);
    }

    const columns = JSON.parse(REPORT_COLUMN_MAPPING);
    const gHeaders = { 'Authorization': `Bearer ${GOOGLE_TOKEN}`, 'Content-Type': 'application/json' };

    try {
        // Auth Zoho
        const authRes = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: ZOHO_REFRESH_TOKEN,
                client_id: ZOHO_CLIENT_ID,
                client_secret: ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            }
        });
        const zohoToken = authRes.data.access_token;

        // Datas (Últimos 2 meses)
        const mesesIngles = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const hoje = new Date();
        const dataInicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
        const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}-${mesesIngles[d.getMonth()]}-${d.getFullYear()}`;
        
        const criteria = `(Data_e_hora_de_inicio_do_formulario >= "${fmt(dataInicio)}" && Data_e_hora_de_inicio_do_formulario <= "${fmt(hoje)}")`;

        let allProcessed = [];
        let fromIndex = 1;

        while (true) {
            const resp = await axios.get(`https://creator.zoho.com/api/v2/${ZOHO_ACCOUNT_OWNER}/${ZOHO_APP_LINK_NAME}/report/${ZOHO_REPORT_LINK_NAME}`, {
                params: { from: fromIndex, limit: 200, criteria: criteria },
                headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` }
            });

            const data = resp.data.data || [];
            if (data.length === 0) break;

            data.forEach(record => {
                const row = columns.map(fieldName => processField(record, fieldName));
                allProcessed.push(row);
            });

            if (data.length < 200) break;
            fromIndex += 200;
        }

        if (allProcessed.length > 0) {
            console.log(`Enviando ${allProcessed.length} linhas para a aba ${REPORT_SHEET_NAME}...`);
            
            // O range A2 garante que os dados entrem abaixo do cabeçalho
            const urlUpdate = `https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SPREADSHEET_ID}/values/${REPORT_SHEET_NAME}!A2:update?valueInputOption=USER_ENTERED`;

            await axios.put(urlUpdate, { values: allProcessed }, { headers: gHeaders });
            console.log("Sucesso!");
        }

    } catch (e) {
        console.error("Erro:", e.response ? e.response.data : e.message);
        process.exit(1);
    }
}

run();
