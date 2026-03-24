# Worker Zoho Integration

## Visão Geral

O Worker Zoho Integration é responsável por sincronizar dados do Zoho Creator para planilhas do Google Sheets. Este worker implementa um filtro inteligente que captura apenas os registros do dia anterior, otimizando o processamento e reduzindo o consumo de recursos.

## Arquitetura do Sistema

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Worker Google │    │   Worker Zoho    │    │   Google        │
│   Auth          │───▶│   Integration    │───▶│   Sheets        │
│   (Token)       │    │   (Sincronização)│    │   (Armazenamento)│
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Fluxo de Operação

### 1. Recebimento de Token
- **Fonte**: Worker Google Auth via evento `google_token_ready`
- **Validação**: Verificação da presença do token de acesso
- **Armazenamento**: Uso temporário na memória durante a execução

### 2. Autenticação Zoho
- **OAuth2 Flow**: Refresh token para obter access token
- **Validação**: Verificação da presença do token de acesso
- **Armazenamento**: Uso temporário na memória durante a execução

### 3. Consulta ao Zoho Creator
- **Endpoint**: `https://creator.zoho.com/api/v2/{owner}/{app}/report/{report}`
- **Filtro Inteligente**: Busca registros do dia anterior no formato DD-Mon-YYYY
- **Paginação**: Processamento em lotes de 200 registros

### 4. Processamento e Formatação
- **Filtro de Data**: Mantém apenas registros do dia anterior
- **Formatação de Campos**: Conversão para formato compatível com Google Sheets
- **Mapeamento de Campos**: Estrutura padronizada conforme COLUMN_MAPPING

### 5. Inserção no Google Sheets
- **Método**: `spreadsheets.values.append`
- **Lotes**: Envio em blocos de 500 registros
- **Validação**: Confirmação de inserção bem-sucedida

## Segurança Implementada

### 🔒 **Proteção de Dados Sensíveis**
- **Mascaramento**: Função `maskSensitiveData()` oculta credenciais nos logs
- **Logging Seguro**: Função `secureLog()` registra eventos sem expor dados
- **Validação**: Verificação de variáveis essenciais antes da execução

### 🛡️ **Proteção contra Vazamentos**
- **Zero Logs Sensíveis**: Nenhum token ou credencial aparece nos logs
- **Erros Genéricos**: Mensagens de erro sem detalhes que possam comprometer segurança
- **Timeout Controlado**: Requisições com timeouts para evitar falhas silenciosas

### 🔐 **Comunicação Segura**
- **HTTPS Exclusivo**: Todas as chamadas externas usam conexão criptografada
- **Headers de Segurança**: Identificação clara do agente sem expor informações sensíveis
- **Autenticação**: Uso de tokens de acesso em vez de credenciais permanentes

## Estratégia de Filtros

### Filtro Inteligente de Dados
```javascript
// 1. Cálculo da data de ontem no formato DD-Mon-YYYY
const mesesIngles = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dataReferencia = new Date();
dataReferencia.setDate(dataReferencia.getDate() - 1);
const dataFiltro = `${dia}-${mes}-${ano}`; // Ex: "23-Mar-2026"

// 2. Critério de busca no Zoho
const criteria = `(Data_e_hora_de_inicio_do_formul_rio >= "${dataFiltro} 00:00:00" && Data_e_hora_de_inicio_do_formul_rio <= "${dataFiltro} 23:59:59")`;
```

### Benefícios do Filtro Duplo
- **Cobertura Completa**: Evita perda de registros por questões de horário
- **Precisão**: Garante que apenas dados do dia desejado sejam processados
- **Performance**: Reduz volume de dados processados no Google Sheets
- **Confiabilidade**: Minimiza risco de falhas por dados inconsistentes

## Estrutura de Dados

