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
    if (!rawValue && rawValue !== 0) return '';
    
    // Tratamento específico para telefones
    if (fieldName.includes("Telefone")) {
        const phone = String(rawValue);
        return phone.startsWith('+') ? phone.slice(1) : phone;
    }

    // Tratamento para objetos do Zoho (ID, display_value)
    if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        return sanitize(rawValue.display_value || rawValue.ID || String(rawValue));
    }
    
    // Tratamento para listas/checkboxes
    if (Array.isArray(rawValue)) {
        return sanitize(rawValue.map(v => (typeof v === 'object' ? v.display_value || v : v)).join(', '));
    }

    return sanitize(String(rawValue));
}

async function run() {
    try {
        // 1. Obter novo Access Token do Zoho
        const authRes = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: process.env.ZOHO_REFRESH_TOKEN,
                client_id: process.env.ZOHO_CLIENT_ID,
                client_secret: process.env.ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            }
        });
        const zohoToken = authRes.data.access_token;

        // 2. Configurar Datas (Últimos 2 meses)
        const hoje = new Date();
        const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1);
        
        const formatZoho = (d, endDay = false) => {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}-${month}-${year} ${endDay ? '23:59:59' : '00:00:00'}`;
        };

        // Critério de busca
        const criteria = `(Data_e_hora_de_inicio_do_formulario >= "${formatZoho(inicio)}" && Data_e_hora_de_inicio_do_formulario <= "${formatZoho(hoje, true)}")`;
        
        let allProcessed = [];
        let fromIndex = 1;
        const columns = JSON.parse(process.env.REPORT_COLUMN_MAPPING);

        console.log(`Iniciando busca no Zoho para o período: ${formatZoho(inicio)} até ${formatZoho(hoje, true)}`);

        // 3. Loop de Paginação (Zoho v2)
        while (true) {
            try {
                const resp = await axios.get(`https://creator.zoho.com/api/v2/${process.env.ZOHO_ACCOUNT_OWNER}/${process.env.ZOHO_APP_LINK_NAME}/report/${process.env.ZOHO_REPORT_LINK_NAME}`, {
                    params: { from: fromIndex, limit: 200, criteria: criteria },
                    headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` }
                });

                const data = resp.data.data || [];
                if (data.length === 0) break;

                data.forEach(rec => {
                    allProcessed.push(columns.map(colName => processField(rec, colName)));
                });

                if (data.length < 200) break;
                fromIndex += 200;
                await sleep(500); // Evitar Rate Limit
            } catch (err) {
                if (err.response && (err.response.status === 404 || err.response.data.code === 3100)) break;
                throw err;
            }
        }

        // 4. Enviar para Google Sheets
        if (allProcessed.length > 0) {
            console.log(`Encontrados ${allProcessed.length} registros. Atualizando planilha...`);
            const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.REPORT_SPREADSHEET_ID}/values/${process.env.REPORT_SHEET_NAME}!A2:update?valueInputOption=USER_ENTERED`;
            
            await axios.put(sheetsUrl, { values: allProcessed }, { 
                headers: { 'Authorization': `Bearer ${process.env.GOOGLE_TOKEN}` } 
            });
            console.log("Sincronização concluída com sucesso.");
        } else {
            console.log("Nenhum dado encontrado no Zoho para este critério.");
        }

    } catch (e) {
        console.error("Erro crítico na execução. Verifique as credenciais e nomes de campos.");
        process.exit(1);
    }
}

run();
