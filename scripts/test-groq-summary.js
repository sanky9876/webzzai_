require('dotenv').config({ path: '.env.local' });
const { generateSummary } = require('./lib/llm');

async function test() {
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