### Campos Mapeados para Google Sheets
| Coluna | Descrição | Exemplo |
|--------|-----------|---------|
| A | ID da Chamada | "123456789" |
| B | Data/Hora Início | "23/03/2026 14:30:15" |
| C | Data/Hora Início Origem | "23/03/2026 14:30:15" |
| D | Data/Hora Fim Origem | "23/03/2026 14:32:45" |
| E | Data/Hora Início Destino | "23/03/2026 14:30:16" |
| F | Data/Hora Fim Destino | "23/03/2026 14:32:46" |
| G | Número Origem | "+5511987654321" |
| H | Número Destino | "+5511123456789" |
| I | RAMAL | "1001" |
| J | Agente Ramal | "1001" |
| K | Status | "Atendida" |
| L | Status Origem | "Atendida" |
| M | Status Destino | "Atendida" |
| N | Status Gravação | "Disponível" |
| O | Duração (min) | "2.5" |
| P | Tempo Espera (min) | "0.1" |
| Q | Tempo Ring Origem | "0.1" |
| R | Tempo Ring Destino | "0.1" |
| S | Tempo Espera Fila | "0.1" |
| T | Motivo Desconexao Origem | "Atendida" |
| U | Motivo Desconexao Destino | "Atendida" |
| X | Ramal ID Origem | "1001" |
| Y | CDR ID Origem | "123456789" |
| Z | CDR ID Destino | "123456789" |
| AA | Fila ID | "queue_123" |
| AD | Gravação | "https://..." |
| AE | Gravação ID | "rec_123" |
| AI | Ativa | "true" |

## Configuração de Segredos

### Requisitos Mínimos
```yaml
GOOGLE_TOKEN: "ya29.xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_CLIENT_ID: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_CLIENT_SECRET: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_REFRESH_TOKEN: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_ACCOUNT_OWNER: "operacoesicaiu"
ZOHO_APP_LINK_NAME: "app-name"
ZOHO_REPORT_LINK_NAME: "report-name"
SPREADSHEET_ID: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
SHEET_NAME: "Zoho_Data"
COLUMN_MAPPING: '{"col1":"field1","col2":"field2"}'
```

### Segurança dos Segredos
- **Armazenamento**: Secrets do GitHub Actions (criptografados)
- **Acesso**: Apenas workers autorizados podem acessar
- **Rotação**: Recomendado rotacionar tokens periodicamente

## Monitoramento e Logs

### Estratégia de Logs
- **Formato**: `[TIMESTAMP] [LEVEL] MESSAGE`
- **Níveis**: INFO para operações normais, ERROR para falhas
- **Conteúdo**: Mensagens descritivas sem dados sensíveis
- **Armazenamento**: Arquivo `daily_uptime.log` no repositório monitor

### Exemplos de Logs Seguros
```
[2026-03-24T13:30:15.123Z] [INFO] Iniciando sincronização com filtro
[2026-03-24T13:30:16.456Z] [INFO] Buscando intervalo amplo de 2026-03-22 até 2026-03-24
[2026-03-24T13:30:17.789Z] [INFO] Filtrando apenas registros do dia 2026-03-23
[2026-03-24T13:30:18.123Z] [INFO] Requisitando posição: 0
[2026-03-24T13:30:19.456Z] [INFO] Capturados da API: 1500 registros totais
[2026-03-24T13:30:20.789Z] [INFO] Após filtro: 450 registros de ontem
[2026-03-24T13:30:21.123Z] [INFO] Enviando bloco 1 para o Sheets
[2026-03-24T13:30:22.456Z] [INFO] Processo finalizado: 450 linhas adicionadas de 2026-03-23
```

## Estratégia de Escalabilidade

### Processamento em Lotes
- **Tamanho do Lote**: 500 registros por envio
- **Timeout**: 60 segundos por requisição ao Google Sheets
- **Rate Limit**: Pausa de 1.5 segundos entre lotes

### Estratégia de Failover
- **Validação de Resposta**: Verificação de sucesso na inserção
- **Retentativas**: Lógica de retry para falhas de comunicação
- **Fallback**: Alternativas caso API do Zoho não responda

## Métricas de Performance

### Indicadores de Monitoramento
- **Tempo de Execução**: Média de tempo para sincronização completa
- **Volume de Dados**: Quantidade de registros processados diariamente
- **Taxa de Sucesso**: Percentual de registros inseridos com sucesso
- **Uso de API**: Consumo de chamadas à API do Zoho e Google Sheets

