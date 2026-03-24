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
    if (fieldName.includes("Telefone_de_contato")) {
        const phone = String(rawValue || '');
        return phone.startsWith('+') ? phone.slice(1) : phone;
    }
    if (fieldName === "Data_e_hora_de_in_cio_do_servi_o") {
        const dateStart = String(rawValue || '').split(' ')[0];
        const timeEnd = record["Data_e_hora_de_fim_do_servi_o"];
        if (timeEnd && String(timeEnd).includes(':')) {
            const t = String(timeEnd).split(':');
            return `${dateStart} ${t[0]}:${t[1]}`;
        }
        return dateStart;
    }
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

        const hoje = new Date();
        const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
        
        const f = (d) => {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}-${month}-${year} 00:00:00`;
        };

        const criteria = `(Data_e_hora_de_inicio_do_formulario >= "${f(inicio)}" && Data_e_hora_de_inicio_do_formulario <= "${f(hoje)}")`;
        
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

        // 3. Google Sheets
        if (allProcessed.length > 0) {
            console.log(`Enviando ${allProcessed.length} linhas.`);
            await axios.put(
                `https://sheets.googleapis.com/v4/spreadsheets/${process.env.REPORT_SPREADSHEET_ID}/values/${process.env.REPORT_SHEET_NAME}!A2:update?valueInputOption=USER_ENTERED`,
                { values: allProcessed },
                { headers: { 'Authorization': `Bearer ${process.env.GOOGLE_TOKEN}` } }
            );
            console.log("Concluido.");
        } else {
            console.log("Nenhum dado encontrado.");
        }

    } catch (e) {
        console.error("Erro na execucao.");
        process.exit(1);
    }
}
run();
