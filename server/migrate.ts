import 'dotenv/config';
import { pool } from './db.js';

await pool.query(`
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'To Do' CHECK (status IN ('To Do','In Progress','Review','Done')),
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('High','Medium','Low')),
  due_date DATE,
  due_time TIME,
  label TEXT NOT NULL DEFAULT 'Product',
  assignees TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks(user_id);
CREATE INDEX IF NOT EXISTS tasks_user_status_idx ON tasks(user_id,status);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_time TIME;
`);
console.log('Database migration complete.');
await pool.end();
