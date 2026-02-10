'use client';

import { useEffect, useState } from 'react';
import styles from '../app/dashboard/dashboard.module.css';


interface User {
    id: number;
    email: string;
    role: string;
    approved: boolean;
    created_at: string;
}

import VideoSummarizer from './VideoSummarizer';

export default function AdminDashboard() {
    // ... existing state and logic ...
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const res = await fetch('/api/admin/users');
            if (res.ok) {
                const data = await res.json();
                setUsers(data);
            }
        } catch (error) {
            console.error('Failed to fetch users', error);
        } finally {
            setLoading(false);
        }
    };

    const approveUser = async (userId: number) => {
        try {
            const res = await fetch('/api/admin/approve', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
            });
            if (res.ok) {
                fetchUsers(); // Refresh list
            }
        } catch (error) {
            console.error('Failed to approve user', error);
        }
    };

    const updateRole = async (userId: number, newRole: string) => {
        try {
            const res = await fetch('/api/admin/role', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, role: newRole }),
            });
            if (res.ok) {
                fetchUsers(); // Refresh list
            }
        } catch (error) {
            console.error('Failed to update role', error);
        }
    };

    if (loading) return <div>Loading...</div>;

    const pendingCount = users.filter(u => !u.approved).length;
    const totalCount = users.length;

    return (
        <div>
            <div className={styles.header}>
                <h1 className={styles.title}>Admin Dashboard</h1>
                <p className={styles.subtitle}>Manage users and approvals</p>
            </div>

            <div className={styles.statsGrid}>
                <div className={styles.statCard}>
                    <div className={styles.statLabel}>Total Users</div>
                    <div className={styles.statValue}>{totalCount}</div>
                </div>
                <div className={styles.statCard}>
                    <div className={styles.statLabel}>Pending Approvals</div>
                    <div className={styles.statValue}>{pendingCount}</div>
                </div>
            </div>
            <div className={styles.tableContainer}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Email</th>
                            <th>Role</th>
                            <th>Status</th>
                            <th>Created At</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((user) => (
                            <tr key={user.id}>
                                <td>{user.email}</td>
                                <td>{user.role}</td>
                                <td>
                                    <span className={`${styles.badge} ${user.approved ? styles.approved : styles.pending}`}>
                                        {user.approved ? 'Approved' : 'Pending'}
                                    </span>
                                </td>
                                <td>{new Date(user.created_at).toLocaleDateString()}</td>
                                <td>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        {!user.approved && (
                                            <button
                                                onClick={() => approveUser(user.id)}
                                                className={styles.actionBtn}
                                            >
                                                Approve
                                            </button>
                                        )}
                                        {user.approved && (
                                            user.role === 'user' ? (
                                                <button
                                                    onClick={() => updateRole(user.id, 'admin')}
                                                    className={styles.actionBtn}
                                                    style={{ backgroundColor: '#1976d2' }}
                                                >
                                                    Make Admin
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => updateRole(user.id, 'user')}
                                                    className={styles.actionBtn}
                                                    style={{ backgroundColor: '#d32f2f' }}
                                                >
                                                    Remove Admin
                                                </button>
                                            )
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

        </div >
    );
}
