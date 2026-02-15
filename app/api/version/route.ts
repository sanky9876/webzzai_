import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    return NextResponse.json({
        version: 'v2.1',
        strategies: ['youtube-transcript', 'manual-html', 'youtubei.js', 'python'],
        timestamp: new Date().toISOString()
    });
}
