import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { generateSummary } from '@/lib/llm';
import { Innertube, UniversalCache } from 'youtubei.js';

// Helper to fetch transcript using multiple strategies
async function fetchTranscript(videoId: string, requestHeaders?: Headers): Promise<string> {
    const fetchStartTime = Date.now();
    let errors: string[] = [];

    const runStrategy = async (name: string, fn: () => Promise<string>): Promise<string> => {
        try {
            console.log(`[${Date.now() - fetchStartTime}ms] [Transcript] Starting ${name}`);
            const result = await fn();
            if (!result || result.trim().length === 0) throw new Error("Result was empty");
            console.log(`[${Date.now() - fetchStartTime}ms] [Transcript] ${name} SUCCEEDED (Length: ${result.length})`);
            return result;
        } catch (e: any) {
            const msg = `[${Date.now() - fetchStartTime}ms] ${name} FAILED: ${e.message}`;
            console.warn(msg);
            errors.push(msg);
            throw e;
        }
    };

    // --- STRATEGIES ---

    const s1_youtubeTranscript = () => runStrategy("Strategy 1 (youtube-transcript)", async () => {
        const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
        return transcriptItems.map(item => item.text).join(' ');
    });

    const s2_python = () => runStrategy("Strategy 2 (Python)", async () => {
        const { spawn } = require('child_process');
        const path = require('path');
        const scriptPath = path.join(process.cwd(), 'scripts', 'get_transcript.py');

        return new Promise<string>((resolve, reject) => {
            const pythonProcess = spawn('python', [scriptPath, videoId]);
            let scriptOutput = '';
            let scriptError = '';

            const timeout = setTimeout(() => {
                pythonProcess.kill();
                reject(new Error('Process timed out'));
            }, 10000); // 10s for Python

            pythonProcess.stdout.on('data', (data: any) => { scriptOutput += data.toString(); });
            pythonProcess.stderr.on('data', (data: any) => { scriptError += data.toString(); });
            pythonProcess.on('close', (code: any) => {
                clearTimeout(timeout);
                if (code !== 0) reject(new Error(`Exit ${code}: ${scriptError}`));
                else {
                    try {
                        const res = JSON.parse(scriptOutput);
                        if (res.transcript) resolve(res.transcript);
                        else reject(new Error(res.error || "No transcript"));
                    } catch (e) { reject(new Error("JSON Parse fail")); }
                }
            });
        });
    });

    const s3_html = () => runStrategy("Strategy 3 (HTML-TimedText)", async () => {
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const res = await fetch(videoUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36' }
        });
        const html = await res.text();

        // Comprehensive regex to find caption info
        const playerResponseRegex = /ytInitialPlayerResponse\s*=\s*({.+?});/;
        const match = html.match(playerResponseRegex);
        if (!match) throw new Error("No player response found in HTML");

        const playerRes = JSON.parse(match[1]);
        const captions = playerRes?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (!captions || captions.length === 0) throw new Error("No caption tracks in player response");

        // Prefer English, fallback to auto-generated, fallback to index 0
        const track = captions.find((t: any) => t.languageCode === 'en' && !t.kind) ||
            captions.find((t: any) => t.languageCode === 'en') ||
            captions[0];

        // Fetch XML and parse manually
        const url = track.baseUrl + "&fmt=vtt"; // Try VTT for easier parsing if XML is blocked
        const transcriptRes = await fetch(url);
        const vttText = await transcriptRes.text();

        // Simple VTT to Text
        const cleanText = vttText
            .replace(/WEBVTT[\s\S]*?\n\n/g, '') // remove header
            .replace(/<[\s\S]*?>/g, '') // remove tags
            .replace(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g, '') // remove timestamps
            .replace(/\n+/g, ' ') // join lines
            .trim();

        if (cleanText.length < 10) throw new Error("Transcript content too short");
        return cleanText;
    });

    const s4_innertube = (client: string) => runStrategy(`Strategy 4 (Innertube-${client})`, async () => {
        const yt = await Innertube.create({ generate_session_locally: true, client_type: client as any });
        const info = await yt.getInfo(videoId);
        const transcript = await info.getTranscript();
        const segments = (transcript as any)?.transcript?.content?.body?.initial_segments;
        if (!segments) throw new Error("No segments in transcript");
        return segments.map((s: any) => s.snippet.text).join(' ');
    });

    // --- PARALLEL RACE ---

    return new Promise<string>(async (resolve, reject) => {
        const globalTimeout = setTimeout(() => {
            reject(new Error(`Timed out after 9.5s. Attempts logged: ${JSON.stringify(errors)}`));
        }, 9500);

        try {
            // First wave: Fastest & most reliable
            const result = await Promise.any([
                s1_youtubeTranscript(),
                s3_html()
            ]);
            clearTimeout(globalTimeout);
            resolve(result);
        } catch (wave1Errors) {
            // Second wave: Most robust fallbacks
            try {
                const result = await Promise.any([
                    s2_python(),
                    s4_innertube('ANDROID'),
                    s4_innertube('TV')
                ]);
                clearTimeout(globalTimeout);
                resolve(result);
            } catch (wave2Errors) {
                clearTimeout(globalTimeout);
                reject(new Error(`All strategies failed. Details: ${JSON.stringify(errors.slice(-5))}`));
            }
        }
    });
}

export async function POST(req: NextRequest) {
    const startTime = Date.now();
    try {
        const { videoUrl } = await req.json();

        if (!videoUrl) {
            return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
        }

        console.log(`[${Date.now() - startTime}ms] [Summarize] Request received: ${videoUrl}`);

        // Extract Video ID
        const videoIdMatch = videoUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
        const videoId = videoIdMatch ? videoIdMatch[1] : null;

        if (!videoId) {
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

        console.log(`[${Date.now() - startTime}ms] [Summarize] Starting LLM summary generation...`);
        // Generate Summary (llm.ts now handles Groq/OpenRouter fallback)
        const summaryText = await generateSummary(truncatedTranscript);
        console.log(`[${Date.now() - startTime}ms] [Summarize] Summary generated successfully.`);

        return NextResponse.json({ summary: summaryText });

    } catch (error: any) {
        console.error(`[${Date.now() - startTime}ms] [Summarize] API Error:`, error);
        return NextResponse.json({
            error: 'Internal Server Error',
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
