async function test() {
    try {
        const res = await fetch('http://localhost:3000/api/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoUrl: 'https://www.youtube.com/watch?v=M7lc1UVf-VE' })
        });

        const data = await res.json();
        console.log('Status:', res.status);
        if (data.summary) {
            console.log('Summary length:', data.summary.length);
            console.log('Snippet:', data.summary.substring(0, 100));
        } else {
            console.log('Error:', data);
        }
    } catch (e) {
        console.error('Fetch error:', e);
    }
}

test();