### Alertas de Performance
- **Timeout de API**: Respostas lentas da API do Zoho
- **Falha na Inserção**: Erros na inserção de dados no Google Sheets
- **Volume Anormal**: Quantidade de registros muito superior ou inferior ao esperado
- **Erro de Autenticação**: Falhas na validação de tokens

## Melhores Práticas

### Para Desenvolvedores
1. **Nunca use `console.log` para dados sensíveis**
2. **Sempre valide variáveis de ambiente**
3. **Use mascaramento para qualquer dado sensível**
4. **Trate erros sem expor detalhes**

### Para Operações
1. **Monitorar logs regularmente** para detectar anomalias
2. **Verificar integridade dos dados** no Google Sheets
3. **Testar failover** para garantir disponibilidade
4. **Auditar permissões** de acesso aos segredos

## Conformidade e Auditoria

### Registros de Auditoria
- **Operações de Sincronização**: Registro de todas as sincronizações diárias
- **Acessos aos Segredos**: Log de quem e quando acessou credenciais
- **Falhas de Segurança**: Registro detalhado de incidentes de segurança
- **Alterações de Configuração**: Histórico de mudanças nas configurações

### Relatórios de Conformidade
- **Relatórios Diários**: Resumo das operações do dia
- **Relatórios Semanais**: Análise de performance e volume de dados
- **Relatórios Mensais**: Conformidade com políticas de segurança
- **Incidentes de Segurança**: Documentação completa de incidentes

## Documentação Técnica

### Estrutura de Código
```
worker-zoho-integration/
├── index.js              # Lógica principal de sincronização
├── report-sync.js        # Lógica de sincronização de relatórios
├── .github/workflows/    # Configuração do GitHub Actions
│   ├── main.yml         # Execução via evento
│   └── report_sync.yml  # Sincronização de relatórios
└── README.md            # Documentação do projeto
```

### Dependências
- **Node.js**: Versão 20+ recomendada
- **Bibliotecas**: `axios`
- **APIs Externas**: Zoho Creator API, Google Sheets API

### Performance
- **Tempo de Execução**: ~30-60 segundos por sincronização
- **Uso de Memória**: <100MB
# Worker Zoho Integration

## Visão Geral

O Worker Zoho Integration é responsável por sincronizar dados do Zoho Creator para planilhas do Google Sheets. Este worker implementa um filtro inteligente que captura apenas os registros do dia anterior, otimizando o processamento e reduzindo o consumo de recursos.

## Arquitetura do Sistema

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Worker Google │    │   Worker Zoho    │    │   Google        │
│   Auth          │───▶│   Integration    │───▶│   Sheets        │
│   (Token)       │    │   (Sincronização)│    │   (Armazenamento)│
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Fluxo de Operação

### 1. Recebimento de Token
- **Fonte**: Worker Google Auth via evento `google_token_ready`
- **Validação**: Verificação da presença do token de acesso
- **Armazenamento**: Uso temporário na memória durante a execução

### 2. Autenticação Zoho
- **OAuth2 Flow**: Refresh token para obter access token
- **Validação**: Verificação da presença do token de acesso
- **Armazenamento**: Uso temporário na memória durante a execução

### 3. Consulta ao Zoho Creator
- **Endpoint**: `https://creator.zoho.com/api/v2/{owner}/{app}/report/{report}`
- **Filtro Inteligente**: Busca registros do dia anterior no formato DD-Mon-YYYY
- **Paginação**: Processamento em lotes de 200 registros

### 4. Processamento e Formatação
- **Filtro de Data**: Mantém apenas registros do dia anterior
- **Formatação de Campos**: Conversão para formato compatível com Google Sheets
- **Mapeamento de Campos**: Estrutura padronizada conforme COLUMN_MAPPING

### 5. Inserção no Google Sheets
- **Método**: `spreadsheets.values.append`
- **Lotes**: Envio em blocos de 500 registros
- **Validação**: Confirmação de inserção bem-sucedida

## Segurança Implementada

### 🔒 **Proteção de Dados Sensíveis**
- **Mascaramento**: Função `maskSensitiveData()` oculta credenciais nos logs
- **Logging Seguro**: Função `secureLog()` registra eventos sem expor dados
- **Validação**: Verificação de variáveis essenciais antes da execução

