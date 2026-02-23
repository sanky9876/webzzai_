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
        topic: "The Ultimate Guide to Quantum Mechanics & The Fabric of Reality",
        summary: `# Part 1: Foundations and the Classical Crisis

Quantum mechanics is the branch of physics that deals with the behavior of matter and energy at the scale of atoms and subatomic particles. It is the most successful physical theory in human history, providing the basis for our entire modern technological civilization.

## 1.1 The Birth of the Quantum
At the tail end of the 19th century, physicists believed they had nearly completed the "Grand Map of Physics." Newtonian mechanics explained the motion of planets, and Maxwell’s equations explained electromagnetism. However, two major anomalies remained: **Blackbody Radiation** and the **Photoelectric Effect**. 

Max Planck solved the former in 1900 by proposing a radical idea: energy is not continuous, like water flowing, but is emitted in discrete packets relative to a constant. He called these packets "quanta." Albert Einstein later extended this to light, proposing that light itself is made of particles called photons. This was the spark that lit the quantum fire.

## 1.2 Wave-Particle Duality
Perhaps the most jarring aspect of quantum mechanics is that every particle or quantum entity may be described as either a particle or a wave. The famous **Double-Slit Experiment** demonstrates this: when electrons are fired at two slits, they form an interference pattern (like waves) even when fired one at a time. However, if we "watch" which slit the electron goes through using a detector, the interference pattern disappears, and it behaves like a classical particle. This suggests that the universe behaves differently depending on whether it is being observed.

# Part 2: Core Quantum Principles - The 'Weirdness' Explained

## 2.1 The Wave Function (Psi) and Probability
In the quantum realm, we stop using definite trajectories and start using probabilities. The state of a system is described by a mathematical entity called the **Wave Function**. The square of the wave function gives the probability of finding a particle in a specific location. Before a measurement is made, the particle is literally spread out across all possible locations.

## 2.2 Superposition: The Multi-State Reality
A quantum system can exist in multiple states simultaneously. This is **Superposition**. A famous thought experiment by Erwin Schrödinger involves a cat in a box that is both "dead and alive" until someone opens the box to look. While it sounds like a paradox, superposition is what allows quantum computers to process massive amounts of data in parallel.

## 2.3 Entanglement: Einstein's 'Spooky Action'
When two particles become entangled, their states are inextricably linked. Measuring the spin of one particle instantly determines the spin of the other, no matter how far apart they are—even if they are on opposite sides of the galaxy. This communication happens faster than the speed of light, a phenomenon that famously bothered Albert Einstein, who called it "spooky action at a distance."

## 2.4 Heisenberg’s Uncertainty Principle
You cannot know everything. Specifically, the more accurately you know a particle's position, the less accurately you can know its momentum. This isn't a limitation of our tools or our human intelligence; it is a fundamental, baked-in property of the universe itself. At the smallest scales, nature is inherently fuzzy.

# Part 3: Advanced Concepts and the Quantum Field

## 3.1 Quantum Tunneling
Quantum tunneling is the phenomenon where a particle can pass through a potential barrier that it classically should not be able to cross. Think of it as a ball "ghosting" through a solid wall. This is how the Sun shines (nuclear fusion) and how your USB plastic memory sticks function.

## 3.2 The Pauli Exclusion Principle
Proposed by Wolfgang Pauli, this principle states that no two fermions (like electrons) can occupy the same quantum state simultaneously. This is the reason why solid matter exists. Without it, all the electrons in your body would collapse into the lowest energy level, and you would disappear into a single point of light.

## 3.3 Quantum Electrodynamics (QED)
Richard Feynman, Julian Schwinger, and Sin-Itiro Tomonaga developed QED to describe how light and matter interact. It is often cited as the most precise theory in science, with predictions matching experimental results to more than ten decimal places.

# Part 4: Applications and the Second Quantum Revolution

## 4.1 The Silicon Age
Without quantum mechanics, we would not have the **Transistor**. Since every digital device on Earth—phones, laptops, cars, medical monitors—relies on trillions of transistors, the entire digital age is a direct product of quantum science. Lasers, MRI machines, and LED lights also rely on deliberate quantum transitions.

## 4.2 Quantum Computing: The Final Frontier
We are now entering the "Second Quantum Revolution." Quantum computers use **Qubits** (which can be 0, 1, or a superposition of both) to perform calculations that would take a classical supercomputer thousands of years. This will revolutionize cryptography, drug discovery for cancer and Alzheimer's, and the creation of new materials.

## 4.3 Quantum Teleportation and Communication
Scientists have already achieved quantum teleportation of information. This doesn't mean moving matter (like in Star Trek), but it does allow for unhackable communication networks using Quantum Key Distribution (QKD). In a future quantum internet, any attempt to eavesdrop would instantly collapse the wave function, alerting the users.

# Part 5: Philosophical and Cosmological Implications

Quantum mechanics suggests that the act of observation is fundamental to the creation of reality. This has led to several competing "Interpretations":
- **Copenhagen Interpretation:** The universe is probabilistic, and the wave function "collapses" into a single state only when an observer intervenes.
- **Many-Worlds Interpretation:** Every quantum event branches the universe into multiple parallel realities. In this view, there are infinite versions of you living in an infinite Multiverse.
- **Objective Reduction:** Speculates that consciousness or gravity itself causes the wave function to collapse naturally.

**Conclusion:**
Quantum mechanics is not just a branch of physics; it is a fundamental shift in how we perceive existence. It tells us that the world is not a collection of solid objects moving through space, but a vast, interconnected web of probabilities and energy that only becomes "real" when we choose to look.`
    },
    {
        topic: "The Culinary Odyssey: A Definitive History of Pizza and Civilization",
        summary: `# Section 1: The Pre-History of Flatbreads (Ancient Era)

The story of pizza does not begin in an Italian kitchen with a red-and-white checkered tablecloth; it begins with the first agricultural revolutions of humanity. Flatbread is the oldest form of bread in human history, born when early humans first learned to crush grain, mix it with water, and bake it on hot stones.

## 1.1 The Persian Shield-Bakers
Historical records from the 6th century BC suggest that the soldiers of the Persian Empire, under the leadership of King Darius the Great, would bake flatbreads on their bronze shields while on the march. They would top these breads with cheese and dates for energy—making these essentially the world's first documented "pizzas."

## 1.2 The Greco-Roman 'Plakous'
The ancient Greeks developed a version called "plakous," which was a flat dough flavored with oils, herbs, garlic, and onions. When the Romans conquered Greece, they adopted this food and called it "picea." In the ruins of Pompeii, archaeologists have found evidence of shops that closely resemble modern pizzerias, including circular bread fossils.

# Section 2: Naples - The Crucible of the Modern Pizza

## 2.1 The Poor Man's Survival Meal (17th-18th Century)
By the 1700s, Naples had become a bustling, overpopulated maritime hub. To feed the massive population of urban poor (known as the lazzaroni), bakers began selling large, flat dough rounds topped with lard, salt, and garlic. It was food for people who had no kitchen and had to eat while walking. For centuries, the wealthy elite viewed pizza with absolute disgust, describing it as "socially inferior" and "unrefined."

## 2.2 The Great Tomato Breakthrough
Tomatoes arrived in Europe from the "New World" (the Americas) in the 1500s. For over two centuries, they were feared as poisonous because they belonged to the nightshade family. It was only the starving peasants of Naples who, out of sheer desperation, began putting sliced tomatoes on their flatbread. This was the singular moment that defined "pizza" as a unique dish rather than just another bread.

## 2.3 The Royal Visit of 1889
The turning point for pizza's image came with the unification of Italy. King Umberto I and Queen Margherita visited Naples in 1889. The Queen, tired of the repetitive and heavy French cuisine of the court, asked to try the local peasant food. Chef Raffaele Esposito was summoned to create something special. He presented three varieties:
1. Pizza with lard and cheese.
2. Pizza with tiny fish (cecenielli).
3. Pizza with tomato, mozzarella, and fresh basil.

The Queen was enamored with the third one because its colors (red, white, and green) matched the new Italian flag. This variety was named the "Margherita" in her honor, and it bestowed royal legitimacy upon a food that was once considered a "peasant's disgrace."

# Section 3: The Global Diaspora and American Influence

## 3.1 Migration and the Birth of the New York Slice
In the late 19th and early 20th centuries, millions of Italians migrated to the United States. In 1905, Gennaro Lombardi opened the first licensed pizzeria in America on Spring Street in Manhattan. Because many customers couldn't afford a whole pie, he began selling it by the slice—a tradition that would define New York food culture for the next century.

## 3.2 The Post-WWII Transformation
Pizza remained an ethnic curiosity until World War II. American soldiers who had been stationed in Italy during the liberation discovered the dish and returned home with a massive craving for it. Within a decade, pizzerias began appearing in every small town in the Midwest and the South.

## 3.3 The Era of Delivery and Global Chains
The 1950s saw the arrival of the "Fast Food" revolution. Brothers Dan and Frank Carney founded Pizza Hut in 1958, and Tom Monaghan started Domino’s in 1960. By focusing on car-culture and rapid home delivery, they turned a handcrafted Italian trade into a multi-billion dollar global industry.

# Section 4: A World of Diversity (Regional Styles)

## 4.1 The American Trinity
- **New York Style:** Large, flexible, thin-crust slices meant to be folded in half. The secret is often said to be the mineral content of NYC's tap water used in the dough.
- **Chicago Deep-Dish:** More like a savory cake than a flatbread. It is baked in an oiled steel pan, with layers of mozzarella followed by meat/vegetables, and finally a thick layer of crushed tomato sauce on top.
- **Detroit Style:** A rectangular pizza with a thick, airy crust and a characteristic "frico"—a crispy, caramelized cheese edge formed against the walls of the square pan.

## 4.2 International Interpretations
- **Brazil:** Known for eccentric toppings like green peas, raisins, and incluso hard-boiled eggs.
- **Japan:** Often features "luxury" toppings like seafood, squid ink, or Wagyu beef, frequently accompanied by kewpie mayonnaise.
- **Sweden:** Famous for the "Banana Curry Pizza," which features ham, curry powder, and sliced bananas.

# Section 5: The Science and Ethics of Pizza Today

In recent years, there has been a movement back toward the artisanal roots of pizza. The **AVPN (Associazione Verace Pizza Napoletana)** mandates that "true" Neapolitan pizza must be baked in wood-fired ovens at exactly 905°F for no more than 60-90 seconds. It must use only highly refined "Tipo 00" flour and San Marzano tomatoes grown on the volcanic slopes of Mount Vesuvius.

**Conclusion:**
From its beginnings as a Persian shield-snack to its current status as a $150 billion global industry, pizza is more than just food. It is a mirror of human migration, social class evolution, and cultural adaptation. Whether it's a $1 slice in a subway station or a $50 artisanal pie in Rome, pizza remains the world's most universal language of sustenance.`
    },
    {
        topic: "The Amazon Biome: The Living Heart of the Planet",
        summary: `# Part 1: Anatomy of a Giant (Geography and Climate)

The Amazon Rainforest is not just a forest; it is a colossal, self-sustaining biological engine that fundamentally influences the entire planet's systems. Spanning 5.5 million square kilometers (about 2.1 million square miles), it covers more than half of the world's remaining tropical rainforest territory.

## 1.1 The Nine Nations
While 60% of the Amazon is within Brazil, the biome stretches across eight other nations: Peru, Colombia, Venezuela, Ecuador, Bolivia, Guyana, Suriname, and French Guiana. This makes it a complex geopolitical entity requiring international cooperation for its protection.

## 1.2 The Mighty River System
The rainforest is anchored by the Amazon River, the largest river in the world by the volume of water it discharges. It carries approximately 20% of all the freshwater that enters the Earth's oceans. The river is so deep and wide that ocean-going ships can navigate thousands of miles inland to the city of Iquitos in Peru.

# Part 2: The Cradle of Biodiversity

The Amazon is the most biodiverse place on Earth. It is estimated that one in ten known species in the world—and one in five known bird species—live in the Amazon.

## 2.1 The Flora: The Green Canopy
The Amazon contains an estimated **390 billion individual trees**, divided into more than 16,000 species. These range from the massive Kapok trees that tower over the canopy to delicate epiphytes that live entirely on the branches of other plants.

## 2.2 The Fauna: Lords of the Jungle
- **Apex Predators:** The Jaguar is the king of the Amazon floor, while the Black Caiman reigns in the water.
- **The Canopy Dwellers:** Thousands of species of monkeys, including the Golden Lion Tamarin and the Howler Monkey, spend their entire lives in the treetops.
- **The River Giants:** The Amazon is home to the Pink River Dolphin, the Giant Otter, and the Arapaima—one of the world's largest freshwater fish.

## 2.3 The Pharmaceutical Goldmine
The Amazon is often called the "World's Largest Apothecary." Over 25% of all modern pharmaceuticals are derived from rainforest plants, yet we have studied less than 5% of its floral diversity for medicinal use. Discoveries like **Quinine** (for malaria) and the base for modern muscle relaxants would have been impossible without the knowledge derived from this biome.

# Part 3: The Earth's Thermostat (Climate Regulation)

## 3.1 Carbon Sequestration: The Global Sink
The Amazon acts as a massive carbon sponge, absorbing about 2 billion tons of carbon dioxide every single year. By pulling this carbon out of the atmosphere, it provides a critical buffer against the worst effects of the greenhouse effect and climate change.

## 3.2 The 'Flying Rivers'
This is perhaps the Amazon's most vital "service." Through a process called evapotranspiration, the trees of the Amazon pump moisture into the air. A single large tree can release 1,000 liters of water in a single day. This creates massive "Flying Rivers" of vapor that travel across South America, providing the rainfall necessary for multibillion-dollar agriculture in regions as far away as Argentina and Paraguay. Without the Amazon, the southern half of the continent would likely turn into a desert.

# Part 4: The Tipping Point and Environmental Crisis

## 4.1 Drivers of Destruction
The Amazon is facing an unprecedented crisis. The primary drivers are:
- **Agribusiness:** Massive tracts are cleared for cattle ranching (70% of deforestation) and large-scale soy production.
- **Illicit Activity:** Illegal logging and gold mining poison the soil and water with mercury.
- **Infrastructure:** Highways like the Trans-Amazonian Highway slice through the heart of the jungle, making it easier for land grabbers to access remote areas.

## 4.2 The Dieback Scenario (The Tipping Point)
Scientists warn that we are approaching a "Tipping Point." If 20-25% of the forest cover is lost, the ecosystem will lose its ability to generate its own rain. At this point, the entire biome will enter a "Dieback" phase, where the lush rainforest collapses and is replaced by a dry, fire-prone savanna. This would release billions of tons of stored carbon, making it impossible to meet global climate goals.

# Part 5: Human History and Indigenous Guardians

## 5.1 The Myth of the 'Empty' Jungle
For centuries, the Amazon was viewed as a "pristine wilderness" untouched by humans until European arrival. Modern archaeology has shattered this myth. We now know that millions of people lived in the Amazon for thousands of years, creating complex civilizations and even engineered soil (Terra Preta) that is incredibly fertile.

## 5.2 Traditional Stewardship
Today, the Amazon is home to over 30 million people, including 400 distinct indigenous groups. These communities are the most effective protectors of the forest. Satellite data shows that "Indigenous Territories" have significantly lower rates of deforestation than surrounding areas. Supporting their land rights is widely seen as the most effective "nature-based solution" to the climate crisis.

**Conclusion:**
The Amazon is not just a distant jungle; it is a vital part of the life support system of every human being on Earth. Whether you live in New York, London, or Tokyo, the air you breathe and the stability of the climate you live in rely on the healthy heartbeat of the Amazon.`
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

        // Artificial delay to simulate processing (10 seconds)
        await new Promise(resolve => setTimeout(resolve, 10000));

        return NextResponse.json({ summary: resultText });

    } catch (error: any) {
        console.error(`[${Date.now() - startTime}ms] [Summarize] API Error:`, error);
        return NextResponse.json({
            error: 'Internal Server Error',
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
