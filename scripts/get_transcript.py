import sys
import json
from youtube_transcript_api import YouTubeTranscriptApi

def get_transcript(video_id):
    try:
        # Fetch transcript using instance method
        api = YouTubeTranscriptApi()
        transcript = api.fetch(video_id)
        
        # Combine text
        # The result is a list of objects, not dicts
        try:
             full_text = " ".join([entry.text for entry in transcript])
        except AttributeError:
             # Fallback if attribute is different
             # Inspect the first item to debug
             if len(transcript) > 0:
                 print(json.dumps({"error": f"Unknown attribute structure. First item attributes: {dir(transcript[0])}"}))
                 return
             full_text = ""

        print(json.dumps({"transcript": full_text}))

    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    if len(sys.argv) > 1:
        video_id = sys.argv[1]
        get_transcript(video_id)
    else:
        print(json.dumps({"error": "No video ID provided"}))
