
'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import styles from '../../dashboard.module.css';

interface Document {
    id: number;
    filename: string;
    file_type: string;
    upload_date: string;
}

interface Message {
    role: 'user' | 'assistant';
    content: string;
    sources?: string[];
}

export default function WorkspaceDetail() {
    const params = useParams();
    const workspaceId = params.id;

    const [documents, setDocuments] = useState<Document[]>([]);
    const [loadingDocs, setLoadingDocs] = useState(true);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [isDeepSearch, setIsDeepSearch] = useState(false);
    const [uploading, setUploading] = useState(false);

    const chatEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetchDocuments();
    }, [workspaceId]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const fetchDocuments = async () => {
        try {
            const res = await fetch(`/api/workspaces/${workspaceId}/documents`);
            const data = await res.json();
            if (data.documents) {
                setDocuments(data.documents);
            }
        } catch (error) {
            console.error('Failed to fetch docs:', error);
        } finally {
            setLoadingDocs(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0]) return;
        setUploading(true);
        const file = e.target.files[0];
        const formData = new FormData();
        formData.append('file', file);
        formData.append('workspaceId', workspaceId as string);

        try {
            const res = await fetch('/api/documents/upload', {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || `Server Error (${res.status})`);
            }

            const data = await res.json();
            if (data.success) {
                fetchDocuments();
            }
        } catch (error: any) {
            console.error('Upload failed:', error);
            alert(`Upload failed: ${error.message}`);
        } finally {
            setUploading(false);
        }
    };

    const handleSend = async () => {
        if (!input.trim() || isThinking) return;

        const userMsg: Message = { role: 'user', content: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsThinking(true);

        const endpoint = isDeepSearch ? '/api/chat/deep-search' : '/api/chat/workspace';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceId, question: userMsg.content }),
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || `Server Error (${res.status})`);
            }

            const data = await res.json();

            setMessages(prev => [...prev, {
                role: 'assistant',
                content: data.answer,
                sources: data.sources
            }]);
        } catch (error: any) {
            console.error('Chat failed:', error);
            setMessages(prev => [...prev, { role: 'assistant', content: `Sorry, I encountered an error: ${error.message}` }]);
        } finally {
            setIsThinking(false);
        }
    };

    return (
        <div className={styles.container} style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
            <div className={styles.header} style={{ flexShrink: 0 }}>
                <h1 className={styles.title}>Workspace Chat</h1>
                <p className={styles.subtitle}>Analyzing {documents.length} documents in this environment.</p>
            </div>

            <div style={{ display: 'flex', flex: 1, gap: '2rem', minHeight: 0 }}>
                {/* Left Sidebar: Documents */}
                <div style={{ width: '280px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div className={styles.statCard} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                        <h3 style={{ margin: '0 0 1rem 0' }}>Attached Files</h3>
                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {loadingDocs ? <p>Loading...</p> : documents.length === 0 ? <p style={{ opacity: 0.5 }}>No files yet.</p> : (
                                documents.map(doc => (
                                    <div key={doc.id} style={{
                                        padding: '0.5rem',
                                        marginBottom: '0.5rem',
                                        background: 'rgba(255,255,255,0.05)',
                                        borderRadius: '6px',
                                        fontSize: '0.85rem',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '5px' }}>
                                            {doc.filename}
                                        </span>
                                        <span style={{ fontSize: '0.7rem', opacity: 0.4 }}>{doc.file_type.split('/')[1]?.toUpperCase()}</span>
                                    </div>
                                ))
                            )}
                        </div>
                        <div style={{ marginTop: '1rem' }}>
                            <label className={styles.actionBtn} style={{ cursor: 'pointer', display: 'block', textAlign: 'center' }}>
                                {uploading ? 'Uploading...' : '+ Add Document'}
                                <input type="file" onChange={handleFileUpload} style={{ display: 'none' }} disabled={uploading} />
                            </label>
                        </div>
                    </div>
                </div>

                {/* Main: Chat Interface */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    {/* Chat Settings Bar */}
                    <div style={{ padding: '0.75rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                                <input
                                    type="checkbox"
                                    checked={isDeepSearch}
                                    onChange={(e) => setIsDeepSearch(e.target.checked)}
                                    style={{ width: '16px', height: '16px' }}
                                />
                                <span style={{ color: isDeepSearch ? '#60a5fa' : 'inherit', fontWeight: isDeepSearch ? 'bold' : 'normal' }}>
                                    Deep Search (Web Knowledge)
                                </span>
                            </label>
                        </div>
                        <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>Using Workspace Context</span>
                    </div>

                    {/* Messages Area */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {messages.length === 0 && (
                            <div style={{ textAlign: 'center', marginTop: '20%', opacity: 0.4 }}>
                                <p>Ask any question related to the uploaded documents.</p>
                                <p style={{ fontSize: '0.8rem' }}>Enable "Deep Search" to include fresh web data.</p>
                            </div>
                        )}
                        {messages.map((m, i) => (
                            <div key={i} style={{
                                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                                maxWidth: '85%',
                                padding: '1rem',
                                borderRadius: '12px',
                                background: m.role === 'user' ? '#1e40af' : 'rgba(255,255,255,0.05)',
                                color: 'white'
                            }}>
                                <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                                {m.sources && m.sources.length > 0 && (
                                    <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '0.75rem', opacity: 0.6 }}>
                                        <strong>Sources:</strong> {m.sources.join(', ')}
                                    </div>
                                )}
                            </div>
                        ))}
                        {isThinking && (
                            <div style={{ alignSelf: 'flex-start', padding: '1rem', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', opacity: 0.5 }}>
                                Thinking...
                            </div>
                        )}
                        <div ref={chatEndRef} />
                    </div>

                    {/* Input Area */}
                    <div style={{ padding: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '1rem' }}>
                        <input
                            type="text"
                            placeholder="Type your message..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            style={{ flex: 1, padding: '1rem', borderRadius: '8px', border: '1px solid #333', background: '#111', color: 'white' }}
                        />
                        <button
                            onClick={handleSend}
                            className={styles.actionBtn}
                            disabled={isThinking || !input.trim()}
                        >
                            Send
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
