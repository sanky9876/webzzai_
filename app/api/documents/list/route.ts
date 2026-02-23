
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
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

    const res = await query(
        `SELECT d.id, d.filename, d.file_type, d.upload_date, w.name as workspace_name 
         FROM documents d
         LEFT JOIN workspaces w ON d.workspace_id = w.id
         WHERE d.user_id = $1 
         ORDER BY d.upload_date DESC`,
        [userId]
    );

    return NextResponse.json({ documents: res.rows });
}
