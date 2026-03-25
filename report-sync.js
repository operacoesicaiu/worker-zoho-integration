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
        
        // Proteção essencial para o nome da aba
        const safeSheet = `'${REPORT_SHEET_NAME}'`;

        // 1. Token Zoho
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

        // 3. Coleta Zoho
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
        secureLog(`Registros Zoho: ${zohoRecords.length}`);

        // 4. Localizar linha de corte (Busca Reversa Simples)
        const resR = await axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SPREADSHEET_ID}/values/${safeSheet}!R:R`, { headers: gHeaders });
        const allDates = resR.data.values || [];
        let deleteFromRow = allDates.length + 1;

        for (let i = allDates.length - 1; i >= 1; i--) {
            const dateStr = allDates[i][0];
            if (!dateStr) continue;
            const p = dateStr.replace(/'/g, '').split('/');
            if (p.length < 3) continue;
            const rowDate = new Date(`${p[1]} ${p[0]}, ${p[2]}`);
            if (rowDate >= startDate) deleteFromRow = i + 1;
            else break;
        }

        // 5. Processamento (Formatos / e ')
        const mapping = JSON.parse(REPORT_COLUMN_MAPPING);
        const dictRes = await axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SPREADSHEET_ID}/values/'Dicionário'!A:B`, { headers: gHeaders }).catch(() => ({data:{}}));
        const dictionary = {};
        if (dictRes.data.values) dictRes.data.values.forEach(r => dictionary[r[0]] = r[1]);

        const countMap = {};
        zohoRecords.forEach(rec => {
            const dR = (rec[mapping[12]] || '').split(' ')[0];
            const key = `${rec[mapping[2]]}|${dR}`;
            countMap[key] = (countMap[key] || 0) + 1;
        });

        const finalData = zohoRecords.map(rec => {
            const row = mapping.map(f => {
                let v = rec[f] ?? '';
                if (typeof v === 'object') v = v.display_value || v.ID || String(v);
                return v;
            });

            const [A, B, C, D, E, F, G, H, I, J, K, L, M, N, O] = row;
            const dM = (M || '').split(' ')[0] || '';
            const dE = (E || '').split(' ')[0] || '';
            const serialT = dE ? Math.floor((new Date(dE) - new Date(1899, 11, 30)) / 86400000) : '';

            // Aplicando suas regras
            const colQ = `'${serialT}${D}`;
            const colR = dM.replace(/-/g, '/');
            const colT = dE.replace(/-/g, '/');
            row[3] = `'${D}`; // Coluna D original

            const colP = dictionary[N] || '';
            const colS = (M || '').split(' ')[1] || '';
            const colU = (E || '').split(' ')[1] || '';
            const colV = G === "Novo serviço" ? 1 : 0;
            const colW = G === "Avaliação Store" ? 1 : 0;
            const colX = G === "Retirada" ? 1 : 0;
            const colY = G === "Garantia" ? 1 : 0;
            const colZ = countMap[`${C}|${dM}`] === 1 ? 1 : 0;
            const colAA = 1;
            const colAB = B === "Cliente realizou o serviço" ? 1 : 0;
            const colAC = O === "Cliente reagendou" ? 0 : 1;
            const colAD = B === "Cliente faltou" ? 1 : 0;
            const colAE = (B === "Cliente cancelou o serviço" && O !== "Cliente reagendou") ? 1 : 0;
            const colAF = B === "Cliente realizou o serviço" ? 1 : 0;
            const colAG = 0;
            const colAH = colR.includes('/') ? `${colR.split('/')[1]}/${colR.split('/')[2]}` : '';

            return [...row, colP, colQ, colR, colS, colT, colU, colV, colW, colX, colY, colZ, colAA, colAB, colAC, colAD, colAE, colAF, colAG, colAH];
        });

        // 6. Limpeza e Upload
        if (deleteFromRow <= allDates.length) {
            secureLog(`Limpando a partir da linha ${deleteFromRow}`);
            const rangeClear = `${safeSheet}!A${deleteFromRow}:AH${allDates.length}`;
            await axios.post(`https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SPREADSHEET_ID}/values/${rangeClear}:clear`, {}, { headers: gHeaders });
        }

        secureLog(`Enviando ${finalData.length} linhas...`);
        const batchSize = 500;
        for (let i = 0; i < finalData.length; i += batchSize) {
            const batch = finalData.slice(i, i + batchSize);
            const rangeUpload = `${safeSheet}!A${deleteFromRow + i}`;
            await axios.put(`https://sheets.googleapis.com/v4/spreadsheets/${REPORT_SPREADSHEET_ID}/values/${rangeUpload}?valueInputOption=USER_ENTERED`, 
                { values: batch }, { headers: gHeaders });
        }

        secureLog("Sincronização concluída com sucesso!");

    } catch (e) {
        secureLog(`ERRO: ${e.response ? JSON.stringify(e.response.data) : e.message}`, true);
        process.exit(1);
    }
}

run();
