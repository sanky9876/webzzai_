
const fetch = require('node-fetch'); // Assuming node-fetch is available or using built-in fetch in Node 18+

async function testRoute() {
    const url = 'http://localhost:3000/api/documents/123/answer';

    console.log(`Testing POST to ${url}...`);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: 'Test' })
        });

        console.log(`POST Status: ${res.status} (Expected 401 or 200, NOT 405)`);

        if (res.status === 405) {
            console.error('FATAL: Route returned 405 Method Not Allowed');
            console.log('Allow Header:', res.headers.get('allow'));
        } else {
            console.log('Response:', await res.text());
        }

    } catch (e) {
        console.error('POST Error:', e);
    }

    console.log(`Testing GET to ${url}...`);
    try {
        const res = await fetch(url, { method: 'GET' });
        console.log(`GET Status: ${res.status} (Expected 405)`);
    } catch (e) {
        console.error('GET Error:', e);
    }
}

testRoute();
