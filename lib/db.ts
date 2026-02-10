import { Pool } from 'pg';

const globalForDb = globalThis as unknown as {
    conn: Pool | undefined;
};

let pool: Pool;

if (process.env.DATABASE_URL) {
    if (!globalForDb.conn) {
        globalForDb.conn = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false,
            },
        });
    }
    pool = globalForDb.conn;
} else {
    // During build time or if env var is missing, usage will throw but import won't crash
    console.warn('DATABASE_URL is not defined. DB queries will fail.');
}

export const query = async (text: string, params?: (string | number | boolean | null)[]) => {
    if (!pool) {
        if (process.env.DATABASE_URL) {
            // Should have been initialized above, but just in case
            pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: { rejectUnauthorized: false },
            });
        } else {
            throw new Error('DATABASE_URL is not defined');
        }
    }
    return pool.query(text, params);
};
