
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { getAnswer } from '@/lib/llm';

export async function POST(request: NextRequest) {
    const session = await getSession();
    if (!session || !session.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { workspaceId, question } = await request.json();

        if (!workspaceId || !question) {
            return NextResponse.json({ error: 'Workspace ID and question are required' }, { status: 400 });
        }

        // 1. Retrieve relevant chunks from ALL documents in the workspace
        // Simple keyword-based retrieval for now since no vector search is enabled.
        // We look for chunks that contain words from the question.
        const keywords = question.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
        let chunksRes;

        if (keywords.length > 0) {
            // Build a ILIKE query for multiple keywords
            const likeClauses = keywords.map((_: string, i: number) => `dc.content ILIKE $${i + 2}`).join(' OR ');
            const sql = `
                SELECT dc.content, d.filename, d.id as doc_id
                FROM document_chunks dc
                JOIN documents d ON dc.document_id = d.id
                WHERE d.workspace_id = $1 AND (${likeClauses})
                LIMIT 10
            `;
            chunksRes = await query(sql, [workspaceId, ...keywords.map((k: string) => `%${k}%`)]);
        } else {
            // Fallback: just get the most recent chunks if no long keywords found
            chunksRes = await query(`
                SELECT dc.content, d.filename, d.id as doc_id
                FROM document_chunks dc
                JOIN documents d ON dc.document_id = d.id
                WHERE d.workspace_id = $1
                ORDER BY dc.id DESC
                LIMIT 10
            `, [workspaceId]);
        }

        const contextItems = chunksRes.rows;

        if (contextItems.length === 0) {
            return NextResponse.json({
                answer: "I couldn't find any relevant information in the workspace documents to answer that question.",
                sources: []
            });
        }

        // 2. Format context for LLM with citations
        const formattedContext = contextItems.map((item, idx) =>
            `--- Source [${idx + 1}]: ${item.filename} ---\n${item.content}`
        ).join('\n\n');

        // 3. Get answer from LLM
        const prompt = `
You are an AI workspace assistant. Use the provided context from multiple documents to answer the user's question.
Important instructions:
- If the information is found in the context, synthesize a clear answer.
- You MUST cite your sources using the source numbers, e.g., "According to [1] and [2]...".
- If the context doesn't contain the answer, say so.
- List the sources used at the very bottom of your response in the format: "Sources: [Filename 1], [Filename 2]".

Context:
${formattedContext}
`;

        const answer = await getAnswer(prompt, question);

        // 4. Extract sources for UI
        const usedSources = Array.from(new Set(contextItems.map(item => item.filename)));

        return NextResponse.json({
            success: true,
            answer: answer,
            sources: usedSources
        });

    } catch (error: any) {
        console.error('[Workspace Chat] API Error:', error);
        return NextResponse.json({
            error: 'Internal Server Error',
            details: error.message
        }, { status: 500 });
    }
}