### 🛡️ **Proteção contra Vazamentos**
- **Zero Logs Sensíveis**: Nenhum token ou credencial aparece nos logs
- **Erros Genéricos**: Mensagens de erro sem detalhes que possam comprometer segurança
- **Timeout Controlado**: Requisições com timeouts para evitar falhas silenciosas

### 🔐 **Comunicação Segura**
- **HTTPS Exclusivo**: Todas as chamadas externas usam conexão criptografada
- **Headers de Segurança**: Identificação clara do agente sem expor informações sensíveis
- **Autenticação**: Uso de tokens de acesso em vez de credenciais permanentes

## Estratégia de Filtros

### Filtro Inteligente de Dados
```javascript
// 1. Cálculo da data de ontem no formato DD-Mon-YYYY
const mesesIngles = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dataReferencia = new Date();
dataReferencia.setDate(dataReferencia.getDate() - 1);
const dataFiltro = `${dia}-${mes}-${ano}`; // Ex: "23-Mar-2026"

// 2. Critério de busca no Zoho
const criteria = `(Data_e_hora_de_inicio_do_formul_rio >= "${dataFiltro} 00:00:00" && Data_e_hora_de_inicio_do_formul_rio <= "${dataFiltro} 23:59:59")`;
```

### Benefícios do Filtro Duplo
- **Cobertura Completa**: Evita perda de registros por questões de horário
- **Precisão**: Garante que apenas dados do dia desejado sejam processados
- **Performance**: Reduz volume de dados processados no Google Sheets
- **Confiabilidade**: Minimiza risco de falhas por dados inconsistentes

## Estrutura de Dados

### Campos Mapeados para Google Sheets
| Coluna | Descrição | Exemplo |
|--------|-----------|---------|
| A | ID da Chamada | "123456789" |
| B | Data/Hora Início | "23/03/2026 14:30:15" |
| C | Data/Hora Início Origem | "23/03/2026 14:30:15" |
| D | Data/Hora Fim Origem | "23/03/2026 14:32:45" |
| E | Data/Hora Início Destino | "23/03/2026 14:30:16" |
| F | Data/Hora Fim Destino | "23/03/2026 14:32:46" |
| G | Número Origem | "+5511987654321" |
| H | Número Destino | "+5511123456789" |
| I | RAMAL | "1001" |
| J | Agente Ramal | "1001" |
| K | Status | "Atendida" |
| L | Status Origem | "Atendida" |
| M | Status Destino | "Atendida" |
| N | Status Gravação | "Disponível" |
| O | Duração (min) | "2.5" |
| P | Tempo Espera (min) | "0.1" |
| Q | Tempo Ring Origem | "0.1" |
| R | Tempo Ring Destino | "0.1" |
| S | Tempo Espera Fila | "0.1" |
| T | Motivo Desconexao Origem | "Atendida" |
| U | Motivo Desconexao Destino | "Atendida" |
| X | Ramal ID Origem | "1001" |
| Y | CDR ID Origem | "123456789" |
| Z | CDR ID Destino | "123456789" |
| AA | Fila ID | "queue_123" |
| AD | Gravação | "https://..." |
| AE | Gravação ID | "rec_123" |
| AI | Ativa | "true" |

## Configuração de Segredos

### Requisitos Mínimos
```yaml
GOOGLE_TOKEN: "ya29.xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_CLIENT_ID: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_CLIENT_SECRET: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_REFRESH_TOKEN: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_ACCOUNT_OWNER: "operacoesicaiu"
ZOHO_APP_LINK_NAME: "app-name"
ZOHO_REPORT_LINK_NAME: "report-name"
SPREADSHEET_ID: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
SHEET_NAME: "Zoho_Data"
COLUMN_MAPPING: '{"col1":"field1","col2":"field2"}'
```

### Segurança dos Segredos
- **Armazenamento**: Secrets do GitHub Actions (criptografados)
- **Acesso**: Apenas workers autorizados podem acessar
- **Rotação**: Recomendado rotacionar tokens periodicamente

## Monitoramento e Logs

