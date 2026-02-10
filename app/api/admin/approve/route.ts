import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request) {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    try {
        const { userId } = await request.json();
        if (!userId) {
            return NextResponse.json({ error: 'User ID required' }, { status: 400 });
        }

        await query('UPDATE users SET approved = TRUE WHERE id = $1', [userId]);
        return NextResponse.json({ message: 'User approved' });
    } catch (error) {
        console.error('Approve user error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
