import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { generateSummary } from '@/lib/llm';
import { Innertube, UniversalCache } from 'youtubei.js';

// Helper to fetch transcript using multiple strategies
async function fetchTranscript(videoId: string, requestHeaders?: Headers): Promise<string> {
    const fetchStartTime = Date.now();
    let errors: string[] = [];

    // Helper for individual strategy execution
    const runStrategy = async (name: string, fn: () => Promise<string>): Promise<string> => {
        try {
            console.log(`[${Date.now() - fetchStartTime}ms] [Transcript] Starting ${name}`);
            const result = await fn();
            console.log(`[${Date.now() - fetchStartTime}ms] [Transcript] ${name} SUCCEEDED`);
            return result;
        } catch (e: any) {
            const msg = `[${Date.now() - fetchStartTime}ms] ${name} FAILED: ${e.message}`;
            console.warn(msg);
            errors.push(msg);
            throw e;
        }
    };

    // Define the most reliable strategies
    const strategy1 = () => runStrategy("Strategy 1 (youtube-transcript)", async () => {
        const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
        const text = transcriptItems.map(item => item.text).join(' ');
        if (!text || text.length === 0) throw new Error("Empty transcript returned");
        return text;
    });

    const strategy2 = () => runStrategy("Strategy 2 (Python)", async () => {
        const { spawn } = require('child_process');
        const path = require('path');
        const scriptPath = path.join(process.cwd(), 'scripts', 'get_transcript.py');

        return new Promise<string>((resolve, reject) => {
            const pythonProcess = spawn('python', [scriptPath, videoId]);
            let scriptOutput = '';
            let scriptError = '';

            const timeout = setTimeout(() => {
                pythonProcess.kill();
                reject(new Error('Timed out'));
            }, 15000); // Internal Python timeout

            pythonProcess.stdout.on('data', (data: any) => { scriptOutput += data.toString(); });
            pythonProcess.stderr.on('data', (data: any) => { scriptError += data.toString(); });
            pythonProcess.on('close', (code: any) => {
                clearTimeout(timeout);
                if (code !== 0) {
                    reject(new Error(`Exit code ${code}. Error: ${scriptError}`));
                } else {
                    try {
                        const result = JSON.parse(scriptOutput);
                        if (result.transcript) resolve(result.transcript);
                        else reject(new Error(result.error || "No transcript in output"));
                    } catch (e) {
                        reject(new Error(`Parse error: ${scriptOutput.substring(0, 100)}`));
                    }
                }
            });
        });
    });

    const strategy3 = () => runStrategy("Strategy 3 (Innertube-ANDROID)", async () => {
        const yt = await Innertube.create({ generate_session_locally: true, client_type: 'ANDROID' as any });
        const info = await yt.getInfo(videoId);
        const transcriptData = await info.getTranscript();
        const segments = (transcriptData as any)?.transcript?.content?.body?.initial_segments;
        if (segments && segments.length > 0) {
            return segments.map((s: any) => s.snippet.text).join(' ');
        }
        throw new Error("No segments found");
    });

    // Strategy 4: Raw HTML Parsing (Fast enough to run in group)
    const strategy4 = () => runStrategy("Strategy 4 (Manual HTML)", async () => {
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const htmlRes = await fetch(videoUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36' }
        });
        const html = await htmlRes.text();
        const playerResponseRegex = /ytInitialPlayerResponse\s*=\s*({.+?});/;
        const playerMatch = html.match(playerResponseRegex);
        if (playerMatch) {
            const playerResponse = JSON.parse(playerMatch[1]);
            const captions = (playerResponse.captions as any)?.playerCaptionsTracklistRenderer?.captionTracks;
            if (captions?.[0]?.baseUrl) {
                const transcriptRes = await fetch(captions[0].baseUrl);
                const transcriptXml = await transcriptRes.text();
                const matches = transcriptXml.matchAll(/<text[^>]*>(.*?)<\/text>/g);
                let fullText = "";
                for (const match of matches) {
                    if (match[1]) fullText += match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") + " ";
                }
                if (fullText.trim().length > 0) return fullText.trim();
            }
        }
        throw new Error("No tracks in HTML");
    });

    // Create a racing promise group
    // We race the top strategies. If any succeeds, we return immediately.
    // We also set a global timeout of 9 seconds to ensure we definitely respond before Vercel (10s limit).

    return new Promise<string>(async (resolve, reject) => {
        const globalTimeout = setTimeout(() => {
            reject(new Error(`Global 9s timeout reached. Best effort errors: ${JSON.stringify(errors)}`));
        }, 9000);

        try {
            // Race the first 3 (fastest/most reliable)
            const result = await Promise.any([
                strategy1(),
                strategy2(),
                strategy4()
            ]);
            clearTimeout(globalTimeout);
            resolve(result);
        } catch (allFailed: any) {
            // If all in Group 1 failed, try Strategy 3 (Innertube) as a quick second wave if time remains
            try {
                const result = await strategy3();
                clearTimeout(globalTimeout);
                resolve(result);
            } catch (s3Failed) {
                clearTimeout(globalTimeout);
                reject(new Error(`All strategies failed. Log: ${JSON.stringify(errors)}`));
            }
        }
    });
}

export async function POST(req: NextRequest) {
    const startTime = Date.now();
    try {
        const { videoUrl } = await req.json();

        if (!videoUrl) {
            console.log(`[${Date.now() - startTime}ms] API Route V2.0: Missing videoUrl`);
            return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
        }

        console.log(`[${Date.now() - startTime}ms] [Summarize] Request received: ${videoUrl}`);

        if (!process.env.GROQ_API_KEY) {
            console.log(`[${Date.now() - startTime}ms] [Summarize] GROQ_API_KEY missing`);
            return NextResponse.json({ error: 'Groq API key is not configured' }, { status: 500 });
        }

        // Extract Video ID
        const videoIdMatch = videoUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
        const videoId = videoIdMatch ? videoIdMatch[1] : null;

        if (!videoId) {
            console.log(`[${Date.now() - startTime}ms] [Summarize] Invalid Video ID`);
            return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
        }

        console.log(`[${Date.now() - startTime}ms] [Summarize] Video ID: ${videoId}. Fetching transcript...`);
        let transcriptText = '';
        try {
            transcriptText = await fetchTranscript(videoId, req.headers);
            console.log(`[${Date.now() - startTime}ms] [Summarize] Transcript fetched successfully, length: ${transcriptText.length}`);
        } catch (error: any) {
            console.error(`[${Date.now() - startTime}ms] [Summarize] Transcript Error:`, error);
            return NextResponse.json({ error: `Transcript fetch failed. Details: ${error.message || String(error)}` }, { status: 400 });
        }

        // Limit transcript length
        const truncatedTranscript = transcriptText.substring(0, 30000);

        console.log(`[${Date.now() - startTime}ms] [Summarize] Starting Groq summary generation...`);
        // Generate Summary with Groq
        const summaryText = await generateSummary(truncatedTranscript);
        console.log(`[${Date.now() - startTime}ms] [Summarize] Groq summary generated successfully.`);

        return NextResponse.json({ summary: summaryText });

    } catch (error) {
        console.error(`[${Date.now() - startTime}ms] [Summarize] API Error:`, error);
        return NextResponse.json({ error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
}