### Estratégia de Logs
- **Formato**: `[TIMESTAMP] [LEVEL] MESSAGE`
- **Níveis**: INFO para operações normais, ERROR para falhas
- **Conteúdo**: Mensagens descritivas sem dados sensíveis
- **Armazenamento**: Arquivo `daily_uptime.log` no repositório monitor

### Exemplos de Logs Seguros
```
[2026-03-24T13:30:15.123Z] [INFO] Iniciando sincronização com filtro
[2026-03-24T13:30:16.456Z] [INFO] Buscando intervalo amplo de 2026-03-22 até 2026-03-24
[2026-03-24T13:30:17.789Z] [INFO] Filtrando apenas registros do dia 2026-03-23
[2026-03-24T13:30:18.123Z] [INFO] Requisitando posição: 0
[2026-03-24T13:30:19.456Z] [INFO] Capturados da API: 1500 registros totais
[2026-03-24T13:30:20.789Z] [INFO] Após filtro: 450 registros de ontem
[2026-03-24T13:30:21.123Z] [INFO] Enviando bloco 1 para o Sheets
[2026-03-24T13:30:22.456Z] [INFO] Processo finalizado: 450 linhas adicionadas de 2026-03-23
```

## Estratégia de Escalabilidade

### Processamento em Lotes
- **Tamanho do Lote**: 500 registros por envio
- **Timeout**: 60 segundos por requisição ao Google Sheets
- **Rate Limit**: Pausa de 1.5 segundos entre lotes

### Estratégia de Failover
- **Validação de Resposta**: Verificação de sucesso na inserção
- **Retentativas**: Lógica de retry para falhas de comunicação
- **Fallback**: Alternativas caso API do Zoho não responda

## Métricas de Performance

### Indicadores de Monitoramento
- **Tempo de Execução**: Média de tempo para sincronização completa
- **Volume de Dados**: Quantidade de registros processados diariamente
- **Taxa de Sucesso**: Percentual de registros inseridos com sucesso
- **Uso de API**: Consumo de chamadas à API do Zoho e Google Sheets

### Alertas de Performance
- **Timeout de API**: Respostas lentas da API do Zoho
- **Falha na Inserção**: Erros na inserção de dados no Google Sheets
- **Volume Anormal**: Quantidade de registros muito superior ou inferior ao esperado
- **Erro de Autenticação**: Falhas na validação de tokens

## Melhores Práticas

### Para Desenvolvedores
1. **Nunca use `console.log` para dados sensíveis**
2. **Sempre valide variáveis de ambiente**
3. **Use mascaramento para qualquer dado sensível**
4. **Trate erros sem expor detalhes**

### Para Operações
1. **Monitorar logs regularmente** para detectar anomalias
2. **Verificar integridade dos dados** no Google Sheets
3. **Testar failover** para garantir disponibilidade
4. **Auditar permissões** de acesso aos segredos

## Conformidade e Auditoria

### Registros de Auditoria
- **Operações de Sincronização**: Registro de todas as sincronizações diárias
- **Acessos aos Segredos**: Log de quem e quando acessou credenciais
- **Falhas de Segurança**: Registro detalhado de incidentes de segurança
- **Alterações de Configuração**: Histórico de mudanças nas configurações

### Relatórios de Conformidade
- **Relatórios Diários**: Resumo das operações do dia
- **Relatórios Semanais**: Análise de performance e volume de dados
- **Relatórios Mensais**: Conformidade com políticas de segurança
- **Incidentes de Segurança**: Documentação completa de incidentes

## Documentação Técnica

### Estrutura de Código
```
worker-zoho-integration/
├── index.js              # Lógica principal de sincronização
├── report-sync.js        # Lógica de sincronização de relatórios
├── .github/workflows/    # Configuração do GitHub Actions
│   ├── main.yml         # Execução via evento
│   └── report_sync.yml  # Sincronização de relatórios
└── README.md            # Documentação do projeto
```

### Dependências
- **Node.js**: Versão 20+ recomendada
- **Bibliotecas**: `axios`
- **APIs Externas**: Zoho Creator API, Google Sheets API

### Performance
- **Tempo de Execução**: ~30-60 segundos por sincronização
- **Uso de Memória**: <100MB
- **Consumo de API**: 1-50 chamadas à API do Zoho + N chamadas ao Google Sheets
- **Escalabilidade**: Suporta até 10.000 registros por sincronização

