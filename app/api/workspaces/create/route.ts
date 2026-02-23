
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

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

    try {
        const { name, description } = await request.json();

        if (!name) {
            return NextResponse.json({ error: 'Workspace name is required' }, { status: 400 });
        }

        const res = await query(
            'INSERT INTO workspaces (user_id, name, description) VALUES ($1, $2, $3) RETURNING id, name',
            [userId, name, description || '']
        );

        return NextResponse.json({
            success: true,
            workspace: res.rows[0]
        });

    } catch (error: any) {
        console.error('[Workspace Create] API Error:', error);
        return NextResponse.json({
            error: 'Internal Server Error',
            details: error.message
        }, { status: 500 });
    }
}
