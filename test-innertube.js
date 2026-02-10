const { Innertube } = require('youtubei.js');

async function test() {
    try {
        const youtube = await Innertube.create();
        const info = await youtube.getInfo('M7lc1UVf-VE'); // Use a video known to have captions
        const transcript = await info.getTranscript();

        console.log('Success!');
        console.log('Transcript length:', transcript.transcript.content.body.initial_segments.length);
        console.log('First segment:', transcript.transcript.content.body.initial_segments[0].snippet.text);
    } catch (e) {
        console.error('Error:', e);
    }
}

test();