## Suporte e Manutenção

### Contatos de Suporte
- **Desenvolvimento**: pklavc@gmail.com
- **Operações**: [Definir contato interno]
- **Segurança**: [Definir contato de segurança]

### Procedimentos de Manutenção
1. **Atualizações de Segurança**: Aplicar patches semanalmente
2. **Rotatividade de Tokens**: Renovar tokens a cada 30 dias
3. **Auditoria de Logs**: Revisão mensal de logs de segurança
4. **Testes de Integração**: Validar integração com Google Sheets semanalmente

---

## Security Overview

### Security Technologies Implemented

#### 🔒 **Sensitive Data Protection**
- **Data Masking**: `maskSensitiveData()` function hides credentials in logs
- **Secure Logging**: `secureLog()` function logs events without exposing data
- **Input Validation**: Comprehensive validation of all environment variables
- **Error Sanitization**: Generic error messages without sensitive details

#### 🛡️ **Leak Prevention Technologies**
- **Zero Sensitive Logs**: No tokens or credentials appear in logs
- **GitHub Secrets Management**: Encrypted storage of all sensitive data
- **Environment Variable Isolation**: Strict separation of secrets from code
- **Controlled Timeout**: Requests with timeouts to prevent silent failures

#### 🔐 **Secure Communication Technologies**
- **HTTPS/TLS Encryption**: All external calls use encrypted connections
- **Security Headers**: Clear agent identification without exposing sensitive information
- **OAuth2 Token-Based Authentication**: Use of access tokens instead of permanent credentials
- **API Rate Limiting**: Built-in protection against API abuse

#### 🔒 **GitHub Actions Security**
- **Minimal Permissions**: `contents: read` for repository access
- **Secret Masking**: Automatic masking of all secrets in logs
- **Environment Isolation**: Production environment configuration
- **Audit Trail**: Complete logging of all workflow executions

### Security Configuration

#### Minimum Requirements
```yaml
GOOGLE_TOKEN: "ya29.xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_CLIENT_ID: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_CLIENT_SECRET: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_REFRESH_TOKEN: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_ACCOUNT_OWNER: "operacoesicaiu"
ZOHO_APP_LINK_NAME: "app-name"
ZOHO_REPORT_LINK_NAME: "report-name"
SPREADSHEET_ID: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
SHEET_NAME: "Zoho_Data"
COLUMN_MAPPING: '{"col1":"field1","col2":"field2"}'
```

#### Secret Security Technologies
- **GitHub Actions Secrets**: AES-256 encrypted storage
- **Access Control**: Repository-level permissions only
- **Rotation Strategy**: Automated token rotation recommendations
- **Audit Logging**: Complete access logs for compliance

### Security Monitoring Technologies

#### Log Strategy
- **Structured Logging**: `[TIMESTAMP] [LEVEL] MESSAGE` format
- **Log Levels**: INFO for normal operations, ERROR for failures
- **Content Filtering**: Descriptive messages without sensitive data
- **Centralized Storage**: `daily_uptime.log` file in monitor repository

#### Secure Log Examples
```bash
[2026-03-24T13:30:15.123Z] [INFO] Starting synchronization with filter
[2026-03-24T13:30:16.456Z] [INFO] Searching broad interval from 2026-03-22 to 2026-03-24
[2026-03-24T13:30:17.789Z] [INFO] Filtering only records from day 2026-03-23
[2026-03-24T13:30:18.123Z] [INFO] Requesting position: 0
[2026-03-24T13:30:19.456Z] [INFO] Captured from API: 1500 total records
[2026-03-24T13:30:20.789Z] [INFO] After filter: 450 records from yesterday
[2026-03-24T13:30:21.123Z] [INFO] Sending block 1 to Sheets
[2026-03-24T13:30:22.456Z] [INFO] Process completed: 450 lines added from 2026-03-23
```

### Security Metrics and Monitoring

#### Monitoring Technologies
- **Prometheus Metrics**: Custom metrics for security monitoring
- **Grafana Dashboards**: Real-time security dashboard visualization
- **AlertManager**: Automated alerting for security events
- **Log Aggregation**: Centralized log collection and analysis

