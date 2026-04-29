const cds = require('@sap/cds');

// ── Constantes ────────────────────────────────────────────────────────────────
const AICORE_BASE_URL = process.env.AICORE_BASE_URL;
const GPT4O_DEPLOYMENT = 'd6196af63e85ae19';
const EMBEDDING_DEPLOYMENT = 'd0e42e378b39f795';
const RESOURCE_GROUP = 'default';
const MAX_TOOL_ITERATIONS = 5;

// ── Definición de tools ───────────────────────────────────────────────────────
const AGENT_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'query_pnl',
            description: `Consulta datos exactos de P&L desde HANA Cloud. 
Usa para preguntas sobre Revenue, Costos, Márgenes o Net Income de una entidad específica.`,
            parameters: {
                type: 'object',
                properties: {
                    entity: { type: 'string', description: 'AR, UK, US, ZA' },
                    period: { type: 'string', description: 'YYYY-MM para mes, YYYY para año completo' },
                    account: { type: 'string', description: 'PL010=Revenue, PL110=Gross Profit, PL120=OpEx, PL510=Net Income. Opcional.' },
                    prodline: { type: 'string', description: 'MER, SUN, VEN, MAR, JUP, etc. Opcional.' }
                },
                required: ['entity', 'period']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'query_all_entities',
            description: 'Consulta y compara datos de todas las entidades. Usa para rankings o comparaciones globales.',
            parameters: {
                type: 'object',
                properties: {
                    period: { type: 'string', description: 'YYYY-MM o YYYY' },
                    account: { type: 'string', description: 'PL010, PL110, PL510, etc.' }
                },
                required: ['period', 'account']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'query_top_products',
            description: 'Ranking de productos por métrica financiera. Usa para encontrar el mejor/peor producto.',
            parameters: {
                type: 'object',
                properties: {
                    entity: { type: 'string', description: 'AR, UK, US, ZA' },
                    period: { type: 'string', description: 'YYYY-MM o YYYY' },
                    account: { type: 'string', description: 'PL010, PL110, PL510, etc.' },
                    limit: { type: 'number', description: 'Cuántos productos mostrar (default 5)' }
                },
                required: ['entity', 'period', 'account']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_context',
            description: 'Busca contexto semántico sobre productos o categorías. Usa para describir qué es un producto.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Texto de búsqueda' }
                },
                required: ['query']
            }
        }
    }
];

const SYSTEM_PROMPT = `Eres un CFO AI Agent experto en análisis financiero P&L de SAP Analytics Cloud.
Tienes acceso a datos reales de 2018 a 2020 para AR (Argentina), UK (England), US (United States), ZA (South Africa).

MODELO P&L:
- PL010 = Product Sales (Revenue)
- PL020 = Services Sales
- PL110 = Material Cost (Gross Profit — más negativo = mayor margen)
- PL120 = Labor Cost (OpEx)
- PL510 = Financial Income/Expense (Net Income)
- NF010 = Nr Units

PRODUCTOS: FPS: SUN, MER, VEN, EAR | RPG: MAR, JUP | Sports: SAT, URA, NEP, CER, PAL | Strategy: JUN, VES, PLU, MOO

REGLAS:
1. SIEMPRE usa tools para obtener datos — nunca inventes números
2. Puedes encadenar múltiples tools para preguntas complejas
3. Valores negativos en SAP = ingresos (convención SAP)
4. Responde en español, tono ejecutivo, con datos concretos`;

// ── Módulo principal ──────────────────────────────────────────────────────────
module.exports = cds.service.impl(async function () {
    const { Conversations } = this.entities;

    this.on('ask', async (req) => {
        const { question, sessionId } = req.data;
        if (!question) return req.error(400, 'question es requerido');

        try {
            const token = await getAICoreToken();
            const result = await runAgent(question, token);

            await INSERT.into(Conversations).entries({
                sessionId: sessionId || 'default',
                question,
                answer: result.answer,
                model: result.model,
                createdAt: new Date(),
                tokensUsed: result.tokensUsed
            });

            return {
                answer: result.answer,
                model: result.model,
                tokensUsed: result.tokensUsed,
                reasoning: result.reasoning
            };

        } catch (err) {
            console.error('Error en ask:', err);
            return req.error(500, err.message);
        }
    });
});

