
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { getAnswer } from '@/lib/llm';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> } // params is a Promise in Next.js 15+
) {
    const session = await getSession();
    if (!session || !session.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { question } = await request.json();

    if (!question) {
        return NextResponse.json({ error: 'Question is required' }, { status: 400 });
    }

    // Verify ownership
    const userRes = await query('SELECT id FROM users WHERE email = $1', [session.email]);
    if (userRes.rowCount === 0) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const userId = userRes.rows[0].id;

    const docRes = await query('SELECT id FROM documents WHERE id = $1 AND user_id = $2', [id, userId]);
    if (docRes.rowCount === 0) {
        return NextResponse.json({ error: 'Document not found or unauthorized' }, { status: 404 });
    }

    // Simple Retrieval Strategy:
    // 1. Try to find chunks that contain keywords from the question (naive search).
    // 2. If no chunks found, fallback to first few chunks.

    const keywords = question.split(' ').filter((w: string) => w.length > 4).map((w: string) => `%${w}%`);

    let chunks: any[] = [];

    if (keywords.length > 0) {
        // Build dynamic query for ILIKE
        const conditions = keywords.map((_: any, i: number) => `content ILIKE $${i + 2}`).join(' OR ');
        const textRes = await query(
            `SELECT content FROM document_chunks WHERE document_id = $1 AND (${conditions}) LIMIT 5`,
            [id, ...keywords]
        );
        chunks = textRes.rows;
    }

    // Fallback if no specific chunks found or no keywords
    if (chunks.length === 0) {
        const textRes = await query(
            'SELECT content FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index ASC LIMIT 5',
            [id]
        );
        chunks = textRes.rows;
    }

    const context = chunks.map(c => c.content).join('\n\n');

    try {
        const answer = await getAnswer(context, question);
        return NextResponse.json({ answer });
    } catch (error: any) {
        console.error('Error in /api/documents/[id]/answer:', error);
        return NextResponse.json({ error: `Failed to generate answer: ${error.message}` }, { status: 500 });
    }
}