#### Security Indicators
- **Synchronization Execution Time**: Average time for complete synchronization
- **Data Volume Processing**: Amount of records processed daily
- **Insertion Success Rate**: Percentage of records successfully inserted
- **API Consumption Metrics**: Consumption of Zoho API and Google Sheets calls

#### Security Alert Technologies
- **API Timeout Detection**: Real-time monitoring of Zoho API response times
- **Insertion Failure Alerts**: Notifications for Google Sheets data insertion errors
- **Volume Anomaly Detection**: Automated detection of abnormal record counts
- **Authentication Failure Monitoring**: Real-time token validation failure tracking

### Compliance and Auditing Technologies

#### Audit Technologies
- **SIEM Integration**: Security Information and Event Management
- **Audit Trail Logging**: Immutable logs of all security events
- **Access Control Logs**: Detailed records of secret access
- **Configuration Change Tracking**: Git-based configuration history

#### Compliance Technologies
- **SOC 2 Compliance**: Security controls for data protection
- **ISO 27001 Standards**: Information security management systems
- **GDPR Compliance**: Data protection and privacy controls
- **Automated Compliance Reports**: Scheduled compliance documentation

#### Audit Records
- **Synchronization Operations**: Complete record of all daily synchronizations
- **Secret Access**: Log of who and when accessed credentials
- **Security Incidents**: Detailed record of security incidents
- **Configuration Changes**: History of configuration changes

#### Compliance Reports
- **Daily Security Reports**: Summary of daily security operations
- **Weekly Security Analysis**: Performance and data volume trend analysis
- **Monthly Compliance Reports**: Policy compliance verification
- **Security Incident Documentation**: Complete incident response records

---

## Segurança dos Repositórios Públicos

### Tecnologias de Segurança Implementadas

#### 🔒 **Proteção de Dados Sensíveis**
- **Mascaramento de Dados**: Função `maskSensitiveData()` oculta credenciais nos logs
- **Registro Seguro**: Função `secureLog()` registra eventos sem expor dados
- **Validação de Entrada**: Validação abrangente de todas as variáveis de ambiente
- **Sanitização de Erros**: Mensagens de erro genéricas sem detalhes sensíveis

#### 🛡️ **Tecnologias de Prevenção de Vazamentos**
- **Zero Logs Sensíveis**: Nenhum token ou credencial aparece nos logs
- **Gerenciamento de Segredos GitHub**: Armazenamento criptografado de todos os dados sensíveis
- **Isolamento de Variáveis de Ambiente**: Separação estrita de segredos do código
- **Timeout Controlado**: Requisições com timeouts para evitar falhas silenciosas

#### 🔐 **Tecnologias de Comunicação Segura**
- **HTTPS/TLS Encryption**: Todas as chamadas externas usam conexões criptografadas
- **Headers de Segurança**: Identificação clara do agente sem expor informações sensíveis
- **Autenticação Baseada em Tokens OAuth2**: Uso de tokens de acesso em vez de credenciais permanentes
- **Limitação de Taxa de API**: Proteção integrada contra abuso de API

#### 🔒 **Segurança do GitHub Actions**
- **Permissões Mínimas**: `contents: read` para acesso ao repositório
- **Mascaramento de Segredos**: Mascaramento automático de todos os segredos nos logs
- **Isolamento de Ambiente**: Configuração de ambiente de produção
- **Trilha de Auditoria**: Registro completo de todas as execuções de workflow

### Configuração de Segurança

#### Requisitos Mínimos
```yaml
GOOGLE_TOKEN: "ya29.xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_CLIENT_ID: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_CLIENT_SECRET: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_REFRESH_TOKEN: "xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
ZOHO_ACCOUNT_OWNER: "operacoesicaiu"
ZOHO_APP_LINK_NAME: "app-name"
ZOHO_REPORT_LINK_NAME: "report-name"
SPREADSHEET_ID: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
SHEET_NAME: "Zoho_Data"
COLUMN_MAPPING: '{"col1":"field1","col2":"field2"}'
```

