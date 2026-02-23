
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { getAnswer } from '@/lib/llm';

const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v1/search';

export async function POST(request: NextRequest) {
    const session = await getSession();
    if (!session || !session.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { workspaceId, question } = await request.json();
        const firecrawlKey = process.env.FIRECRAWL_API_KEY;

        if (!workspaceId || !question) {
            return NextResponse.json({ error: 'Workspace ID and question are required' }, { status: 400 });
        }

        // 1. Web Search using Firecrawl (if key exists)
        let webContext = "";
        if (firecrawlKey) {
            try {
                const searchRes = await fetch(FIRECRAWL_API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${firecrawlKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        query: question,
                        limit: 3,
                        lang: 'en'
                    })
                });
                const searchData = await searchRes.json();
                if (searchData.success && searchData.data) {
                    webContext = searchData.data.map((res: any) =>
                        `Title: ${res.title}\nURL: ${res.url}\nContent: ${res.markdown || res.description}`
                    ).join('\n\n');
                }
            } catch (err) {
                console.warn('[Deep Search] Firecrawl search failed:', err);
            }
        } else {
            console.warn('[Deep Search] Firecrawl API Key missing in environment.');
        }

        // 2. Retrieve Workspace Document context
        const keywords = question.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
        let docChunks = [];
        if (keywords.length > 0) {
            const likeClauses = keywords.map((_: string, i: number) => `dc.content ILIKE $${i + 2}`).join(' OR ');
            const sql = `
                SELECT dc.content, d.filename
                FROM document_chunks dc
                JOIN documents d ON dc.document_id = d.id
                WHERE d.workspace_id = $1 AND (${likeClauses})
                LIMIT 5
            `;
            const chunksRes = await query(sql, [workspaceId, ...keywords.map((k: string) => `%${k}%`)]);
            docChunks = chunksRes.rows;
        }

        const docContext = docChunks.map((item, idx) =>
            `--- Workspace Document Source [${idx + 1}]: ${item.filename} ---\n${item.content}`
        ).join('\n\n');

        // 3. Combine contexts and generate answer
        const prompt = `
You are an advanced AI workspace assistant with "Deep Search" capabilities. 
You have access to both local Workspace Documents and fresh Web Search results.

User Question: ${question}

--- LOCAL DOCUMENT CONTEXT ---
${docContext || "No highly relevant information found in local documents."}

--- WEB SEARCH CONTEXT (FIRECRAWL) ---
${webContext || "No web results available (Firecrawl API key might be missing)."}

Instructions:
1. Synthesize an answer that combines both local data and web data if applicable.
2. If there are contradictions, prioritize Local Documents but mention the Web findings as "web search suggests...".
3. Use citations for local documents: "[Document Name]" and for web results: "[Source Title](URL)".
4. If the Firecrawl key was missing, apologize briefly that "Deep Web Search is currently unavailable" but provide the best answer using documents.

Answer:
`;

        const answer = await getAnswer(prompt, question);

        return NextResponse.json({
            success: true,
            answer: answer,
            webUsed: !!webContext,
            docsUsedCount: docChunks.length
        });

    } catch (error: any) {
        console.error('[Deep Search] API Error:', error);
        return NextResponse.json({
            error: 'Internal Server Error'
        }, { status: 500 });
    }
}
