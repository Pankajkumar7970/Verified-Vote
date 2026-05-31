import dotenv from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;

dotenv.config();

// Create a minimal pool just for keep-alive
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
});

async function keepDatabaseAwake() {
  try {
    // Run a super lightweight query
    const result = await pool.query('SELECT 1');
    console.log(`[Keep-Alive] Ping successful at ${new Date().toISOString()}`);
  } catch (error) {
    console.error('[Keep-Alive] Ping failed:', error);
  }
}

// Ping every 4 minutes (less than the 5-minute timeout)
const cron = await import('node-cron');
cron.schedule('*/4 * * * *', keepDatabaseAwake);

console.log('[Keep-Alive] Database keep-alive service started');

// Handle process shutdown
process.on('SIGINT', async () => {
  console.log('[Keep-Alive] Shutting down');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Keep-Alive] Shutting down');
  await pool.end();
  process.exit(0);
});
