
const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL is not defined in .env.local');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Starting migration for workspaces feature...');

        await client.query('BEGIN');

        // 1. Create workspaces table
        await client.query(`
            CREATE TABLE IF NOT EXISTS workspaces (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Created workspaces table.');

        // 2. Add workspace_id to documents table
        // First check if it exists to avoid errors on re-run
        const checkColumn = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='documents' AND column_name='workspace_id';
        `);

        if (checkColumn.rowCount === 0) {
            await client.query(`
                ALTER TABLE documents 
                ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL;
            `);
            console.log('Added workspace_id to documents table.');
        } else {
            console.log('workspace_id column already exists in documents table.');
        }

        await client.query('COMMIT');
        console.log('Migration completed successfully.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
