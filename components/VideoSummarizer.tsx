'use client';

import { useState } from 'react';


export default function VideoSummarizer() {
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [summary, setSummary] = useState('');
    const [error, setError] = useState('');

    const handleSummarize = async () => {
        if (!url) return;
        setLoading(true);
        setError('');
        setSummary('');

        try {
            const res = await fetch('/api/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoUrl: url }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Something went wrong');
            }

            setSummary(data.summary);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ padding: '2rem', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', marginTop: '2rem' }}>
            <h2 style={{ fontSize: '1.8rem', marginBottom: '1.5rem', color: '#333' }}>AI Video Study Companion</h2>
            <p style={{ marginBottom: '1.5rem', color: '#666' }}>Paste a YouTube video link below to get a summary and study notes.</p>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
                <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    style={{
                        flex: 1,
                        padding: '0.8rem',
                        borderRadius: '8px',
                        border: '1px solid #ddd',
                        fontSize: '1rem'
                    }}
                />
                <button
                    onClick={handleSummarize}
                    disabled={loading}
                    style={{
                        padding: '0.8rem 1.5rem',
                        backgroundColor: loading ? '#ccc' : '#2563eb',
                        color: '#white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '1rem',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        transition: 'background-color 0.2s',
                        fontWeight: 600
                    }}
                >
                    {loading ? 'Analyzing...' : 'Summarize'}
                </button>
            </div>

            {error && (
                <div style={{ padding: '1rem', backgroundColor: '#fee2e2', color: '#dc2626', borderRadius: '8px', marginBottom: '1rem' }}>
                    {error}
                </div>
            )}

            {summary && (
                <div style={{ marginTop: '2rem', padding: '2rem', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <div className="prose" style={{ maxWidth: 'none', lineHeight: '1.6', color: '#333' }}>
                        {/* Using a simple pre-wrap for now if ReactMarkdown isn't available, but we should probably add it or use dangerous HTML carefully. 
                 Since we didn't install react-markdown, I'll switch to a simple whitespace pre-wrap display or install it. 
                 Wait, I can just use white-space: pre-wrap for simplicity without adding more deps.
             */}
                        <div style={{ whiteSpace: 'pre-wrap' }}>{summary}</div>
                    </div>
                </div>
            )}
        </div>
    );
}
