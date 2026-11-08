import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => console.error('Unexpected PostgreSQL pool error', err));

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}
