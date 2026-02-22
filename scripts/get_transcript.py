import sys
import json
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound

def get_transcript(video_id):
    try:
        # Initialize the API
        api = YouTubeTranscriptApi()
        
        # Get available transcripts
        transcript_list = api.list(video_id)
        
        # Try finding English
        try:
            transcript = transcript_list.find_transcript(['en'])
        except NoTranscriptFound:
            transcript = next(iter(transcript_list))
            
        data = transcript.fetch()
        # In newer versions, data is a list of snippets which might be objects
        try:
            full_text = " ".join([entry.text for entry in data])
        except AttributeError:
            # Fallback for dict structure if it's actually dicts
            full_text = " ".join([entry['text'] for entry in data])
        
        print(json.dumps({
            "transcript": full_text, 
            "language": getattr(transcript, 'language_code', 'unknown'), 
            "generated": getattr(transcript, 'is_generated', False)
        }))

    except TranscriptsDisabled:
        print(json.dumps({"error": "Transcripts are disabled for this video."}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        video_id = sys.argv[1]
        get_transcript(video_id)
    else:
        print(json.dumps({"error": "No video ID provided"}))
