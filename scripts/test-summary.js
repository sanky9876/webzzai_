
const fetch = require('node-fetch');

async function testSummary() {
    const videoUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // "Me at the zoo" - short, likely has captions
    const url = 'http://localhost:3000/api/summarize';

    console.log(`Testing Summarizer with: ${videoUrl}`);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoUrl })
        });

        const data = await res.json();

        console.log('Status:', res.status);
        if (data.summary) {
            console.log('SUCCESS!');
            console.log('Summary Preview:', data.summary.substring(0, 200));
        } else {
            console.error('FAILURE:', data);
        }

    } catch (e) {
        console.error('Error:', e);
    }
}

testSummary();
