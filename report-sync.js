const axios = require('axios');

// Função para mascarar dados sensíveis
function maskSensitiveData(data, maxLength = 8) {
    if (!data || typeof data !== 'string') return '[MASKED]';
    if (data.length <= maxLength) return '[MASKED]';
    return data.substring(0, 4) + '*'.repeat(data.length - 8) + data.substring(data.length - 4);
}

// Função para registrar eventos sem expor dados sensíveis
function secureLog(message, isError = false) {
    // Removido logging para evitar mensagens públicas no GitHub Actions
}

// Função para impedir Spreadsheet Formula Injection
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

    // Tratamento especial para Data_e_hora_de_fim_do_servi_o (Coluna F)
    if (fieldName === 'Data_e_hora_de_fim_do_servi_o' && typeof rawValue === 'string') {
        const inicio = record['Data_e_hora_de_in_cio_do_servi_o'];
        if (inicio && typeof inicio === 'string') {
            const dataPart = inicio.split(' ')[0]; // YYYY-MM-DD
            return sanitize(`${dataPart} ${rawValue}`);
        }
        return sanitize(rawValue);
    }

    // Tratamento de objetos e arrays (Fim do [object Object])
    if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        // Se for objeto, prioriza display_value, senão ID
        return sanitize(rawValue.display_value || rawValue.ID || String(rawValue));
    }

    if (Array.isArray(rawValue)) {
        // Se for array (multi-select), mapeia display_value de cada item
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
        // Autenticação Zoho
        const authRes = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
            params: {
                refresh_token: process.env.ZOHO_REFRESH_TOKEN,
                client_id: process.env.ZOHO_CLIENT_ID,
                client_secret: process.env.ZOHO_CLIENT_SECRET,
                grant_type: 'refresh_token'
            }
        });
        const zohoToken = authRes.data.access_token;

        // Configurações
        const owner = process.env.ZOHO_ACCOUNT_OWNER;
        const app = process.env.ZOHO_APP_NAME;
        const report = process.env.ZOHO_REPORT_NAME;
        const baseUrl = `https://creator.zoho.com/api/v2.1/${owner}/${app}/report/${report}`;
        const columns = JSON.parse(process.env.REPORT_COLUMN_MAPPING);

        // Calcular intervalo de datas: apenas ontem
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        // Formatar datas no formato YYYY-MM-DD 
        const formatDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const startDateStr = formatDate(yesterday);
        const endDateStr = formatDate(yesterday);

        // Critério de filtro por data (apenas ontem)
        const criteria = `(Data_e_hora_de_inicio_do_formulario >= '${startDateStr}' && Data_e_hora_de_inicio_do_formulario <= '${endDateStr}')`;

        let allRecords = [];
        let page = 1;
        const limit = 200;

        // LOOP DE PAGINAÇÃO sem limite de páginas 
        while (true) {
            const fromIndex = (page - 1) * limit + 1;

            const resp = await axios.get(baseUrl, {
                params: { 
                    from: fromIndex, 
                    limit: limit,
                    criteria: criteria
                },
                headers: { 
                    'Authorization': `Zoho-oauthtoken ${zohoToken}`,
                    'Accept': 'application/json'
                }
            });

            const records = resp.data.data || [];
            if (records.length === 0) break;

            allRecords = allRecords.concat(records);

            if (records.length < limit) break; // Se veio menos que 200, é a última página
            page++;
        }

        // Processar e Enviar para Google Sheets
        if (allRecords.length > 0) {
            const allProcessed = allRecords.map(rec => columns.map(f => processField(rec, f)));
            
            const sheetId = process.env.REPORT_SPREADSHEET_ID;
            const sheetName = process.env.REPORT_SHEET_NAME;
            
            // Usamos PUT com o range !A2 para sobrescrever os dados antigos
            // Escapar nome da aba com aspas simples se contiver espaços
            const escapedSheetName = sheetName.includes(' ') ? `'${sheetName}'` : sheetName;
            const urlSheets = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${escapedSheetName}!A2?valueInputOption=USER_ENTERED`;

            await axios.put(
                urlSheets,
                { values: allProcessed },
                { headers: { 'Authorization': `Bearer ${process.env.GOOGLE_TOKEN}` } }
            );
        }

    } catch (e) {
        console.log('Erro ao processar dados');
        process.exit(1);
    }
}
run();
