const axios = require('axios');

// Função para registrar eventos de forma segura
function secureLog(message, isError = false) {
    const timestamp = new Date().toISOString();
    const logLevel = isError ? 'ERROR' : 'INFO';
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
            if (typeof v === 'object') return v.display_value || v.ID || String(v);
            return v;
        }).join(', '));
    }

    return sanitize(String(rawValue));
}

async function run() {
    try {
        secureLog('Iniciando sincronização (Lógica: Mês Anterior Dia 01 até Hoje)');

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

        // 2. Cálculo de Datas (Tradução exata do Python: start_date = (today - relativedelta(months=1)).replace(day=1))
        const today = new Date();
        const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        
        // Formato Zoho: DD-Mon-YYYY (Ex: 01-Feb-2026)
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const formatZohoDate = (date) => {
            const d = String(date.getDate()).padStart(2, '0');
            const m = months[date.getMonth()];
            const y = date.getFullYear();
            return `${d}-${m}-${y}`;
        };

        const startStr = formatZohoDate(startDate);
        const endStr = formatZohoDate(today);
        
        const criteria = `(Data_e_hora_de_inicio_do_formulario >= '${startStr}' && Data_e_hora_de_inicio_do_formulario <= '${endStr}')`;
        secureLog(`Critério de filtro: ${criteria}`);

        // 3. Busca de Dados (Limite de 50 páginas)
        let allRecords = [];
        let page = 1;
        const limit = 200;
        const maxPages = 50; 
        const baseUrl = `https://creator.zoho.com/api/v2.1/${process.env.ZOHO_ACCOUNT_OWNER}/${process.env.ZOHO_APP_NAME}/report/${process.env.ZOHO_REPORT_NAME}`;

        while (page <= maxPages) {
            const fromIndex = (page - 1) * limit + 1;
            try {
                const resp = await axios.get(baseUrl, {
                    params: { from: fromIndex, limit: limit, criteria: criteria },
                    headers: { 'Authorization': `Zoho-oauthtoken ${zohoToken}`, 'Accept': 'application/json' }
                });

                const records = resp.data.data || [];
                if (records.length === 0) break;

                allRecords = allRecords.concat(records);
                secureLog(`Página ${page}: ${records.length} registros recuperados.`);
                
                if (records.length < limit) break;
                page++;
            } catch (err) {
                // Se der erro 9280 (No records matching), encerramos o loop em vez de travar o script
                if (err.response && err.response.data && err.response.data.code === 9280) {
                    secureLog('Nenhum registro adicional encontrado.');
                    break;
                }
                throw err;
            }
        }

        // 4. Envio para Google Sheets
        if (allRecords.length > 0) {
            secureLog(`Processando ${allRecords.length} registros para o Google Sheets...`);
            const columns = JSON.parse(process.env.REPORT_COLUMN_MAPPING);
            const allProcessed = allRecords.map(rec => columns.map(f => processField(rec, f)));
            
            const sheetId = process.env.REPORT_SPREADSHEET_ID;
            const sheetName = process.env.REPORT_SHEET_NAME;
            const escapedSheetName = sheetName.includes(' ') ? `'${sheetName}'` : sheetName;
            
            // PUT sobrescreve a base inteira no Sheets com o novo período de 2 meses
            const urlSheets = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${escapedSheetName}!A2?valueInputOption=USER_ENTERED`;

            await axios.put(
                urlSheets,
                { values: allProcessed },
                { headers: { 'Authorization': `Bearer ${process.env.GOOGLE_TOKEN}` } }
            );
            secureLog(`Sincronização concluída: ${allRecords.length} linhas enviadas.`);
        } else {
            secureLog('Sincronização finalizada: nenhum dado encontrado no período.');
        }

    } catch (e) {
        let errorDetail = e.message;
        if (e.response && e.response.data) {
            errorDetail = `API_ERROR: ${JSON.stringify(e.response.data)}`;
        }
        secureLog(`Falha no processamento: ${errorDetail}`, true);
        process.exit(1);
    }
}

run();
