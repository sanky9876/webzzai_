import { NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(req: Request) {
    try {
        const { videoUrl } = await req.json();

        if (!videoUrl) {
            return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
        }

        if (!process.env.GEMINI_API_KEY) {
            console.error('Gemini API key is missing in environment variables');
            return NextResponse.json({ error: 'Gemini API key is not configured' }, { status: 500 });
        }

        // Extract Video ID
        const videoIdMatch = videoUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
        const videoId = videoIdMatch ? videoIdMatch[1] : null;

        if (!videoId) {
            return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
        }

        // Fetch Transcript using Python script (as fallback for JS library issues)
        // Hybrid approach: Vercel Serverless Function (Prod) vs Child Process (Local)
        let transcriptText = '';
        try {
            if (process.env.VERCEL) {
                // Production: Use Python Serverless Function via internal fetch
                // VERCEL_URL is provided by Vercel environment
                const baseUrl = `https://${process.env.VERCEL_URL}`;
                const transcriptUrl = `${baseUrl}/api/transcript?videoId=${videoId}`;
                console.log('Fetching transcript from:', transcriptUrl);

                const transcriptRes = await fetch(transcriptUrl);
                if (!transcriptRes.ok) {
                    const errorData = await transcriptRes.json().catch(() => ({}));
                    throw new Error(errorData.error || `Serverless function failed with status ${transcriptRes.status}`);
                }

                const data = await transcriptRes.json();
                transcriptText = data.transcript || '';

            } else {
                // Local Development: Use Python Script via child_process spawn
                const { spawn } = await import('child_process');
                const path = await import('path');

                const scriptPath = path.join(process.cwd(), 'scripts', 'get_transcript.py');

                transcriptText = await new Promise<string>((resolve, reject) => {
                    const pythonProcess = spawn('python', [scriptPath, videoId]);
                    let dataString = '';
                    let errorString = '';

                    pythonProcess.stdout.on('data', (data) => {
                        dataString += data.toString();
                    });

                    pythonProcess.stderr.on('data', (data) => {
                        errorString += data.toString();
                    });

                    pythonProcess.on('close', (code) => {
                        if (code !== 0) {
                            reject(new Error(errorString || 'Python script exited with error'));
                            return;
                        }
                        try {
                            const result = JSON.parse(dataString);
                            if (result.error) {
                                reject(new Error(result.error));
                            } else {
                                resolve(result.transcript || '');
                            }
                        } catch (e) {
                            reject(new Error('Failed to parse Python script output: ' + dataString));
                        }
                    });
                });
            }

            console.log('Transcript fetched, length:', transcriptText.length);

        } catch (error) {
            console.error("Transcript Error:", error);
            // Fallback error message
            return NextResponse.json({ error: 'Could not retrieve transcript. The video might not have captions enabled or is restricted.' }, { status: 400 });
        }

        // Limit transcript length to avoid token limits (rudimentary check)
        // defined limit 30000 characters ~ 7000-8000 tokens, well within Gemini 1.5 Flash limit
        const truncatedTranscript = transcriptText.substring(0, 30000);

        if (transcriptText.length === 0) {
            return NextResponse.json({ error: 'No transcript found for this video.' }, { status: 400 });
        }

        // Generate Summary with Gemini
        // Using gemini-flash-latest for best availability
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
