// using native fetch

async function debugManual() {
    const videoId = 'DYDs_Inzkz4';
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    console.log(`Fetching HTML for ${videoUrl}...`);

    try {
        const response = await fetch(videoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });
        const html = await response.text();

        console.log(`HTML Length: ${html.length}`);

        // Look for captionTracks
        const captionTracksRegex = /"captionTracks":\s*(\[.*?\])/;
        const match = html.match(captionTracksRegex);

        if (match) {
            console.log('Found captionTracks!');
            const captionTracks = JSON.parse(match[1]);
            console.log(`Number of tracks: ${captionTracks.length}`);

            // Find English
            const enTrack = captionTracks.find(t => t.languageCode === 'en') || captionTracks[0];
            console.log(`Using track: ${enTrack.name.simpleText} (${enTrack.languageCode})`);
            console.log(`URL: ${enTrack.baseUrl}`);

            // Fetch transcript xml/json
            const transcriptRes = await fetch(enTrack.baseUrl);
            const transcriptXml = await transcriptRes.text();

            console.log(`Transcript XML Length: ${transcriptXml.length}`);
            console.log('Snippet:', transcriptXml.substring(0, 100));

        } else {
            console.log('No captionTracks found in HTML.');
            // Dump part of HTML to see if we got a consent page or something
            console.log('HTML Snippet:', html.substring(0, 500));
        }

    } catch (e) {
        console.error('Error:', e);
    }
}

debugManual();
