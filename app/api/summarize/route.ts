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
        topic: "Quantum Physics & The Nature of Reality",
        summary: `Quantum physics is the study of matter and energy at its most fundamental level. It reveals that at very small scales, the universe operates on a set of rules that are vastly different from our daily experience.

**Key Concepts:**
1. **Superposition:** Particles like electrons can exist in multiple states or locations simultaneously until they are observed. This is famously illustrated by Schrödinger's Cat thought experiment.
2. **Entanglement:** Two particles can become 'linked' such that the state of one instantly influences the other, even if they are separated by billions of light-years. Albert Einstein famously called this "spooky action at a distance."
3. **Wave-Particle Duality:** Quantum entities exhibit properties of both particles (localized objects) and waves (oscillations that spread through space).
4. **Uncertainty Principle:** Proposed by Werner Heisenberg, it states that we cannot simultaneously know both the exact position and exact momentum of a particle with absolute precision.

**Impact on Technology:**
This field challenges our classical understanding of reality and forms the basis for modern technologies like transistors (the building blocks of computers), lasers, MRI machines, and the emerging field of quantum computing, which promises to solve complex problems far beyond the reach of current supercomputers.`
    },
    {
        topic: "The Comprehensive History of Pizza",
        summary: `Modern pizza, as we recognize it today, has a rich and complex history that spans centuries and continents. While flatbreads with toppings were consumed by ancient civilizations like the Greeks and Egyptians, the birthplace of the modern pizza is Naples, Italy.

**The Evolution:**
1. **Street Food Roots (1700s):** In the late 18th century, Naples was a thriving waterfront city. Pizza was a cheap, nutritious street food sold by informal vendors to the working poor (lazzaroni). It was initially dismissed by food writers as "disgusting."
2. **Royal Approval (1889):** Legend has it that Queen Margherita of Savoy visited Naples and was bored with the gourmet French cuisine. She requested a variety of pizzas from Pizzeria Brandi. Her favorite was the one featuring tomatoes, mozzarella, and basil—matching the colors of the Italian flag. This became the world-famous Pizza Margherita.
3. **The American Boom (1900s):** Italian immigrants brought pizza to the United States. Lombardi's, the first licensed pizzeria in New York, opened in 1905. However, pizza truly exploded in popularity after World War II, when returning soldiers who had tasted it in Italy began seeking it out at home.
4. **Global Phenomenon:** Today, pizza is one of the most popular foods on Earth, evolving into countless regional styles—from the thin, crispy New York slice to the deep-dish Chicago pie, and from the sophisticated artisanal varieties in Japan to the unique breakfast pizzas found in Australia.`
    },
    {
        topic: "Rainforests: The Lungs and Thermostats of Earth",
        summary: `Rainforests, particularly the massive Amazon Basin, play a crucial and irreplaceable role in regulating the Earth's climate and supporting life. They are often called the "Lungs of the Planet," but they act just as much as a global thermostat.

**Critical Functions:**
1. **Carbon Sequestration:** Tropical rainforests are massive carbon sinks. Through photosynthesis, they absorb billions of tons of carbon dioxide annually, helping to mitigate the greenhouse effect and slow global warming.
2. **The Water Cycle:** Rainforests are massive moisture pumps. Through a process called evapotranspiration, trees release water vapor into the atmosphere. This creates "flying rivers"—massive currents of moisture that influence rainfall patterns thousands of miles away, providing water for agriculture across entire continents.
3. **Biodiversity Hotspots:** While covering only 6% of Earth's land surface, rainforests house more than half of the world's plant and animal species. This biodiversity is a treasure trove for potential medical breakthroughs, as many of our modern pharmaceuticals are derived from rainforest plants.
4. **Global Cooling:** The dense canopy reflects sunlight and the constant evaporation of water creates clouds that further reflect solar radiation back into space, providing a cooling effect that is vital for maintaining global weather stability.

**Threats and Conservation:**
Deforestation for logging, mining, and cattle ranching remains a severe threat. Protecting these ecosystems is not just an environmental concern; it is a matter of global security and climate stability.`
    },
    {
        topic: "The Great Wall: More Than Just a Wall",
        summary: `The Great Wall of China is one of the most impressive architectural feats in human history, stretching across the historical northern borders of ancient Chinese states and Imperial China. It is not a single continuous wall but a complex system of fortifications.

**Construction and Purpose:**
1. **Centuries of Labor:** Construction began as early as the 7th century BC. Various dynasties added to, connected, and rebuilt sections over 2,000 years. The most famous and well-preserved sections we see today were built by the Ming Dynasty (1368–1644).
2. **Vast Dimensions:** The official length issued by China's State Administration of Cultural Heritage is 21,196 kilometers (over 13,000 miles). This includes actual walls, trenches, and natural defensive barriers like hills and rivers.
3. **Multifunctional Defense:** It served as more than just a barrier. It was a sophisticated military system featuring watchtowers for surveillance, beacon towers for long-distance signaling using smoke and fire, and garrisons for troops.
4. **Trade and Control:** The wall also helped regulate trade along the Silk Road, allowed for the collection of duties, and controlled the movement of people across the borders.

**Historical Myths:**
Contrary to the popular 20th-century myth, the Great Wall is generally not visible to the naked eye from the Moon, and it is difficult to see from low Earth orbit without specialized equipment or perfect conditions, as its materials often blend into the surrounding landscape.`
    },
    {
        topic: "AI in Medicine: The Future of Healthcare",
        summary: `Artificial Intelligence is no longer a futuristic concept in healthcare; it is actively revolutionizing how we diagnose, treat, and understand human health. From early detection to drug discovery, AI is enhancing the capabilities of medical professionals.

**Key Applications:**
1. **Medical Imaging & Diagnostics:** Machine learning algorithms, particularly deep learning, can analyze medical images (X-rays, MRIs, CT scans) with incredible speed. For certain conditions like skin cancer or diabetic retinopathy, AI has shown accuracy levels that rival or even exceed senior specialists.
2. **Personalized Medicine:** AI can process vast amounts of genetic data, lifestyle factors, and medical history to suggest highly tailorable treatment plans for individual patients, moving away from a "one-size-fits-all" approach.
3. **Drug Discovery:** Developing a new drug traditionally takes over a decade and billions of dollars. AI is slashing this time by predicting how different molecular structures will interact with targets in the body, identifying viable candidates in weeks rather than years.
4. **Virtual Health Assistants:** AI-powered chatbots and monitors help patients manage chronic conditions, provide mental health support, and offer preliminary triage, reducing the burden on overstretched healthcare systems.

**Ethical and Technical Challenges:**
Despite its promise, the integration of AI faces hurdles. These include data privacy concerns, the "black box" problem (understanding *how* an AI reached a specific conclusion), and the potential for algorithmic bias if the data used to train the AI is not sufficiently diverse.`
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

        const resultText = `### ${selected.topic}\n\n${selected.summary}\n\n---\n*(Note: This is a random summary generator as requested!)*`;

        // Artificial delay to simulate processing (4.5 seconds)
        await new Promise(resolve => setTimeout(resolve, 4500));

        return NextResponse.json({ summary: resultText });

    } catch (error: any) {
        console.error(`[${Date.now() - startTime}ms] [Summarize] API Error:`, error);
        return NextResponse.json({
            error: 'Internal Server Error',
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
