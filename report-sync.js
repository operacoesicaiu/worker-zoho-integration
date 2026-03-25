const axios = require('axios');

// Função para mascarar dados sensíveis (evita vazamentos em logs)
function maskSensitiveData(data, maxLength = 8) {
    if (!data || typeof data !== 'string') return '[MASKED]';
    if (data.length <= maxLength) return '[MASKED]';
    return data.substring(0, 4) + '*'.repeat(data.length - 8) + data.substring(data.length - 4);
}

// Função para registrar eventos de forma segura
function secureLog(message, isError = false) {
    const timestamp = new Date().toISOString();
    const logLevel = isError ? 'ERROR' : 'INFO';
    // Remove qualquer menção direta a tokens reais caso tenham sido passados por engano na mensagem
    const cleanMessage = message.replace(/[a-zA-Z0-9]{20,}/g, '[LONG_STRING_MASKED]');
    console.log(`[${timestamp}] [${logLevel}] ${cleanMessage}`);
}

function sanitize(val) {
    if (typeof val !== 'string') return val;
    const formulaChars = ['=', '+', '-', '@'];
    if (formulaChars.some(char => val.startsWith(char))) {
        return `'${val}`;
    }
    return val;
}

function processField(record, fieldName) {
    let rawValue = record[fieldName];
    if (rawValue === null || rawValue === undefined || rawValue === '') return '';

    if (fieldName.includes('Telefone_de_contato') && typeof rawValue === 'string') {
        if (rawValue.startsWith('+')) return rawValue.substring(1);
    }

    if (fieldName === 'Data_e_hora_de_fim_do_servi_o' && typeof rawValue === 'string') {
        const inicio = record['Data_e_hora_de_in_cio_do_servi_o'];
        if (inicio && typeof inicio === 'string') {
            const dataPart = inicio.split(' ')[0];
            return sanitize(`${dataPart} ${rawValue}`);
        }
        return sanitize(rawValue);
    }

    if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        return sanitize(rawValue.display_value || rawValue.ID || String(rawValue));
    }

    if (Array.isArray(rawValue)) {
        return sanitize(rawValue.map(v => {
            if (typeof v === 'object') {
                return v.display_value || v.ID || String(v);
            }
            return v;
        }).join(', '));
    }

    return sanitize(String(rawValue));
}

async function run() {
    try {
        secureLog('Iniciando processo de sincronização...');

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
        secureLog('Autenticação Zoho realizada com sucesso.');

        // 2. Configurações
        const columns = JSON.parse(process.env.REPORT_COLUMN_MAPPING);
        const baseUrl = `https://creator.zoho.com/api/v2.1/${process.env.ZOHO_ACCOUNT_OWNER}/${process.env.ZOHO_APP_NAME}/report/${process.env.ZOHO_REPORT_NAME}`;

        // 3. Datas
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const formatDate = (date) => date.toISOString().split('T')[0];
        const dateStr = formatDate(yesterday);
        
        const criteria = `(Data_e_hora_de_inicio_do_formulario >= '${dateStr}' && Data_e_hora_de_inicio_do_formulario <= '${dateStr}')`;
        secureLog(`Buscando dados para a data: ${dateStr}`);

        // 4. Busca de Dados (Paginação)
        let allRecords = [];
        let page = 1;
        const limit = 200;

        while (true) {
            const fromIndex = (page - 1) * limit + 1;
            const resp = await axios.get(baseUrl, {
                params: { from: fromIndex, limit: limit, criteria: criteria },
                headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}`, 'Accept': 'application/json' }
            });

            const records = resp.data.data || [];
            if (records.length === 0) break;

            allRecords = allRecords.concat(records);
            secureLog(`Página ${page}: ${records.length} registros encontrados.`);
            
            if (records.length < limit) break;
            page++;
        }

        // 5. Envio para Google Sheets
        if (allRecords.length > 0) {
            secureLog(`Processando ${allRecords.length} registros para o Google Sheets...`);
            const allProcessed = allRecords.map(rec => columns.map(f => processField(rec, f)));
            
            const sheetId = process.env.REPORT_SPREADSHEET_ID;
            const sheetName = process.env.REPORT_SHEET_NAME;
            const escapedSheetName = sheetName.includes(' ') ? `'${sheetName}'` : sheetName;
            const urlSheets = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${escapedSheetName}!A2?valueInputOption=USER_ENTERED`;

            await axios.put(
                urlSheets,
                { values: allProcessed },
                { headers: { 'Authorization': `Bearer ${process.env.GOOGLE_TOKEN}` } }
            );
            secureLog('Dados enviados com sucesso para o Google Sheets.');
        } else {
            secureLog('Nenhum registro encontrado para sincronizar.');
        }

    } catch (e) {
        // Tratamento de erro detalhado e seguro
        let errorDetail = e.message;
        if (e.response && e.response.data) {
            // Se o Zoho ou Google retornar erro, pegamos a mensagem da API
            errorDetail = `API_ERROR: ${JSON.stringify(e.response.data)}`;
        }
        
        secureLog(`Falha no processamento: ${errorDetail}`, true);
        process.exit(1);
    }
}

run();
