const { YoutubeTranscript } = require('youtube-transcript');

async function test() {
    try {
        const videoId = 'jNQXAC9IVRw'; // "Me at the zoo" - actually might not have caption tracks in the format library expects?
        // Better video: "M7lc1UVf-VE" (Google Developers)
        const transcript = await YoutubeTranscript.fetchTranscript('M7lc1UVf-VE');
        console.log('Success!');
        console.log('Transcript length:', transcript.length);
        console.log('First line:', transcript[0].text);
    } catch (e) {
        console.error('Error:', e);
    }
}

test();
