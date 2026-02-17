
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '../dashboard.module.css';

interface Document {
    id: number;
    filename: string;
    file_type: string;
    upload_date: string;
}

export default function DocumentsPage() {
    const [documents, setDocuments] = useState<Document[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchDocuments();
    }, []);

    const fetchDocuments = async () => {
        try {
            const res = await fetch('/api/documents/list');
            const data = await res.json();
            if (data.documents) {
                setDocuments(data.documents);
            }
        } catch (error) {
            console.error('Failed to fetch documents:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <div className={styles.header}>
                <h1 className={styles.title}>Documents</h1>
                <p className={styles.subtitle}>Manage your uploaded files and ask questions.</p>
            </div>

            <div style={{ marginBottom: '2rem' }}>
                <Link href="/dashboard/documents/upload">
                    <button className={styles.actionBtn}>Upload New Document</button>
                </Link>
            </div>

            <div className={styles.tableContainer}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Filename</th>
                            <th>Type</th>
                            <th>Upload Date</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={4}>Loading...</td></tr>
                        ) : documents.length === 0 ? (
                            <tr><td colSpan={4}>No documents found. Upload one to get started.</td></tr>
                        ) : (
                            documents.map((doc) => (
                                <tr key={doc.id}>
                                    <td>{doc.filename}</td>
                                    <td>{doc.file_type}</td>
                                    <td>{new Date(doc.upload_date).toLocaleDateString()}</td>
                                    <td>
                                        <Link href={`/dashboard/documents/${doc.id}`}>
                                            <button className={styles.actionBtn}>Chat</button>
                                        </Link>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
