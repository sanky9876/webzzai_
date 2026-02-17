
'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import styles from '../../dashboard.module.css';

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

export default function DocumentChatPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);

    // Auto-scroll to bottom of chat
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    useEffect(scrollToBottom, [messages]);

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;

        const userMessage = { role: 'user' as const, content: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setLoading(true);

        try {
            const res = await fetch(`/api/documents/${id}/answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: userMessage.content }),
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP Error ${res.status}`);
            }

            const data = await res.json();
            const botMessage = { role: 'assistant' as const, content: data.answer };
            setMessages(prev => [...prev, botMessage]);
        } catch (error: any) {
            console.error(error);
            const errorMessage = error.message || 'Sorry, I encountered an error answering that.';
            setMessages(prev => [...prev, { role: 'assistant', content: `Server Error: ${errorMessage}` }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
            <div className={styles.header}>
                <h1 className={styles.title}>Document Chat</h1>
                <p className={styles.subtitle}>Ask questions about this document. (v1.1 Debug)</p>
            </div>

            <div style={{
                flex: 1,
                overflowY: 'auto',
                background: 'white',
                padding: '1.5rem',
                borderRadius: '12px',
                marginBottom: '1rem',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem'
            }}>
                {messages.length === 0 && (
                    <p style={{ color: '#888', textAlign: 'center', marginTop: '2rem' }}>
                        Ask a question to start the conversation!
                    </p>
                )}

                {messages.map((msg, index) => (
                    <div key={index} style={{
                        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '80%',
                        padding: '1rem',
                        borderRadius: '12px',
                        backgroundColor: msg.role === 'user' ? '#1976d2' : '#f5f5f5',
                        color: msg.role === 'user' ? 'white' : '#333',
                        borderBottomRightRadius: msg.role === 'user' ? '2px' : '12px',
                        borderBottomLeftRadius: msg.role === 'assistant' ? '2px' : '12px',
                        lineHeight: '1.5'
                    }}>
                        {msg.content}
                    </div>
                ))}
                {loading && (
                    <div style={{ alignSelf: 'flex-start', padding: '1rem', background: '#f5f5f5', borderRadius: '12px' }}>
                        Typing...
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSend} style={{ display: 'flex', gap: '1rem' }}>
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask a question..."
                    disabled={loading}
                    style={{
                        flex: 1,
                        padding: '1rem',
                        borderRadius: '8px',
                        border: '1px solid #ddd',
                        fontSize: '1rem'
                    }}
                />
                <button
                    type="submit"
                    className={styles.actionBtn}
                    disabled={loading || !input.trim()}
                    style={{ padding: '0 2rem' }}
                >
                    Send
                </button>
            </form>
        </div>
    );
}
