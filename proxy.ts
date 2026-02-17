import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/auth';

export async function proxy(request: NextRequest) {
    const sessionCookie = request.cookies.get('session')?.value;

    if (request.nextUrl.pathname.startsWith('/dashboard')) {
        if (!sessionCookie) {
            return NextResponse.redirect(new URL('/login', request.url));
        }

        // Optional: Check if session is valid/expired here or in updateSession
        // For now, presence of cookie is the soft check, updateSession does verification
    }

    return await updateSession(request);
}

export const config = {
    matcher: ['/dashboard/:path*'],
};
