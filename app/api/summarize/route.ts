import { NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Innertube, UniversalCache } from 'youtubei.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });
        const html = await htmlRes.text();

        const captionTracksRegex = /"captionTracks":\s*(\[.*?\])/;
        const match = html.match(captionTracksRegex);

        if (match) {
            const captionTracks = JSON.parse(match[1]);
            const enTrack = captionTracks.find((t: any) => t.languageCode === 'en') || captionTracks[0];

            if (enTrack && enTrack.baseUrl) {
                console.log(`[Transcript] Strategy 1.5: Found track, fetching from ${enTrack.baseUrl}`);
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
        if (process.env.VERCEL) {
            // Production: Use Python Serverless Function
            const baseUrl = `https://${process.env.VERCEL_URL}`;
            const transcriptUrl = `${baseUrl}/api/transcript?videoId=${videoId}`;
            console.log(`Fetching from Python URL: ${transcriptUrl}`);

            // Forward headers to bypass Vercel protection (401)
            const headers = new Headers();
            if (requestHeaders) {
                if (requestHeaders.get('cookie')) headers.set('cookie', requestHeaders.get('cookie')!);
                if (requestHeaders.get('authorization')) headers.set('authorization', requestHeaders.get('authorization')!);
            }

            const transcriptRes = await fetch(transcriptUrl, { headers });
            if (!transcriptRes.ok) {
                const errorData = await transcriptRes.json().catch(() => ({}));
                throw new Error(errorData.error || `Serverless function failed with status ${transcriptRes.status}`);
            }
            const data = await transcriptRes.json();
            if (data.transcript) return data.transcript;

        } else {
            // Local: Use Python Script via child_process
            const { spawn } = await import('child_process');
            const path = await import('path');
            const scriptPath = path.join(process.cwd(), 'scripts', 'get_transcript.py');

            const transcriptText = await new Promise<string>((resolve, reject) => {
                const pythonProcess = spawn('python', [scriptPath, videoId]);
                let dataString = '';
                let errorString = '';

                pythonProcess.stdout.on('data', (data) => dataString += data.toString());
                pythonProcess.stderr.on('data', (data) => errorString += data.toString());

                pythonProcess.on('close', (code) => {
                    if (code !== 0) {
                        reject(new Error(errorString || 'Python script exited with error'));
                        return;
                    }
                    try {
                        const result = JSON.parse(dataString);
                        if (result.error) reject(new Error(result.error));
                        else resolve(result.transcript || '');
                    } catch (e) {
                        reject(new Error('Failed to parse Python script output: ' + dataString));
                    }
                });
            });
            if (transcriptText.length > 0) return transcriptText;
        }

    } catch (e: any) {
        console.warn(`[Transcript] Strategy 3 failed: ${e.message}`);
        errors.push(`Strategy 3: ${e.message}`);
    }

    throw new Error(`All transcript fetching strategies failed. Details: ${JSON.stringify(errors)}`);
}

export async function POST(req: Request) {
    try {
        const { videoUrl } = await req.json();

        if (!videoUrl) {
            console.log("API Route Version: v2.0 (With Manual Strategy)");
            return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
        }

        console.log(`[Transcript] Request received for: ${videoUrl} (Version: v2.0)`);

        if (!process.env.GEMINI_API_KEY) {
            return NextResponse.json({ error: 'Gemini API key is not configured' }, { status: 500 });
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

        // Generate Summary with Gemini
        const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
        const prompt = `
      You are an expert AI study assistant. 
      Analyze the following YouTube video transcript and generate a comprehensive summary and structured study notes.
      
      Output Format:
      # Video Title (Infer if possible, else "Video Summary")
      
      ## Summary
      [Concise summary of the video content]

      ## Key Concepts
      - [Concept 1]: [Explanation]
      - [Concept 2]: [Explanation]

      ## Study Notes
      [Detailed bullet points or numbered list]

      ## Quiz (Optional)
      [3 short questions to test understanding]

      ---
      Transcript:
      ${truncatedTranscript}
    `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        return NextResponse.json({ summary: text });

    } catch (error) {
        console.error('API Error Details:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
}
