import youtube_transcript_api
from youtube_transcript_api import YouTubeTranscriptApi

print("Package location:", youtube_transcript_api.__file__)
print("Attributes of YouTubeTranscriptApi:", dir(YouTubeTranscriptApi))
try:
    print("Type of YouTubeTranscriptApi:", type(YouTubeTranscriptApi))
except:
    pass
