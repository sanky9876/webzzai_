import VideoSummarizer from '@/components/VideoSummarizer';

export default function SummarizerPage() {
    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h1 style={{ fontSize: '2rem', marginBottom: '2rem', color: '#333' }}>AI Video Summarizer</h1>
            <VideoSummarizer />
        </div>
    );
}
