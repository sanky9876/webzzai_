from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import json
from youtube_transcript_api import YouTubeTranscriptApi

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Parse query params
        url_components = urlparse(self.path)
        query_params = parse_qs(url_components.query)
        video_id = query_params.get('videoId', [None])[0]

        # Set headers
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()

        if not video_id:
            response = {"error": "Missing videoId parameter"}
            self.wfile.write(json.dumps(response).encode('utf-8'))
            return

        try:
            # Instantiate and fetch
            api = YouTubeTranscriptApi()
            transcript = api.fetch(video_id)
            
            # Combine text
            # The result is a list of objects based on previous introspection
            try:
                 full_text = " ".join([entry.text for entry in transcript])
            except AttributeError:
                 # Fallback if attribute is different or dict
                 if len(transcript) > 0 and isinstance(transcript[0], dict):
                     full_text = " ".join([entry['text'] for entry in transcript])
                 else:
                     # Check other attributes if needed, but assuming .text works based on local test
                     full_text = " ".join([str(entry) for entry in transcript])

            response = {"transcript": full_text}
            self.wfile.write(json.dumps(response).encode('utf-8'))

        except Exception as e:
            response = {"error": str(e)}
            self.wfile.write(json.dumps(response).encode('utf-8'))
