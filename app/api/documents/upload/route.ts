
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
// @ts-ignore
const pdf = require('pdf-parse');

console.log('PDF Parse Library Type:', typeof pdf);

export async function POST(request: NextRequest) {
    const session = await getSession();
    if (!session || !session.email) {
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
    const workspaceId = formData.get('workspaceId') ? parseInt(formData.get('workspaceId') as string) : null;

    if (!file) {
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

    const filePath = path.join(uploadDir, `${Date.now()}-${filename}`);

    // ... (rest of parsing logic)
    try {
        await writeFile(filePath, buffer);
    } catch (error) { }

    let textContent = '';
    const fileType = file.type;

    try {
        if (fileType === 'application/pdf') {
            const data = await pdf(buffer);
            textContent = data.text;
        } else if (fileType === 'text/plain') {
            textContent = buffer.toString('utf-8');
        } else {
            return NextResponse.json({ error: 'Unsupported file type.' }, { status: 400 });
        }
    } catch (error: any) {
        return NextResponse.json({ error: `Failed to extract text: ${error.message}` }, { status: 500 });
    }

    // Save document metadata with workspace_id
    const docRes = await query(
        'INSERT INTO documents (user_id, filename, file_type, storage_path, workspace_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [userId, filename, fileType, filePath, workspaceId]
    );
    const docId = docRes.rows[0].id;

    // Chunking Strategy (Simple: 1000 characters overlap 100)
    const chunkSize = 2000;
    const overlap = 200;

    let start = 0;
    let chunkIndex = 0;

    while (start < textContent.length) {
        const end = Math.min(start + chunkSize, textContent.length);
        const chunk = textContent.slice(start, end);

        await query(
            'INSERT INTO document_chunks (document_id, chunk_index, content) VALUES ($1, $2, $3)',
            [docId, chunkIndex, chunk]
        );

        start += (chunkSize - overlap);
        chunkIndex++;
    }

    return NextResponse.json({ success: true, documentId: docId, chunks: chunkIndex });
}
