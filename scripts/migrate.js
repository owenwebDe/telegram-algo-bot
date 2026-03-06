/**
 * scripts/migrate.js
 *
 * Applies the SQL migration files in order.
 * Run with: node scripts/migrate.js
 *
 * Requires .env to be present with DATABASE_URL.
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '../src/database/migrations');

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Create migrations tracking table if it doesn't exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      filename   TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query(
      'SELECT 1 FROM _migrations WHERE filename = $1',
      [file],
    );
    if (rows.length > 0) {
      console.log(`[SKIP] ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`[RUN ] ${file}`);
    await pool.query(sql);
    await pool.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
    console.log(`[DONE] ${file}`);
  }

  await pool.end();
  console.log('All migrations complete.');
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
