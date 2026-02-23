
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

    try {
        const res = await query(
            'SELECT id, name, description, created_at FROM workspaces WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );

        return NextResponse.json({
            success: true,
            workspaces: res.rows[0] ? res.rows : []
        });

    } catch (error: any) {
        console.error('[Workspace List] API Error:', error);
        return NextResponse.json({
            error: 'Internal Server Error',
            details: error.message
        }, { status: 500 });
    }
}
