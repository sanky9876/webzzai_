const { Innertube, UniversalCache } = require('youtubei.js');

async function debug() {
    const videoId = 'DYDs_Inzkz4';
    const clientType = 'ANDROID';

    console.log(`Testing raw player fetch with client: ${clientType} for video: ${videoId}`);

    try {
        const yt = await Innertube.create({
            cache: new UniversalCache(false),
            generate_session_locally: true,
            client_type: clientType,
        });

        console.log('Innertube created.');

        const playerResponse = await yt.actions.execute('/player', {
            videoId: videoId,
            client: clientType,
            parse: true
        });

        console.log('Player response fetched.');

        if (playerResponse.captions) {
            console.log('Found captions object!');
            console.log(JSON.stringify(playerResponse.captions, null, 2));
        } else {
            console.log('No captions found in player response.');
            console.log('Keys:', Object.keys(playerResponse));
        }

    } catch (e) {
        console.error('ERROR:', e);
    }
}

debug();