// ── Agent loop ────────────────────────────────────────────────────────────────
async function runAgent(question, token) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: question }
    ];

    let totalTokens = 0;
    let model = 'gpt-4o';
    let iterations = 0;
    const reasoning = [];

    while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;

        const response = await callGPT4o(messages, token);
        totalTokens += response.usage?.total_tokens || 0;
        model = response.model;

        const choice = response.choices[0];
        const assistantMessage = choice.message;
        messages.push(assistantMessage);

        if (choice.finish_reason === 'tool_calls' && assistantMessage.tool_calls) {
            console.log(`[Agent] Iteración ${iterations}: ${assistantMessage.tool_calls.length} tool(s)`);

            const toolResults = await Promise.all(
                assistantMessage.tool_calls.map(async (toolCall) => {
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`[Tool] ${toolCall.function.name}(${JSON.stringify(args)})`);

                    const startTime = Date.now();
                    const result = await executeTool(toolCall.function.name, args, token);
                    const elapsed = Date.now() - startTime;

                    // Guardar paso de razonamiento
                    reasoning.push({
                        step: iterations,
                        tool: toolCall.function.name,
                        args,
                        resultCount: result.rows?.length || result.count || 0,
                        elapsed
                    });

                    return {
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(result)
                    };
                })
            );

            messages.push(...toolResults);

        } else if (choice.finish_reason === 'stop') {
            return {
                answer: assistantMessage.content,
                model,
                tokensUsed: totalTokens,
                reasoning
            };
        } else {
            break;
        }
    }

    return {
        answer: 'No pude completar el análisis.',
        model,
        tokensUsed: totalTokens,
        reasoning
    };
}

// ── Ejecutor de tools ─────────────────────────────────────────────────────────
async function executeTool(name, args, token) {
    try {
        switch (name) {
            case 'query_pnl':           return await toolQueryPnl(args);
            case 'query_all_entities':  return await toolQueryAllEntities(args);
            case 'query_top_products':  return await toolQueryTopProducts(args);
            case 'search_context':      return await toolSearchContext(args, token);
            default:                    return { error: `Tool desconocida: ${name}` };
        }
    } catch (err) {
        console.error(`[Tool Error] ${name}:`, err.message);
        return { error: err.message };
    }
}

// ── Tool: query_pnl ───────────────────────────────────────────────────────────
async function toolQueryPnl({ entity, period, account, prodline }) {
    const conn = await getHanaConnection();
    try {
        let where = [`ENTITY = '${entity}'`];

        if (period.includes(' TO ')) {
            const [from, to] = period.split(' TO ').map(p => p.trim().replace('-', ''));
            where.push(`DATE >= '${from}' AND DATE <= '${to}'`);
        } else if (period.length === 4) {
            where.push(`DATE LIKE '${period}%'`);
        } else {
            where.push(`DATE = '${period.replace('-', '')}'`);
        }

        if (account) where.push(`ACCOUNT = '${account}'`);
        if (prodline) where.push(`PRODLINE = '${prodline}'`);

        const sql = `
            SELECT DATE, ACCOUNT, PRODLINE, SUM(SIGNEDDATA) AS VALUE
            FROM PNLDATA
            WHERE ${where.join(' AND ')}
            GROUP BY DATE, ACCOUNT, PRODLINE
            ORDER BY DATE, PRODLINE, ACCOUNT
        `;

        const rows = await execSQL(conn, sql);
        return { rows, count: rows.length };
    } finally {
        conn.disconnect();
    }
}

// ── Tool: query_all_entities ──────────────────────────────────────────────────
async function toolQueryAllEntities({ period, account }) {
    const conn = await getHanaConnection();
    try {
        const dateFilter = period.length === 4
            ? `DATE LIKE '${period}%'`
            : `DATE = '${period.replace('-', '')}'`;

        const sql = `
            SELECT ENTITY, SUM(SIGNEDDATA) AS VALUE
            FROM PNLDATA
            WHERE ${dateFilter} AND ACCOUNT = '${account}'
            GROUP BY ENTITY
            ORDER BY VALUE
        `;

        const rows = await execSQL(conn, sql);
        return { rows, count: rows.length };
    } finally {
        conn.disconnect();
    }
}

