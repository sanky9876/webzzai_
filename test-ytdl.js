const ytdl = require('ytdl-core');

async function test() {
    try {
        const info = await ytdl.getInfo('https://www.youtube.com/watch?v=M7lc1UVf-VE');
        const tracks = info.player_response.captions?.playerCaptionsTracklistRenderer?.captionTracks;

        if (tracks && tracks.length > 0) {
            console.log('Success! Found captions.');
            console.log('Caption URL:', tracks[0].baseUrl);
        } else {
            console.log('No captions found.');
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

test();
