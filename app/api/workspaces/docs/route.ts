
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
    const session = await getSession();
    if (!session || !session.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');

    if (!workspaceId) {
        return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 });
    }

    console.log(`[Workspace Docs API] Fetching documents for workspace: ${workspaceId}`);

    try {
        const res = await query(
            'SELECT id, filename, file_type, upload_date FROM documents WHERE workspace_id = $1 ORDER BY upload_date DESC',
            [workspaceId]
        );

        return NextResponse.json({
            success: true,
            documents: res.rows
        });

    } catch (error: any) {
        console.error('[Workspace Docs API] Error:', error);
        return NextResponse.json({
            error: 'Internal Server Error',
            details: error.message
        }, { status: 500 });
    }
}
