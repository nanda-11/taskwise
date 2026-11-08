import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const email = process.env.SEED_EMAIL || 'demo@taskwise.local';
const password = process.env.SEED_PASSWORD || 'taskwise123';
const name = process.env.SEED_NAME || 'Jordan Davis';
const result = await pool.query<{ id: string }>(
  `INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3)
   ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
  [name, email, await bcrypt.hash(password, 12)]
);
const userId = result.rows[0].id;
const count = await pool.query('SELECT COUNT(*)::int AS count FROM tasks WHERE user_id=$1', [userId]);
if (count.rows[0].count === 0) {
  const rows = [
    ['Finalize homepage wireframes','Review the latest iteration with the team','In Progress','High',0,'Design',['JD','MK']],
    ['Update onboarding flow','Incorporate feedback from user interviews','To Do','Medium',1,'Product',['JD']],
    ['Fix login redirect bug','Users land on the wrong page after sign in','To Do','High',-2,'Backend',['AL','JD']],
    ['Review Q4 campaign assets','','Review','Medium',2,'Marketing',['MK']],
    ['Design review: settings page','Share final mocks with engineering','In Progress','High',0,'Design',['JD','AL']],
    ['Write API documentation','Document the new endpoint patterns','To Do','Low',4,'Backend',['AL']],
    ['Add dark mode support','','To Do','Medium',3,'Product',['JD']],
    ['QA checkout on mobile','Test Safari and Chrome on iOS','In Progress','High',-1,'Product',['MK','JD']],
    ['Customer interview synthesis','Pull recurring themes into a short readout','Review','Low',5,'Research',['JD']],
    ['Refactor notification service','','To Do','Medium',6,'Backend',['AL','MK']],
    ['Publish launch announcement','','Done','Medium',-1,'Marketing',['MK']],
    ['Collect beta feedback','Summarize top requests from the beta group','Done','Low',-3,'Research',['JD']],
  ] as const;
  for (const [title, description, status, priority, offset, label, assignees] of rows) {
    await pool.query(`INSERT INTO tasks(user_id,title,description,status,priority,due_date,label,assignees)
      VALUES($1,$2,$3,$4,$5,(CURRENT_DATE + $6)::date,$7,$8)`,
      [userId,title,description,status,priority,offset,label,[...assignees]]);
  }
}
console.log(`Seed ready. Sign in with ${email} / ${password}`);
await pool.end();
