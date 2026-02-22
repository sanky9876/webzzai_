import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { generateSummary } from '@/lib/llm';
import { Innertube, UniversalCache } from 'youtubei.js';

// Helper to fetch transcript using multiple strategies
async function fetchTranscript(videoId: string, requestHeaders?: Headers): Promise<string> {
    let errors: string[] = [];

    // Strategy 1: youtube-transcript (Lightweight, often works)
    try {
        console.log(`[Transcript] Strategy 1: youtube-transcript for ${videoId}`);
        const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, {
            lang: 'en' // Explicitly request English
        });
        const text = transcriptItems.map(item => item.text).join(' ');
        if (text.length > 0) return text;
    } catch (e: any) {
        console.warn(`[Transcript] Strategy 1 failed: ${e.message}`);
        errors.push(`Strategy 1: ${e.message}`);
    }

    // Strategy 1.5: Manual HTML Parsing (Most robust for basic extraction)
    try {
        console.log(`[Transcript] Strategy 1.5: Manual HTML Parsing for ${videoId}`);
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const htmlRes = await fetch(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+417; SOCS=CAISAhAB' // Attempt to bypass consent page
            }
        });
        const html = await htmlRes.text();

        // Log title for debugging
        const titleMatch = html.match(/<title>(.*?)<\/title>/);
        if (titleMatch) {
            console.log(`[Transcript] Strategy 1.5 HTML Title: ${titleMatch[1]}`);
        }

        const captionTracksRegex = /"captionTracks":\s*(\[.*?\])/;
        const match = html.match(captionTracksRegex);

        if (match) {
            // ... existing match logic ...
            const captionTracks = JSON.parse(match[1]);
            const enTrack = captionTracks.find((t: any) => t.languageCode === 'en') || captionTracks[0];

            if (enTrack && enTrack.baseUrl) {
                // ... existing fetch ...
                const transcriptRes = await fetch(enTrack.baseUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                    }
                });
                const transcriptXml = await transcriptRes.text();
                const matches = transcriptXml.matchAll(/<text[^>]*>(.*?)<\/text>/g);
                let fullText = "";
                for (const match of matches) {
                    if (match[1]) {
                        fullText += match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") + " ";
                    }
                }
                const cleanText = fullText.trim();
                if (cleanText.length > 0) return cleanText;
            }
        } else {
            // Try explicit ytInitialPlayerResponse
            const playerResponseRegex = /ytInitialPlayerResponse\s*=\s*({.+?});/;
            const playerMatch = html.match(playerResponseRegex);
            if (playerMatch) {
                console.log(`[Transcript] Strategy 1.5: Found ytInitialPlayerResponse`);
                try {
                    const playerResponse = JSON.parse(playerMatch[1]);
                    const captions = (playerResponse.captions as any)?.playerCaptionsTracklistRenderer?.captionTracks;
                    if (captions) {
                        const enTrack = captions.find((t: any) => t.languageCode === 'en') || captions[0];
                        if (enTrack && enTrack.baseUrl) {
                            console.log(`[Transcript] Strategy 1.5: Found track in playerResponse, fetching...`);
                            const transcriptRes = await fetch(enTrack.baseUrl, {
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                                }
                            });
                            const transcriptXml = await transcriptRes.text();
                            const matches = transcriptXml.matchAll(/<text[^>]*>(.*?)<\/text>/g);
                            let fullText = "";
                            for (const match of matches) {
                                if (match[1]) fullText += match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") + " ";
                            }
                            if (fullText.trim().length > 0) return fullText.trim();
                        }
                    }
                } catch (e) {
                    console.log(`[Transcript] Strategy 1.5 playerResponse parse error: ${e}`);
                }
            }

            console.log(`[Transcript] Strategy 1.5 failed: captionTracks not found. HTML Preview: ${html.substring(0, 200)}`);
            errors.push(`Strategy 1.5: HTML Regex mismatch (IP likely blocked). content-preview: ${html.substring(0, 100)}...`);
        }
    } catch (e: any) {
        console.warn(`[Transcript] Strategy 1.5 failed: ${e.message}`);
        errors.push(`Strategy 1.5: ${e.message}`);
    }

    // Strategy 2: youtubei.js (Robust client emulation)
    // Attempt with different clients
    const clients = ['WEB', 'ANDROID', 'TV_EMBEDDED'] as const;

    for (const clientType of clients) {
        try {
            console.log(`[Transcript] Strategy 2 (${clientType}): youtubei.js for ${videoId}`);
            const yt = await Innertube.create({
                cache: new UniversalCache(false),
                generate_session_locally: true,
                client_type: clientType as any,
            });

            // Use Raw Player Fetch to bypass parsing bugs (especially in Android)
            const playerResponse = await yt.actions.execute('/player', {
                videoId: videoId,
                client: clientType,
                parse: true
            });

            // Extract caption tracks manually
            const captions = (playerResponse.captions as any)?.playerCaptionsTracklistRenderer?.captionTracks;

            if (captions && captions.length > 0) {
                console.log(`[Transcript] Strategy 2 (${clientType}): Found ${captions.length} tracks`);
                // Find English track
                const enTrack = captions.find((t: any) => t.languageCode === 'en') || captions[0];

                if (enTrack && enTrack.baseUrl) {
                    console.log(`[Transcript] Strategy 2 (${clientType}): Fetching transcript from ${enTrack.baseUrl}`);
                    const transcriptRes = await fetch(enTrack.baseUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
                        }
                    });

                    if (!transcriptRes.ok) {
                        console.warn(`[Transcript] Strategy 2 (${clientType}): Failed to fetch XML with status ${transcriptRes.status}`);
                        continue;
                    }

                    const transcriptXml = await transcriptRes.text();

                    // Simple XML parsing to extract text
                    // Handles <text ...>content</text>
                    const matches = transcriptXml.matchAll(/<text[^>]*>(.*?)<\/text>/g);
                    let fullText = "";
                    for (const match of matches) {
                        try {
                            let line = match[1];
                            // Decode basic entities
                            line = line.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
                            fullText += line + " ";
                        } catch (e) { }
                    }

                    if (fullText.length > 0) return fullText.trim();
                } else {
                    errors.push(`Strategy 2 (${clientType}): No English track URL found`);
                }
            } else {
                errors.push(`Strategy 2 (${clientType}): No caption tracks found in player response`);
            }
        } catch (e: any) {
            console.warn(`[Transcript] Strategy 2 (${clientType}) failed: ${e.message}`);
            errors.push(`Strategy 2 (${clientType}): ${e.message}`);
        }
    }

    // Strategy 3: Python Fallback (Existing Logic)
    try {
        console.log(`[Transcript] Strategy 3: Python Fallback for ${videoId}`);
        if (true) {
            // Keeping the block structure for now to minimize diff, but logic is fine.
            // Actually, let's just keep the contents.
            try {
                const { spawn } = require('child_process');
                const path = require('path');

                const scriptPath = path.join(process.cwd(), 'scripts', 'get_transcript.py');
                console.log(`[Transcript] Spawning python script: ${scriptPath} for ${videoId}`);

                const pythonProcess = spawn('python', [scriptPath, videoId]);

                let scriptOutput = '';
                let scriptError = '';

                await new Promise((resolve, reject) => {
                    pythonProcess.stdout.on('data', (data: any) => {
                        scriptOutput += data.toString();
                    });

                    pythonProcess.stderr.on('data', (data: any) => {
                        scriptError += data.toString();
                    });

                    pythonProcess.on('close', (code: any) => {
                        if (code !== 0) {
                            reject(new Error(`Python script exited with code ${code}. Error: ${scriptError}`));
                        } else {
                            resolve(null);
                        }
                    });
                });

                try {
                    const result = JSON.parse(scriptOutput);
                    if (result.transcript) {
                        return result.transcript;
                    } else if (result.error) {
                        throw new Error(result.error);
                    } else {
                        throw new Error('Invalid JSON output from Python script');
                    }
                } catch (e: any) {
                    throw new Error(`Failed to parse Python output: ${e.message}. Output: ${scriptOutput}`);
                }
            } catch (e: any) {
                console.warn(`[Transcript] Strategy 3 failed: ${e.message}`);
                errors.push(`Strategy 3: ${e.message}`);
            }
        }

    } catch (e: any) {
        console.warn(`[Transcript] Strategy 3 failed: ${e.message}`);
        errors.push(`Strategy 3: ${e.message}`);
    }

    throw new Error(`All transcript fetching strategies failed. Details: ${JSON.stringify(errors)}`);
}