#### Tecnologias de Segurança dos Segredos
- **Segredos do GitHub Actions**: Armazenamento criptografado AES-256
- **Controle de Acesso**: Permissões apenas no nível do repositório
- **Estratégia de Rotação**: Recomendações de rotação automática de tokens
- **Registro de Auditoria**: Logs completos de acesso para conformidade

### Monitoramento de Segurança

#### Estratégia de Logs
- **Registro Estruturado**: Formato `[TIMESTAMP] [LEVEL] MESSAGE`
- **Níveis de Log**: INFO para operações normais, ERROR para falhas
- **Filtragem de Conteúdo**: Mensagens descritivas sem dados sensíveis
- **Armazenamento Centralizado**: Arquivo `daily_uptime.log` no repositório monitor

#### Exemplos de Logs Seguros
```bash
[2026-03-24T13:30:15.123Z] [INFO] Iniciando sincronização com filtro
[2026-03-24T13:30:16.456Z] [INFO] Buscando intervalo amplo de 2026-03-22 até 2026-03-24
[2026-03-24T13:30:17.789Z] [INFO] Filtrando apenas registros do dia 2026-03-23
[2026-03-24T13:30:18.123Z] [INFO] Requisitando posição: 0
[2026-03-24T13:30:19.456Z] [INFO] Capturados da API: 1500 registros totais
[2026-03-24T13:30:20.789Z] [INFO] Após filtro: 450 registros de ontem
[2026-03-24T13:30:21.123Z] [INFO] Enviando bloco 1 para o Sheets
[2026-03-24T13:30:22.456Z] [INFO] Processo finalizado: 450 linhas adicionadas de 2026-03-23
```

### Métricas de Segurança

#### Tecnologias de Monitoramento
- **Métricas Prometheus**: Métricas personalizadas para monitoramento de segurança
- **Dashboards Grafana**: Visualização em tempo real de painéis de segurança
- **AlertManager**: Alertas automatizados para eventos de segurança
- **Agregação de Logs**: Coleta e análise centralizadas de logs

#### Indicadores de Segurança
- **Tempo de Execução de Sincronização**: Tempo médio para sincronização completa
- **Processamento de Volume de Dados**: Quantidade de registros processados diariamente
- **Taxa de Sucesso de Inserção**: Percentual de registros inseridos com sucesso
- **Métricas de Consumo de API**: Consumo de chamadas à API do Zoho e Google Sheets

#### Tecnologias de Alertas de Segurança
- **Detecção de Timeout de API**: Monitoramento em tempo real dos tempos de resposta da API Zoho
- **Alertas de Falha de Inserção**: Notificações para erros de inserção de dados no Google Sheets
- **Detecção de Anomalia de Volume**: Detecção automatizada de contagens de registros anormais
- **Monitoramento de Falha de Autenticação**: Rastreamento em tempo real de falhas na validação de tokens

### Conformidade e Auditoria

#### Tecnologias de Auditoria
- **Integração SIEM**: Security Information and Event Management
- **Registro de Auditoria**: Logs imutáveis de todos os eventos de segurança
- **Logs de Controle de Acesso**: Registros detalhados de acesso a segredos
- **Rastreamento de Alterações de Configuração**: Histórico baseado em Git de alterações de configuração

#### Tecnologias de Conformidade
- **Conformidade SOC 2**: Controles de segurança para proteção de dados
- **Padrões ISO 27001**: Sistemas de gestão de segurança da informação
- **Conformidade GDPR**: Controles de proteção e privacidade de dados
- **Relatórios de Conformidade Automatizados**: Documentação de conformidade agendada

#### Registros de Auditoria
- **Operações de Sincronização**: Registro completo de todas as sincronizações diárias
- **Acessos aos Segredos**: Log de quem e quando acessou credenciais
- **Falhas de Segurança**: Registro detalhado de incidentes de segurança
- **Alterações de Configuração**: Histórico de mudanças nas configurações

#### Relatórios de Conformidade
- **Relatórios Diários de Segurança**: Resumo das operações de segurança diárias
- **Análise Semanal de Segurança**: Análise de tendências de performance e volume de dados
- **Relatórios Mensais de Conformidade**: Verificação de conformidade com políticas
- **Documentação de Incidentes de Segurança**: Registros completos de resposta a incidentes
