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
            console.log(`[${Date.now() - fetchStartTime}ms] [Transcript] ${name} SUCCEEDED`);
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

    const s2_python = async () => {
        // Check if python exists first to avoid waiting for a timeout on Vercel
        const hasPython = await new Promise(resolve => {
            const { exec } = require('child_process');
            exec('python --version', (err: any) => resolve(!err));
        });

        if (!hasPython) {
            const msg = "[Transcript] Python not found in this environment, skipping Strategy 2";
            console.log(msg);
            errors.push(msg);
            throw new Error("Python unavailable");
        }

        return runStrategy("Strategy 2 (Python)", async () => {
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
                }, 8000); // Shorter internal timeout

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
    };

    const s3_html = () => runStrategy("Strategy 3 (HTML-TimedText)", async () => {
        // Try both standard and Shorts URLs
        const urls = [
            `https://www.youtube.com/watch?v=${videoId}`,
            `https://www.youtube.com/shorts/${videoId}`
        ];

        for (const url of urls) {
            try {
                const res = await fetch(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36' }
                });
                const html = await res.text();

                const playerResponseRegex = /ytInitialPlayerResponse\s*=\s*({.+?});/;
                const match = html.match(playerResponseRegex);
                if (match) {
                    const playerRes = JSON.parse(match[1]);
                    const captions = playerRes?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                    if (captions && captions.length > 0) {
                        const track = captions.find((t: any) => t.languageCode === 'en' && !t.kind) ||
                            captions.find((t: any) => t.languageCode === 'en') ||
                            captions[0];
                        const transcriptRes = await fetch(track.baseUrl + "&fmt=vtt");
                        const vttText = await transcriptRes.text();
                        return vttText.replace(/WEBVTT[\s\S]*?\n\n/g, '').replace(/<[\s\S]*?>/g, '').replace(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g, '').replace(/\n+/g, ' ').trim();
                    }
                }
            } catch (e) { /* try next url */ }
        }
        throw new Error("No caption tracks found in HTML paths");
    });

    const s4_innertube = (client: 'WEB' | 'ANDROID' | 'TV' | 'IOS') => runStrategy(`Strategy 4 (Innertube-${client})`, async () => {
        const yt = await Innertube.create({ generate_session_locally: true, client_type: client as any });

        // Use raw player access to be safer against internal library crashes
        const playerResponse = await yt.actions.execute('/player', { videoId, parse: true });
        const captions = (playerResponse as any).captions?.player_captions_tracklist_renderer?.caption_tracks;

        if (captions && captions.length > 0) {
            const track = captions.find((t: any) => t.language_code === 'en') || captions[0];
            const baseUrl = track.base_url;
            if (baseUrl) {
                const res = await fetch(baseUrl + "&fmt=vtt");
                const vttText = await res.text();
                return vttText.replace(/WEBVTT[\s\S]*?\n\n/g, '').replace(/<[\s\S]*?>/g, '').replace(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g, '').replace(/\n+/g, ' ').trim();
            }
        }

        // Fallback to high-level API if player response was empty but not crashed
        const info = await yt.getInfo(videoId);
        const transcript = await info.getTranscript();
        const segments = (transcript as any)?.transcript?.content?.body?.initial_segments;
        if (!segments) throw new Error("No segments found");
        return segments.map((s: any) => s.snippet.text).join(' ');
    });

    const s5_description = () => runStrategy("Strategy 5 (Description Fallback)", async () => {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) throw new Error("No Google API Key for fallback");

        const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`);
        const data = await res.json();
        const description = data.items?.[0]?.snippet?.description;
        if (!description || description.trim().length < 50) throw new Error("Description too short or missing");
        return `[FALLBACK: TRANSCRIPT NOT AVAILABLE. USING VIDEO DESCRIPTION]\n\n${description}`;
    });

    // --- PARALLEL EXECUTION WAVE ---

    return new Promise<string>(async (resolve, reject) => {
        const globalTimeout = setTimeout(() => {
            reject(new Error(`Global 9.5s timeout. Errors: ${JSON.stringify(errors.slice(-4))}`));
        }, 9500);

        try {
            // Wave 1: Immediate Parallel Race
            const result = await Promise.any([
                s1_youtubeTranscript(),
                s3_html()
            ]);
            clearTimeout(globalTimeout);
            resolve(result);
        } catch (w1Fail) {
            try {
                // Wave 2: Robust Fallbacks
                const result = await Promise.any([
                    s2_python(),
                    s4_innertube('WEB'),
                    s4_innertube('IOS')
                ]);
                clearTimeout(globalTimeout);
                resolve(result);
            } catch (w2Fail) {
                try {
                    // Wave 3: Final Desperation (Description)
                    const result = await s5_description();
                    clearTimeout(globalTimeout);
                    resolve(result);
                } catch (s5Fail) {
                    clearTimeout(globalTimeout);
                    reject(new Error(`Full Failure. Logs: ${JSON.stringify(errors.slice(-6))}`));
                }
            }
        }
    });
}

const RANDOM_SUMMARIES = [
    {
        topic: "Quantum Physics",
        summary: "Quantum physics is the study of matter and energy at its most fundamental level. It reveals that at very small scales, particles like electrons can exist in multiple states simultaneously (superposition) and can be 'entangled', meaning the state of one instantly affects the other regardless of distance. This field challenges our classical understanding of reality and forms the basis for modern technologies like transistors and lasers."
    },
    {
        topic: "The History of Pizza",
        summary: "Modern pizza originated in Naples, Italy, in the late 18th century. Initially a cheap street food for the poor, it gained royal favor when Queen Margherita visited in 1889. The iconic Margherita pizza, with tomatoes, mozzarella, and basil, was created to represent the colors of the Italian flag. With Italian immigration to the US in the 20th century, pizza exploded in popularity globally, evolving into countless regional styles."
    },
    {
        topic: "How Rainforests Affect Climate",
        summary: "Rainforests, particularly the Amazon, play a crucial role in regulating the Earth's climate. They act as massive carbon sinks, absorbing billions of tons of CO2 annually. Through a process called evapotranspiration, they also release moisture into the atmosphere, creating 'flying rivers' that influence rainfall patterns thousands of miles away. Protecting these ecosystems is vital for maintaining global weather stability and biodiversity."
    },
    {
        topic: "The Great Wall of China",
        summary: "The Great Wall of China is a series of fortifications built across the historical northern borders of ancient Chinese states. Construction began as early as the 7th century BC, but the most famous sections were built by the Ming Dynasty. It stretches over 13,000 miles and served not just for defense, but also for border control, trade regulation, and signaling. Contrary to popular myth, it is not easily visible from space without aid."
    },
    {
        topic: "Artificial Intelligence in Medicine",
        summary: "AI is revolutionizing healthcare by improving diagnostic accuracy and personalized treatment. Machine learning algorithms can analyze medical images like X-rays and MRIs often faster and more accurately than humans. AI also helps in drug discovery by predicting how different molecules will interact, potentially saving years of research. While promising, it also raises important ethical questions regarding data privacy and the 'black box' nature of some algorithms."
    }
];

export async function POST(req: NextRequest) {
    const startTime = Date.now();
    try {
        const { videoUrl } = await req.json();

        if (!videoUrl) {
            return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
        }

        console.log(`[${Date.now() - startTime}ms] [Summarize] Request received for: ${videoUrl}`);

        // Select a random summary
        const randomIndex = Math.floor(Math.random() * RANDOM_SUMMARIES.length);
        const selected = RANDOM_SUMMARIES[randomIndex];

        console.log(`[${Date.now() - startTime}ms] [Summarize] Returning random summary for topic: ${selected.topic}`);

        const resultText = `**Topic: ${selected.topic}**\n\n${selected.summary}\n\n*(Note: This is a random summary generator as requested!)*`;

        // Artificial delay to simulate processing
        await new Promise(resolve => setTimeout(resolve, 1000));

        return NextResponse.json({ summary: resultText });

    } catch (error: any) {
        console.error(`[${Date.now() - startTime}ms] [Summarize] API Error:`, error);
        return NextResponse.json({
            error: 'Internal Server Error',
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
