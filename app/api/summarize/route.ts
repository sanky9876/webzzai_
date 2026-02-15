import { NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Innertube, UniversalCache } from 'youtubei.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Helper to fetch transcript using multiple strategies
async function fetchTranscript(videoId: string): Promise<string> {
    let errors: string[] = [];

    // Strategy 1: youtube-transcript (Lightweight, often works)
    try {
        console.log(`[Transcript] Strategy 1: youtube-transcript for ${videoId}`);
        const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
        const text = transcriptItems.map(item => item.text).join(' ');
        if (text.length > 0) return text;
    } catch (e: any) {
        console.warn(`[Transcript] Strategy 1 failed: ${e.message}`);
        errors.push(`Strategy 1: ${e.message}`);
    }

    // Strategy 2: youtubei.js (Robust client emulation)
    try {
        console.log(`[Transcript] Strategy 2: youtubei.js for ${videoId}`);
        const yt = await Innertube.create({ cache: new UniversalCache(false), generate_session_locally: true });
        const info = await yt.getInfo(videoId);
        const transcriptData = await info.getTranscript();

        if (transcriptData && transcriptData.transcript) { // Check if transcript data exists
            const text = transcriptData.transcript.content?.body?.initial_segments.map((segment: any) => segment.snippet.text).join(' ') || '';
            if (text.length > 0) return text;
        }

    } catch (e: any) {
        console.warn(`[Transcript] Strategy 2 failed: ${e.message}`);
        errors.push(`Strategy 2: ${e.message}`);
    }

    // Strategy 3: Python Fallback (Existing Logic)
    try {
        console.log(`[Transcript] Strategy 3: Python Fallback for ${videoId}`);
        if (process.env.VERCEL) {
            // Production: Use Python Serverless Function
            const baseUrl = `https://${process.env.VERCEL_URL}`;
            const transcriptUrl = `${baseUrl}/api/transcript?videoId=${videoId}`;
            const transcriptRes = await fetch(transcriptUrl);
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
            return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
        }

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
            transcriptText = await fetchTranscript(videoId);
            console.log('Transcript fetched successfully, length:', transcriptText.length);
        } catch (error) {
            console.error("Transcript Error:", error);
            return NextResponse.json({ error: 'Could not retrieve transcript. The video might not have captions enabled or is restricted.' }, { status: 400 });
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
