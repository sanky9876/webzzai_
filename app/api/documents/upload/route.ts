
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { mkdir } from 'fs/promises';
import path from 'path';

export async function POST(request: NextRequest) {
    console.log('[Upload] POST request starting');
    const session = await getSession();
    if (!session || !session.email) {
        console.warn('[Upload] Unauthorized attempt');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get User ID from DB
    const userRes = await query('SELECT id FROM users WHERE email = $1', [session.email]);
    if (userRes.rowCount === 0) {
        console.error('[Upload] User not found');
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const userId = userRes.rows[0].id;

    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const wsIdStr = formData.get('workspaceId') as string;

        let workspaceId = null;
        if (wsIdStr && wsIdStr !== 'undefined' && wsIdStr !== 'null') {
            const parsed = parseInt(wsIdStr);
            if (!isNaN(parsed)) workspaceId = parsed;
        }

        console.log(`[Upload] Processing: ${file?.name}, Workspace: ${workspaceId}`);

        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const filename = file.name.replace(/\s+/g, '_');
        const filePath = `mem://${Date.now()}-${filename}`;

        let textContent = '';
        const fileType = file.type;

        try {
            if (fileType === 'application/pdf') {
                const pdfParse = require('pdf-parse');
                const data = await pdfParse(buffer);
                textContent = data.text || '';
                console.log(`[Upload] PDF extracted: ${textContent.length} chars`);
            } else if (fileType === 'text/plain') {
                textContent = buffer.toString('utf-8');
                console.log(`[Upload] TXT extracted: ${textContent.length} chars`);
            } else {
                return NextResponse.json({ error: `Unsupported file type: ${fileType}` }, { status: 400 });
            }
        } catch (error: any) {
            console.error('[Upload] Extraction error:', error);
            return NextResponse.json({ error: `Failed to extract text: ${error.message}` }, { status: 500 });
        }

        if (!textContent || textContent.trim().length === 0) {
            return NextResponse.json({
                error: 'Could not extract any text from this file. If it is a PDF, please ensure it contains selectable text.'
            }, { status: 400 });
        }

        // Save document metadata
        console.log('[Upload] Inserting document record...');
        const docRes = await query(
            'INSERT INTO documents (user_id, filename, file_type, storage_path, workspace_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [userId, filename, fileType, filePath, workspaceId]
        );
        const docId = docRes.rows[0].id;

        // Chunking Strategy (2000 chars, 200 overlap)
        const chunkSize = 2000;
        const overlap = 200;
        let start = 0;
        let chunkIndex = 0;
        const allChunks = [];

        while (start < textContent.length) {
            const end = Math.min(start + chunkSize, textContent.length);
            allChunks.push({ index: chunkIndex, content: textContent.slice(start, end) });
            start += (chunkSize - overlap);
            chunkIndex++;
        }

        console.log(`[Upload] Saving ${allChunks.length} chunks in sub-batches...`);

        // Insert in sub-batches of 100 to avoid PG parameter limits and timeouts
        const batchSize = 100;
        for (let i = 0; i < allChunks.length; i += batchSize) {
            const currentSubBatch = allChunks.slice(i, i + batchSize);
            const values: any[] = [];
            const placeholders = currentSubBatch.map((c, j) => {
                const base = j * 3;
                values.push(docId, c.index, c.content);
                return `($${base + 1}, $${base + 2}, $${base + 3})`;
            }).join(', ');

            await query(`INSERT INTO document_chunks (document_id, chunk_index, content) VALUES ${placeholders}`, values);
        }

        console.log('[Upload] Successfully completed!');
        return NextResponse.json({ success: true, documentId: docId, chunks: chunkIndex });

    } catch (error: any) {
        console.error('[Upload] Global Error:', error);
        return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 });
    }
}
