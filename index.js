const axios = require('axios');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Impede Formula Injection no Google Sheets
function sanitize(val) {
    if (typeof val !== 'string') return val;
    const formulaChars = ['=', '+', '-', '@'];
    if (formulaChars.some(char => val.startsWith(char))) {
        return `'${val}`;
    }
    return val;
}

// Processa campos complexos do Zoho (Lookups, Multi-select, etc)
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

async function run() {
    const {
        ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN,
        ZOHO_ACCOUNT_OWNER, ZOHO_APP_LINK_NAME, ZOHO_REPORT_LINK_NAME,
        SPREADSHEET_ID, SHEET_NAME, GOOGLE_TOKEN, COLUMN_MAPPING
    } = process.env;

    if (!ZOHO_CLIENT_ID || !GOOGLE_TOKEN || !COLUMN_MAPPING) {
        console.error("Erro: Variáveis de ambiente obrigatórias ausentes.");
        process.exit(1);
    }

    const mapping = JSON.parse(COLUMN_MAPPING);
    const gHeaders = { 'Authorization': `Bearer ${GOOGLE_TOKEN}`, 'Content-Type': 'application/json' };

    try {
        // 1. Autenticação Zoho
        console.log("--- ETAPA 1: Autenticação Zoho ---");
        const authRes = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: ZOHO_REFRESH_TOKEN,
                client_id: ZOHO_CLIENT_ID,
                client_secret: ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            },
            timeout: 20000
        });
        const zohoToken = authRes.data.access_token;
        console.log("Autenticação realizada com sucesso.");

        // 2. Cálculo do "Dia de Ontem"
        // O Zoho espera o formato DD-Mon-YYYY (Ex: 19-Mar-2026)
        const mesesIngles = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const dataReferencia = new Date();
        dataReferencia.setDate(dataReferencia.getDate() - 1); // Remove 1 dia

        const dia = String(dataReferencia.getDate()).padStart(2, '0');
        const mes = mesesIngles[dataReferencia.getMonth()];
        const ano = dataReferencia.getFullYear();
        
        const dataFiltro = `${dia}-${mes}-${ano}`;
        console.log(`--- ETAPA 2: Filtrando registros de ontem (${dataFiltro}) ---`);

        let allProcessed = [];
        let fromIndex = 1; // API do Zoho Creator v2 inicia em 1
        const limit = 200;

        // 3. Loop de Captura de Dados com Critério de Data
        while (true) {
            const queryUrl = `https://creator.zoho.com/api/v2/${ZOHO_ACCOUNT_OWNER}/${ZOHO_APP_LINK_NAME}/report/${ZOHO_REPORT_LINK_NAME}`;
            
            // Critério: Pega registros onde a data de início é IGUAL ao dia de ontem
            // Usamos >= 00:00:00 e <= 23:59:59 para garantir o dia cheio
            const criteria = `(Data_e_hora_de_inicio_do_formul_rio >= "${dataFiltro} 00:00:00" && Data_e_hora_de_inicio_do_formul_rio <= "${dataFiltro} 23:59:59")`;

            console.log(`Buscando registros: índice ${fromIndex}...`);
            
            try {
                const resp = await axios.get(queryUrl, {
                    params: { from: fromIndex, limit: limit, criteria: criteria },
                    headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` },
                    timeout: 45000
                });

                const data = resp.data.data || [];
                if (data.length === 0) break;

                data.forEach(record => {
                    // Mapeia os campos conforme o JSON configurado no COLUMN_MAPPING
                    const row = Object.values(mapping).map(zohoKey => extractValue(record[zohoKey]));
                    allProcessed.push(row);
                });

                if (data.length < limit) break; // Se veio menos que o limite, acabou a base
                fromIndex += limit;

            } catch (err) {
                if (err.response && (err.response.status === 404 || err.response.data.code === 3100)) {
                    console.log("Fim dos registros alcançado.");
                    break;
                }
                throw err;
            }
        }

        // 4. Envio para Google Sheets
        if (allProcessed.length > 0) {
            console.log(`--- ETAPA 3: Enviando ${allProcessed.length} linhas para o Sheets ---`);
            const urlAppend = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A1:append?valueInputOption=USER_ENTERED`;

            for (let i = 0; i < allProcessed.length; i += 500) {
                const batch = allProcessed.slice(i, i + 500);
                await axios.post(urlAppend, { values: batch }, { headers: gHeaders, timeout: 60000 });
                console.log(`Lote enviado: ${i + batch.length} de ${allProcessed.length}`);
                await sleep(1500); // Evita Rate Limit do Google
            }
            console.log("Processo concluído com sucesso!");
        } else {
            console.log("Nenhum dado encontrado para o dia de ontem.");
        }

    } catch (e) {
        console.error("\n--- FALHA NO PROCESSO ---");
        if (e.response) {
            console.error(`Status: ${e.response.status} | Resposta: ${JSON.stringify(e.response.data)}`);
        } else {
            console.error(`Erro: ${e.message}`);
        }
        process.exit(1);
    }
}

run();
