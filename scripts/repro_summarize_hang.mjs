import dotenv from 'dotenv';
import { resolve } from 'path';
import fetch from 'node-fetch'; // If not built-in, but node 24 should have it. Actually I'll use built-in fetch.

dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function repro() {
    const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"; // Never gonna give you up
    console.log("Starting reproduction for:", videoUrl);

    try {
        const response = await fetch('http://localhost:3000/api/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoUrl })
        });

        console.log("Status:", response.status);
        const data = await response.json();
        console.log("Data:", JSON.stringify(data).substring(0, 500));
    } catch (error) {
        console.error("Repro failed:", error);
    }
}

repro();
