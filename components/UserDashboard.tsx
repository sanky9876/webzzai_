'use client';

import styles from '../app/dashboard/dashboard.module.css';
export default function UserDashboard({ session }: { session: { email: string; role: string } }) {
    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
            <div className={styles.header} style={{ borderBottom: '2px solid #eee', paddingBottom: '1rem', marginBottom: '2rem' }}>
                <h1 style={{ fontSize: '2.5rem', color: '#333' }}>Welcome, {session.email}!</h1>
                <p style={{ color: '#666', fontSize: '1.1rem' }}>This is your personal user area.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
                <div className={styles.statCard} style={{ background: 'linear-gradient(135deg, #e3f2fd, #bbdefb)', border: 'none' }}>
                    <h3>Account Status</h3>
                    <p style={{ marginTop: '0.5rem', color: '#1565c0', fontWeight: 600, fontSize: '1.2rem' }}>Active & Approved</p>
                </div>

                <div className={styles.statCard}>
                    <h3>Your Role</h3>
                    <p style={{ marginTop: '0.5rem', color: '#555', fontWeight: 600, textTransform: 'capitalize' }}>{session.role}</p>
                </div>
            </div>

            <div style={{ marginTop: '3rem', padding: '2rem', backgroundColor: '#f9f9f9', borderRadius: '12px' }}>
                <h2 style={{ marginBottom: '1rem' }}>Latest Activity</h2>
                <p style={{ color: '#777' }}>No recent activity to show.</p>
            </div>

        </div>
    );
}