export async function POST(req: NextRequest) {
    try {
        const { videoUrl } = await req.json();

        if (!videoUrl) {
            console.log("API Route Version: v2.0 (With Manual Strategy)");
            return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
        }

        console.log(`[Transcript] Request received for: ${videoUrl} (Version: v2.0)`);

        if (!process.env.GROQ_API_KEY) {
            return NextResponse.json({ error: 'Groq API key is not configured' }, { status: 500 });
        }

        // Extract Video ID
        const videoIdMatch = videoUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
        const videoId = videoIdMatch ? videoIdMatch[1] : null;

        if (!videoId) {
            return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
        }

        let transcriptText = '';
        try {
            transcriptText = await fetchTranscript(videoId, req.headers);
            console.log('Transcript fetched successfully, length:', transcriptText.length);
        } catch (error: any) {
            console.error("Transcript Error:", error);
            return NextResponse.json({ error: `Transcript fetch failed. Details: ${error.message || String(error)}` }, { status: 400 });
        }

        // Limit transcript length
        const truncatedTranscript = transcriptText.substring(0, 30000);

        // Generate Summary with Groq
        const summaryText = await generateSummary(truncatedTranscript);

        return NextResponse.json({ summary: summaryText });

    } catch (error) {
        console.error('API Error Details:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
}
