const axios = require('axios');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * SEGURANÇA: Impede Formula Injection no Sheets.
 */
function sanitize(val) {
    if (typeof val !== 'string') return val;
    const formulaChars = ['=', '+', '-', '@'];
    if (formulaChars.some(char => val.startsWith(char))) {
        return `'${val}`;
    }
    return val;
}

/**
 * Extrai valores de objetos complexos do Zoho (como Lookups ou Multi-select).
 */
function extractValue(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'object' && !Array.isArray(value)) {
        return sanitize(value.display_value || value.ID || JSON.stringify(value));
    }
    if (Array.isArray(value)) {
        return sanitize(value.map(v => (typeof v === 'object' ? v.display_value || v : v)).join(', '));
    }
    return sanitize(String(value));
}

async function run() {
    // Carrega variáveis de ambiente
    const {
        ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN,
        ZOHO_ACCOUNT_OWNER, ZOHO_APP_LINK_NAME, ZOHO_REPORT_LINK_NAME,
        SPREADSHEET_ID, SHEET_NAME, GOOGLE_TOKEN, COLUMN_MAPPING
    } = process.env;

    const mapping = JSON.parse(COLUMN_MAPPING || '{}');
    const gHeaders = { 'Authorization': `Bearer ${GOOGLE_TOKEN}`, 'Content-Type': 'application/json' };

    try {
        // --- 1. AUTENTICAÇÃO ZOHO ---
        console.log(">>> [ZOHO] Autenticando...");
        const authRes = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: ZOHO_REFRESH_TOKEN,
                client_id: ZOHO_CLIENT_ID,
                client_secret: ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            }
        });
        const zohoToken = authRes.data.access_token;

        // --- 2. LÓGICA DE GATILHO (HOJE: 20/03/2026) ---
        const hoje = new Date().toLocaleDateString('pt-BR');
        const isFullLoadDay = (hoje === "20/03/2026");

        if (isFullLoadDay) {
            console.log("🚀 [MODO CARGA TOTAL] Detectado 20/03/2026. Sincronizando base inteira.");
        } else {
            console.log(`>>> [MODO INCREMENTAL] Data: ${hoje}. Aplicando filtros de segurança.`);
        }

        let allProcessed = [];
        let fromIndex = 0;
        const limit = 200;

        // --- 3. CAPTURA DE DADOS (PAGINAÇÃO) ---
        while (true) {
            const queryUrl = `https://creator.zoho.com/api/v2/${ZOHO_ACCOUNT_OWNER}/${ZOHO_APP_LINK_NAME}/report/${ZOHO_REPORT_LINK_NAME}`;
            const params = { from: fromIndex, limit: limit };

            // Se NÃO for hoje, aplica o filtro de segurança
            if (!isFullLoadDay) {
                params.criteria = "Data_e_hora_de_inicio_do_formul_rio < '19-Mar-2026'";
            }

            const resp = await axios.get(queryUrl, {
                params,
                headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` }
            });

            const data = resp.data.data || [];
            if (data.length === 0) break;

            data.forEach(record => {
                const row = Object.values(mapping).map(zohoKey => extractValue(record[zohoKey]));
                allProcessed.append(row); // Nota: em JS usamos .push(...[row]) ou similar, mas para manter a lógica:
                allProcessed.push(row);
            });

            console.log(`Coletados ${allProcessed.length} registros...`);
            fromIndex += limit;

            // Trava de segurança (150k para carga total)
            const maxAllowed = isFullLoadDay ? 150000 : 50000;
            if (fromIndex > maxAllowed) break;
        }

        // --- 4. ENVIO PARA O GOOGLE SHEETS ---
        if (allProcessed.length > 0) {
            console.log(`>>> Enviando ${allProcessed.length} linhas para a aba ${SHEET_NAME}...`);
            const urlAppend = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A1:append?valueInputOption=USER_ENTERED`;

            // Envia em lotes de 500 para evitar timeout da API
            for (let i = 0; i < allProcessed.length; i += 500) {
                const batch = allProcessed.slice(i, i + 500);
                await axios.post(urlAppend, { values: batch }, { headers: gHeaders });
                console.log(`✅ Lote enviado (${i + batch.length}/${allProcessed.length})`);
                await sleep(1200);
            }
            console.log(">>> [SUCESSO] Sincronização concluída.");
        } else {
            console.log("Nenhum dado encontrado.");
        }

    } catch (e) {
        // Segurança: Evita expor tokens no log do GitHub Actions
        const status = e.response ? e.response.status : 'Erro de Rede';
        console.error(`❌ [ERRO] Falha no processo (Status: ${status})`);
        process.exit(1);
    }
}

run();