// ── Tool: query_top_products ──────────────────────────────────────────────────
async function toolQueryTopProducts({ entity, period, account, limit = 5 }) {
    const conn = await getHanaConnection();
    try {
        const dateFilter = period.length === 4
            ? `DATE LIKE '${period}%'`
            : `DATE = '${period.replace('-', '')}'`;

        const sql = `
            SELECT TOP ${limit} PRODLINE, SUM(SIGNEDDATA) AS VALUE
            FROM PNLDATA
            WHERE ENTITY = '${entity}' AND ${dateFilter} AND ACCOUNT = '${account}'
            GROUP BY PRODLINE
            ORDER BY VALUE
        `;

        const rows = await execSQL(conn, sql);
        return { rows, count: rows.length };
    } finally {
        conn.disconnect();
    }
}

// ── Tool: search_context ──────────────────────────────────────────────────────
async function toolSearchContext({ query }, token) {
    const embResp = await fetch(
        `${AICORE_BASE_URL}/v2/inference/deployments/${EMBEDDING_DEPLOYMENT}/v1/embeddings`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'AI-Resource-Group': RESOURCE_GROUP,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ input: [query], model: 'text-embedding-3-small' })
        }
    );

    if (!embResp.ok) throw new Error(`Embedding error: ${embResp.status}`);
    const embData = await embResp.json();
    const queryVector = embData.data[0].embedding;

    const conn = await getHanaConnection();
    try {
        const vectorStr = '[' + queryVector.join(',') + ']';
        const sql = `
            SELECT TOP 5 CHUNK_TEXT, ENTITY, PRODLINE, PERIOD,
                COSINE_SIMILARITY(EMBEDDING, TO_REAL_VECTOR(?)) AS SCORE
            FROM PNLDATA_VECTORS
            ORDER BY SCORE DESC
        `;
        const rows = await execSQL(conn, sql, [vectorStr]);
        return { rows: rows.map(r => ({ text: r.CHUNK_TEXT, score: r.SCORE })) };
    } finally {
        conn.disconnect();
    }
}

// ── AI Core helpers ───────────────────────────────────────────────────────────
async function getAICoreToken() {
    const credentials = Buffer.from(
        `${process.env.AICORE_CLIENT_ID}:${process.env.AICORE_CLIENT_SECRET}`
    ).toString('base64');

    const resp = await fetch(process.env.AICORE_AUTH_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });

    if (!resp.ok) throw new Error(`Token error: ${resp.status}`);
    return (await resp.json()).access_token;
}

async function callGPT4o(messages, token) {
    const resp = await fetch(
        `${AICORE_BASE_URL}/v2/inference/deployments/${GPT4O_DEPLOYMENT}/v1/chat/completions`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'AI-Resource-Group': RESOURCE_GROUP,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages,
                tools: AGENT_TOOLS,
                tool_choice: 'auto',
                max_tokens: 800,
                temperature: 0.2
            })
        }
    );

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`GPT-4o error ${resp.status}: ${err}`);
    }
    return resp.json();
}

// ── HANA helpers ──────────────────────────────────────────────────────────────
async function getHanaConnection() {
    const hdbcli = require('@sap/hdbext');
    return new Promise((resolve, reject) => {
        hdbcli.createConnection({
            host: process.env.HANA_HOST,
            port: parseInt(process.env.HANA_PORT || '443'),
            user: process.env.HANA_USER,
            password: process.env.HANA_PASSWORD,
            encrypt: true,
            sslValidateCertificate: false
        }, (err, conn) => {
            if (err) reject(err);
            else resolve(conn);
        });
    });
}

async function execSQL(conn, sql, params = []) {
    return new Promise((resolve, reject) => {
        conn.exec(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}