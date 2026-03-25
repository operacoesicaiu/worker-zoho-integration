const axios = require('axios');

function secureLog(message, isError = false) {
    const timestamp = new Date().toISOString();
    const logLevel = isError ? 'ERROR' : 'INFO';
    const cleanMessage = message.replace(/[a-zA-Z0-9]{20,}/g, '[MASKED]');
    console.log(`[${timestamp}] [${logLevel}] ${cleanMessage}`);
}

function sanitize(val) {
    if (typeof val !== 'string') return val;
    const formulaChars = ['=', '+', '-', '@'];
    if (formulaChars.some(char => val.startsWith(char))) return `'${val}`;
    return val;
}

// Auxiliar para Split de Data/Hora (Simula o SPLIT do Excel)
function getSplitDateTime(val, index) {
    if (!val || typeof val !== 'string') return '';
    const parts = val.split(' ');
    return parts[index] || '';
}

async function getDictionary(sheetId, googleToken) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/'Dicionário'!A:B`;
    try {
        const res = await axios.get(url, { headers: { 'Authorization': `Bearer ${googleToken}` } });
        const dict = {};
        if (res.data.values) {
            res.data.values.forEach(row => {
                if (row[0]) dict[row[0]] = row[1] || '';
            });
        }
        return dict;
    } catch (e) {
        secureLog('Erro ao carregar Dicionário. Prosseguindo vazio.', true);
        return {};
    }
}

function processField(record, fieldName) {
    let rawValue = record[fieldName];
    if (rawValue === null || rawValue === undefined || rawValue === '') return '';
    if (fieldName.includes('Telefone_de_contato') && typeof rawValue === 'string') {
        if (rawValue.startsWith('+')) return rawValue.substring(1);
    }
    if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        return sanitize(rawValue.display_value || rawValue.ID || String(rawValue));
    }
    if (Array.isArray(rawValue)) {
        return sanitize(rawValue.map(v => (typeof v === 'object' ? v.display_value || v.ID : v)).join(', '));
    }
    return sanitize(String(rawValue));
}

async function run() {
    try {
        secureLog('Iniciando sincronização com Colunas Calculadas...');

        // 1. Tokens e Dicionário
        const authRes = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: process.env.ZOHO_REFRESH_TOKEN,
                client_id: process.env.ZOHO_CLIENT_ID,
                client_secret: process.env.ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            }
        });
        const zohoToken = authRes.data.access_token;
        const dictionary = await getDictionary(process.env.REPORT_SPREADSHEET_ID, process.env.GOOGLE_TOKEN);

        // 2. Datas e Critério
        const today = new Date();
        const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const formatZohoDate = (d) => `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
        
        const criteria = `(Data_e_hora_de_inicio_do_formulario >= "${formatZohoDate(startDate)}" && Data_e_hora_de_inicio_do_formulario <= "${formatZohoDate(today)}")`;

        // 3. Coleta de Dados
        let allRecords = [];
        let fromIndex = 1;
        const limit = 200;
        const baseUrl = `https://creator.zoho.com/api/v2/${process.env.ZOHO_ACCOUNT_OWNER}/${process.env.ZOHO_APP_NAME}/report/${process.env.ZOHO_REPORT_NAME}`;

        while (allRecords.length < 10000) {
            const resp = await axios.get(baseUrl, {
                params: { from: fromIndex, limit: limit, criteria: criteria },
                headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}` }
            });
            const records = resp.data.data || [];
            if (records.length === 0) break;
            allRecords = allRecords.concat(records);
            if (records.length < limit) break;
            fromIndex += limit;
        }

        // 4. Processamento das Colunas (A até O baseadas no Zoho, P em diante calculadas)
        const columnsMapping = JSON.parse(process.env.REPORT_COLUMN_MAPPING);
        
        // Mapa para CONT.SES (Coluna Z) - Conta ocorrências de (C + R)
        const countMap = {};
        const preProcessed = allRecords.map(rec => {
            const row = columnsMapping.map(f => processField(rec, f));
            const dataR = getSplitDateTime(row[12], 0); // Coluna M (índice 12)
            const key = `${row[2]}|${dataR}`; // Chave: Coluna C + Data da M
            countMap[key] = (countMap[key] || 0) + 1;
            return { row, dataR, key };
        });

        const finalData = preProcessed.map(({ row, dataR, key }) => {
            // Referências amigáveis baseadas no seu pedido (índice = letra - 1)
            const B = row[1], C = row[2], D = row[3], E = row[4], G = row[6], M = row[12], N = row[13], O = row[14];

            const colP = dictionary[N] || ''; // PROCV(N;Dicionário)
            const colT = getSplitDateTime(E, 0); // Split E (Data)
            // Cálculo para converter a data de 'colT' no número serial do Excel
            const colT_serial = Math.floor((new Date(colT) - new Date(1899, 11, 30)) / (24 * 60 * 60 * 1000));
            const colQ = colT_serial.toString() + D.toString(); // T & D
            const colR = dataR;                  // Split M (Data)
            const colS = getSplitDateTime(M, 1); // Split M (Hora)
            const colU = getSplitDateTime(E, 1); // Split E (Hora)
            
            const colV = G === "Novo serviço" ? 1 : 0;
            const colW = G === "Avaliação Store" ? 1 : 0;
            const colX = G === "Retirada" ? 1 : 0;
            const colY = G === "Garantia" ? 1 : 0;
            const colZ = countMap[key] === 1 ? 1 : 0; // CONT.SES
            const colAA = 1;
            const colAB = B === "Cliente realizou o serviço" ? 1 : 0;
            const colAC = O === "Cliente reagendou" ? 0 : 1;
            const colAD = B === "Cliente faltou" ? 1 : 0;
            const colAE = (B === "Cliente cancelou o serviço" && O !== "Cliente reagendou") ? 1 : 0;
            const colAF = B === "Cliente realizou o serviço" ? 1 : 0;
            const colAG = 0;

            // MÊS(R) & "/" & ANO(R)
            let colAH = "";
            if (colR) {
                const parts = colR.split('-'); // Esperado DD-MMM-YYYY ou similar
                if (parts.length === 3) colAH = `${parts[1]}/${parts[2]}`;
            }

            return [...row, colP, colQ, colR, colS, colT, colU, colV, colW, colX, colY, colZ, colAA, colAB, colAC, colAD, colAE, colAF, colAG, colAH];
        });

        // 5. Upload
        const sheetId = process.env.REPORT_SPREADSHEET_ID;
        const sheetName = process.env.REPORT_SHEET_NAME;
        const urlSheets = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/'${sheetName}'!A2?valueInputOption=USER_ENTERED`;

        await axios.put(urlSheets, { values: finalData }, {
            headers: { 'Authorization': `Bearer ${process.env.GOOGLE_TOKEN}` }
        });

        secureLog(`Sincronização completa: ${finalData.length} linhas enviadas.`);

    } catch (e) {
        secureLog(`Erro: ${e.message}`, true);
        process.exit(1);
    }
}

run();
