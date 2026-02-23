
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
// @ts-ignore
const pdf = require('pdf-parse');

console.log('PDF Parse Library Type:', typeof pdf);

export async function POST(request: NextRequest) {
    console.log('[Upload] POST request starting');
    const session = await getSession();
    if (!session || !session.email) {
        console.warn('[Upload] Unauthorized');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get User ID from DB
    const userRes = await query('SELECT id FROM users WHERE email = $1', [session.email]);
    if (userRes.rowCount === 0) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const userId = userRes.rows[0].id;

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const wsIdStr = formData.get('workspaceId') as string;
    let workspaceId = null;
    if (wsIdStr && wsIdStr !== 'undefined' && wsIdStr !== 'null') {
        const parsed = parseInt(wsIdStr);
        if (!isNaN(parsed)) workspaceId = parsed;
    }

    console.log(`[Upload] File: ${file?.name}, WorkspaceId: ${workspaceId}, User: ${session.email}`);

    if (!file) {
        console.warn('[Upload] No file provided');
        return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // ... (rest of buffer/parsing logic stays similar)
    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.name.replace(/\s+/g, '_'); // Sanitize filename
    const uploadDir = path.join(process.cwd(), 'uploads');

    // Ensure upload directory exists
    try {
        await mkdir(uploadDir, { recursive: true });
    } catch (err) { }

    // Skip saving to disk (unreliable on Vercel) and use buffer directly
    const filePath = `mem://${Date.now()}-${filename}`;

    let textContent = '';
    const fileType = file.type;

    try {
        if (fileType === 'application/pdf') {
            const data = await pdf(buffer);
            textContent = data.text || '';
        } else if (fileType === 'text/plain') {
            textContent = buffer.toString('utf-8');
        } else {
            return NextResponse.json({ error: `Unsupported file type: ${fileType}` }, { status: 400 });
        }
    } catch (error: any) {
        console.error('[Upload] Extraction error:', error);
        return NextResponse.json({ error: `Failed to extract text: ${error.message}` }, { status: 500 });
    }

    if (!textContent || textContent.trim().length === 0) {
        return NextResponse.json({
            error: 'Could not extract any text from this file. If it is a PDF, please ensure it contains selectable text (not just images).'
        }, { status: 400 });
    }

    // Save document metadata with workspace_id
    console.log('[Upload] Saving document metadata to DB...');
    const docRes = await query(
        'INSERT INTO documents (user_id, filename, file_type, storage_path, workspace_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [userId, filename, fileType, filePath, workspaceId]
    );
    console.log(`[Upload] Document saved with ID: ${docRes.rows[0].id}`);
    const docId = docRes.rows[0].id;

    // Chunking Strategy (Simple: 2000 characters overlap 200)
    const chunkSize = 2000;
    const overlap = 200;

    let start = 0;
    let chunkIndex = 0;
    const chunks = [];

    console.log('[Upload] Preparing chunks for batch insertion...');
    while (start < textContent.length) {
        const end = Math.min(start + chunkSize, textContent.length);
        const chunkText = textContent.slice(start, end);
        chunks.push({ index: chunkIndex, content: chunkText });

        start += (chunkSize - overlap);
        chunkIndex++;
    }

    if (chunks.length > 0) {
        // Batch Insert chunks into document_chunks
        // Constructing a single multi-row INSERT statement:
        // INSERT INTO table (col1, col2) VALUES ($1, $2, $3), ($4, $5, $6)...
        const values: any[] = [];
        const placeholders = chunks.map((c, i) => {
            const base = i * 3;
            values.push(docId, c.index, c.content);
            return `($${base + 1}, $${base + 2}, $${base + 3})`;
        }).join(', ');

        const insertSql = `INSERT INTO document_chunks (document_id, chunk_index, content) VALUES ${placeholders}`;
        await query(insertSql, values);
        console.log(`[Upload] Batch inserted ${chunks.length} chunks.`);
    }

    return NextResponse.json({ success: true, documentId: docId, chunks: chunkIndex });
}
