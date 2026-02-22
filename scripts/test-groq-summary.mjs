import dotenv from 'dotenv';
import { resolve } from 'path';

// Load .env.local before anything else
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

// Now import the library
import { generateSummary } from '../lib/llm.ts';

async function test() {
    console.log("GROQ_API_KEY present:", !!process.env.GROQ_API_KEY);

    const mockTranscript = "This is a video about building a dashboard with Next.js. We will cover setup, authentication, and deployment. First, install the dependencies. Then, configure your database. Finally, deploy to Vercel.";

    console.log("Testing Groq Summary Generation...");
    try {
        const summary = await generateSummary(mockTranscript);
        console.log("\n--- Generated Summary ---\n");
        console.log(summary);
        console.log("\n--- End of Summary ---\n");
        console.log("Verification successful!");
    } catch (error) {
        console.error("Verification failed:", error);
    }
}

test();
