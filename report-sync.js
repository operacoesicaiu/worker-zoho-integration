const axios = require('axios');

function secureLog(message, isError = false) {
    const timestamp = new Date().toISOString();
    const logLevel = isError ? 'ERROR' : 'INFO';
    console.log(`[${timestamp}] [${logLevel}] ${message}`);
}

async function run() {
    try {
        const {
            ZOHO_REFRESH_TOKEN, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET,
            ZOHO_ACCOUNT_OWNER, ZOHO_APP_NAME, ZOHO_REPORT_NAME,
            REPORT_SPREADSHEET_ID, REPORT_SHEET_NAME, GOOGLE_TOKEN, REPORT_COLUMN_MAPPING
        } = process.env;

        const gHeaders = { 'Authorization': `Bearer ${GOOGLE_TOKEN}`, 'Content-Type': 'application/json' };

        // 1. Auth Zoho
        const authRes = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: { refresh_token: ZOHO_REFRESH_TOKEN, client_id: ZOHO_CLIENT_ID, client_secret: ZOHO_CLIENT_SECRET, grant_type: 'refresh_token' }
        });
        const zohoToken = authRes.data.access_token;

        // 2. Datas (2 meses)
        const today = new Date();
        const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const formatZohoDate = (d) => `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
        const criteria = `(Data_e_hora_de_inicio_do_formulario >= "${formatZohoDate(startDate)}" && Data_e_hora_de_inicio_do_formulario <= "${formatZohoDate(today)}")`;

        // 3. Coleta Zoho (Máximo 10k registros)
        let zohoRecords = [];
        let fromIndex = 1;
        while (zohoRecords.length < 10000) {
            const resp = await axios.get(`https://creator.zoho.com/api/v2/${ZOHO_ACCOUNT_OWNER}/${ZOHO_APP_NAME}/report/${ZOHO_REPORT_NAME}`, {
                params: { from: fromIndex, limit: 200, criteria: criteria },
                headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` }
            });
            const data = resp.data.data || [];
            if (data.length === 0) break;
            zohoRecords = zohoRecords.concat(data);
            if (data.length < 200) break;
            fromIndex += 200;
        }
        secureLog(`Zoho: ${zohoRecords.length} registros encontrados.`);

        // 4. Localizar ponto de corte (Busca Reversa Paginada)
        // Pegamos os metadados da planilha para saber o tamanho total
        const spreadsheet = await axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SPREADSHEET_ID}`, { headers: gHeaders });
        const sheet = spreadsheet.data.sheets.find(s => s.properties.title === REPORT_SHEET_NAME);
        let lastRowInSheet = sheet.properties.gridProperties.rowCount;
        
        let deleteFromRow = lastRowInSheet + 1;
        let foundBorder = false;
        const pageSize = 1000;

        secureLog(`Iniciando busca reversa por data de corte na planilha (${lastRowInSheet} linhas totais)...`);

        for (let end = lastRowInSheet; end > 1; end -= pageSize) {
            const start = Math.max(2, end - pageSize + 1);
            const range = `'${REPORT_SHEET_NAME}'!R${start}:R${end}`;
            
            const res = await axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SPREADSHEET_ID}/values/${range}`, { headers: gHeaders });
            const rows = res.data.values || [];
            
            // Analisamos o lote de baixo para cima
            for (let j = rows.length - 1; j >= 0; j--) {
                const dateStr = rows[j][0];
                if (!dateStr) continue;

                // Converte DD/MMM/YYYY para Date
                const p = dateStr.replace(/'/g, '').split('/');
                const rowDate = new Date(`${p[1]} ${p[0]}, ${p[2]}`);

                if (rowDate >= startDate) {
                    deleteFromRow = start + j; // Linha que deve ser apagada
                } else {
                    foundBorder = true;
                    break;
                }
            }
            if (foundBorder) break;
        }

        // 5. Processamento dos Dados do Zoho
        const mapping = JSON.parse(REPORT_COLUMN_MAPPING);
        const dictionary = await (async () => {
            try {
                const r = await axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SPREADSHEET_ID}/values/'Dicionário'!A:B`, { headers: gHeaders });
                const d = {};
                if (r.data.values) r.data.values.forEach(row => d[row[0]] = row[1] || '');
                return d;
            } catch { return {}; }
        })();

        // Mapa de contagem (CONT.SES)
        const countMap = {};
        zohoRecords.forEach(rec => {
            const dR = (rec[mapping[12]] || '').split(' ')[0];
            const key = `${rec[mapping[2]]}|${dR}`;
            countMap[key] = (countMap[key] || 0) + 1;
        });

        const finalData = zohoRecords.map(rec => {
            const row = mapping.map(f => {
                let v = rec[f];
                if (typeof v === 'object' && v !== null) v = v.display_value || v.ID || String(v);
                return (typeof v === 'string' && ['=','+','-','@'].some(c => v.startsWith(c))) ? `'${v}` : v;
            });

            const [A, B, C, D, E, F, G, H, I, J, K, L, M, N, O] = row;
            const dataM_raw = (M || '').split(' ')[0];
            const dataE_raw = (E || '').split(' ')[0];
            const horaM = (M || '').split(' ')[1] || '';
            const horaE = (E || '').split(' ')[1] || '';

            const serialT = Math.floor((new Date(dataE_raw) - new Date(1899, 11, 30)) / 86400000);
            
            // FORMATAÇÕES SOLICITADAS
            const colQ = `'${serialT}${D}`; // Evita E+15 e mantém 0
            const colR = dataM_raw.replace(/-/g, '/'); // Data com /
            const colT = dataE_raw.replace(/-/g, '/'); // Data com /
            row[3] = `'${D}`; // Coluna D com 0 à esquerda

            const colP = dictionary[N] || '';
            const colS = horaM;
            const colU = horaE;
            const colV = G === "Novo serviço" ? 1 : 0;
            const colW = G === "Avaliação Store" ? 1 : 0;
            const colX = G === "Retirada" ? 1 : 0;
            const colY = G === "Garantia" ? 1 : 0;
            const colZ = countMap[`${C}|${dataM_raw}`] === 1 ? 1 : 0;
            const colAA = 1;
            const colAB = B === "Cliente realizou o serviço" ? 1 : 0;
            const colAC = O === "Cliente reagendou" ? 0 : 1;
            const colAD = B === "Cliente faltou" ? 1 : 0;
            const colAE = (B === "Cliente cancelou o serviço" && O !== "Cliente reagendou") ? 1 : 0;
            const colAF = B === "Cliente realizou o serviço" ? 1 : 0;
            const colAG = 0;
            const colAH = colR ? `${colR.split('/')[1]}/${colR.split('/')[2]}` : '';

            return [...row, colP, colQ, colR, colS, colT, colU, colV, colW, colX, colY, colZ, colAA, colAB, colAC, colAD, colAE, colAF, colAG, colAH];
        });

        // 6. Limpeza e Upload
        if (deleteFromRow <= lastRowInSheet) {
            secureLog(`Limpando da linha ${deleteFromRow} até ${lastRowInSheet}`);
            await axios.post(`https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SPREADSHEET_ID}/values/'${REPORT_SHEET_NAME}'!A${deleteFromRow}:AH${lastRowInSheet}:clear`, {}, { headers: gHeaders });
        }

        secureLog(`Fazendo upload de ${finalData.length} linhas...`);
        const batchSize = 500;
        for (let i = 0; i < finalData.length; i += batchSize) {
            const batch = finalData.slice(i, i + batchSize);
            await axios.put(`https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SPREADSHEET_ID}/values/'${REPORT_SHEET_NAME}'!A${deleteFromRow + i}?valueInputOption=USER_ENTERED`, 
                { values: batch }, { headers: gHeaders });
        }

        secureLog("Sucesso!");

    } catch (e) {
        secureLog(`ERRO: ${e.message}`, true);
        process.exit(1);
    }
}

run();
