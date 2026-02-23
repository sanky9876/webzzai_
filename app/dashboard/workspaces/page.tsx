
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '../dashboard.module.css';

interface Workspace {
    id: number;
    name: string;
    description: string;
    created_at: string;
}

export default function WorkspacesPage() {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');

    useEffect(() => {
        fetchWorkspaces();
    }, []);

    const fetchWorkspaces = async () => {
        try {
            const res = await fetch('/api/workspaces/list');
            const data = await res.json();
            if (data.workspaces) {
                setWorkspaces(data.workspaces);
            }
        } catch (error) {
            console.error('Failed to fetch workspaces:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await fetch('/api/workspaces/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName, description: newDesc }),
            });
            const data = await res.json();
            if (data.success) {
                setShowModal(false);
                setNewName('');
                setNewDesc('');
                fetchWorkspaces();
            }
        } catch (error) {
            console.error('Failed to create workspace:', error);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>AI Workspaces</h1>
                <p className={styles.subtitle}>Create isolated environments for different projects and document sets.</p>
            </div>

            <div style={{ marginBottom: '2rem' }}>
                <button onClick={() => setShowModal(true)} className={styles.actionBtn}>
                    + Create New Workspace
                </button>
            </div>

            {loading ? (
                <p>Loading workspaces...</p>
            ) : workspaces.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                    <p>No workspaces found. Create one to start uploading multiple documents!</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                    {workspaces.map((ws) => (
                        <div key={ws.id} className={styles.statCard} style={{ cursor: 'pointer' }}>
                            <Link href={`/dashboard/workspaces/${ws.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                                <h3 style={{ margin: '0 0 0.5rem 0', color: '#60a5fa' }}>{ws.name}</h3>
                                <p style={{ fontSize: '0.9rem', opacity: 0.8, minHeight: '3rem' }}>{ws.description || 'No description provided.'}</p>
                                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '0.8rem', opacity: 0.6 }}>
                                    Created: {new Date(ws.created_at).toLocaleDateString()}
                                </div>
                            </Link>
                        </div>
                    ))}
                </div>
            )}

            {showModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div className={styles.statCard} style={{ width: '100%', maxWidth: '500px', padding: '2rem' }}>
                        <h2 style={{ marginTop: 0 }}>New Workspace</h2>
                        <form onSubmit={handleCreate}>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Name</label>
                                <input
                                    type="text"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    placeholder="Project Name"
                                    required
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #333', background: '#111', color: 'white' }}
                                />
                            </div>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Description (Optional)</label>
                                <textarea
                                    value={newDesc}
                                    onChange={(e) => setNewDesc(e.target.value)}
                                    placeholder="Describe the scope of this workspace..."
                                    rows={4}
                                    style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #333', background: '#111', color: 'white' }}
                                />
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button type="button" onClick={() => setShowModal(false)} className={styles.actionBtn} style={{ background: '#333' }}>
                                    Cancel
                                </button>
                                <button type="submit" className={styles.actionBtn}>
                                    Create
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
