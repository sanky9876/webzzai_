import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { generateSummary } from '@/lib/llm';
import { Innertube, UniversalCache } from 'youtubei.js';

// Helper to fetch transcript using multiple strategies
async function fetchTranscript(videoId: string, requestHeaders?: Headers): Promise<string> {
    const fetchStartTime = Date.now();
    let errors: string[] = [];

    // Strategy 1: youtube-transcript (Lightweight)
    try {
        console.log(`[${Date.now() - fetchStartTime}ms] [Transcript] Strategy 1: youtube-transcript`);
        const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
        const text = transcriptItems.map(item => item.text).join(' ');
        if (text.length > 0) return text;
    } catch (e: any) {
        errors.push(`Strategy 1: ${e.message}`);
    }

    // Strategy 2: Python Fallback (Moved up because it's reliable in this environment)
    try {
        console.log(`[${Date.now() - fetchStartTime}ms] [Transcript] Strategy 2: Python (youtube-transcript-api)`);
        const { spawn } = require('child_process');
        const path = require('path');
        const scriptPath = path.join(process.cwd(), 'scripts', 'get_transcript.py');

        const pythonProcess = spawn('python', [scriptPath, videoId]);
        let scriptOutput = '';
        let scriptError = '';

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pythonProcess.kill();
                reject(new Error('Python script timed out'));
            }, 10000); // 10s timeout

            pythonProcess.stdout.on('data', (data: any) => { scriptOutput += data.toString(); });
            pythonProcess.stderr.on('data', (data: any) => { scriptError += data.toString(); });
            pythonProcess.on('close', (code: any) => {
                clearTimeout(timeout);
                if (code !== 0) reject(new Error(`Exit code ${code}`));
                else resolve(null);
            });
        });

        const result = JSON.parse(scriptOutput);
        if (result.transcript) return result.transcript;
    } catch (e: any) {
        errors.push(`Strategy 2: ${e.message}`);
    }

    // Strategy 3: Manual HTML Parsing (Faster than Innertube usually)
    try {
        console.log(`[${Date.now() - fetchStartTime}ms] [Transcript] Strategy 3: Manual HTML`);
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const htmlRes = await fetch(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });
        const html = await htmlRes.text();

        const playerResponseRegex = /ytInitialPlayerResponse\s*=\s*({.+?});/;
        const playerMatch = html.match(playerResponseRegex);
        if (playerMatch) {
            const playerResponse = JSON.parse(playerMatch[1]);
            const captions = (playerResponse.captions as any)?.playerCaptionsTracklistRenderer?.captionTracks;
            if (captions) {
                const enTrack = captions.find((t: any) => t.languageCode === 'en') || captions[0];
                if (enTrack && enTrack.baseUrl) {
                    const transcriptRes = await fetch(enTrack.baseUrl);
                    const transcriptXml = await transcriptRes.text();
                    const matches = transcriptXml.matchAll(/<text[^>]*>(.*?)<\/text>/g);
                    let fullText = "";
                    for (const match of matches) {
                        if (match[1]) fullText += match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") + " ";
                    }
                    if (fullText.trim().length > 0) return fullText.trim();
                }
            }
        }
    } catch (e: any) {
        errors.push(`Strategy 3: ${e.message}`);
    }

    // Strategy 4: last resort - Innertube (Slowest)
    try {
        console.log(`[${Date.now() - fetchStartTime}ms] [Transcript] Strategy 4: Innertube (WEB/ANDROID)`);
        const yt = await Innertube.create({ generate_session_locally: true, client_type: 'WEB' as any });
        const playerResponse = await yt.actions.execute('/player', { videoId, parse: true });
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
    } catch (e: any) {
        errors.push(`Strategy 4: ${e.message}`);
    }

    throw new Error(`All transcript fetching strategies failed. Details: ${JSON.stringify(errors)}`);
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
