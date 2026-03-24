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

    return extractValue(rawValue);
}

async function run() {
    const config = {
        zohoClientId: process.env.ZOHO_CLIENT_ID,
        zohoClientSecret: process.env.ZOHO_CLIENT_SECRET,
        zohoRefreshToken: process.env.ZOHO_REFRESH_TOKEN,
        zohoOwner: process.env.ZOHO_ACCOUNT_OWNER,
        zohoApp: process.env.ZOHO_APP_LINK_NAME,
        zohoReport: process.env.ZOHO_REPORT_LINK_NAME,
        googleToken: process.env.GOOGLE_TOKEN,
        sheetId: process.env.REPORT_SPREADSHEET_ID,
        sheetName: process.env.REPORT_SHEET_NAME,
        mapping: process.env.REPORT_COLUMN_MAPPING
    };

    // Validação sem logar valores sensíveis
    if (!config.googleToken || !config.mapping || !config.sheetId) {
        console.error("Erro: Variaveis criticas ausentes no ambiente.");
        process.exit(1);
    }

    const columns = JSON.parse(config.mapping);
    const gHeaders = { 
        'Authorization': `Bearer ${config.googleToken}`, 
        'Content-Type': 'application/json' 
    };

    try {
        console.log("Iniciando busca no Zoho...");

        const authRes = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: config.zohoRefreshToken,
                client_id: config.zohoClientId,
                client_secret: config.zohoClientSecret,
                grant_type: 'refresh_token'
            }
        });
        const zohoToken = authRes.data.access_token;

        const mesesIngles = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const hoje = new Date();
        const dataInicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
        const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}-${mesesIngles[d.getMonth()]}-${d.getFullYear()}`;
        
        const criteria = `(Data_e_hora_de_inicio_do_formulario >= "${fmt(dataInicio)}" && Data_e_hora_de_inicio_do_formulario <= "${fmt(hoje)}")`;

        let allProcessed = [];
        let fromIndex = 1;

        while (true) {
            try {
                const resp = await axios.get(`https://creator.zoho.com/api/v2/${config.zohoOwner}/${config.zohoApp}/report/${config.zohoReport}`, {
                    params: { from: fromIndex, limit: 200, criteria: criteria },
                    headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` }
                });

                const data = resp.data.data || [];
                if (data.length === 0) break;

                data.forEach(record => {
                    allProcessed.push(columns.map(fieldName => processField(record, fieldName)));
                });

                if (data.length < 200) break;
                fromIndex += 200;
                await sleep(500); 
            } catch (err) {
                if (err.response && (err.response.status === 404 || err.response.data.code === 3100)) break;
                throw err;
            }
        }

        if (allProcessed.length > 0) {
            console.log(`Enviando ${allProcessed.length} linhas para o Sheets...`);
            
            const urlUpdate = `https://sheets.googleapis.com/v4/spreadsheets/${config.sheetId}/values/${config.sheetName}!A2:update?valueInputOption=USER_ENTERED`;

            await axios.put(urlUpdate, { values: allProcessed }, { 
                headers: gHeaders,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });
            
            console.log("Concluido.");
        } else {
            console.log("Nenhum dado encontrado.");
        }

    } catch (e) {
        console.error("Erro na execucao.");
        console.error("Mensagem:", e.message);
        if (e.response && e.response.data) {
            console.error("Detalhes API:", JSON.stringify(e.response.data));
        }
        process.exit(1);
    }
}

run();
