import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Groq from 'groq-sdk';
import { z } from 'zod';
import { query, pool } from './db.js';

const app = express();
const port = Number(process.env.PORT || 3001);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) console.warn('JWT_SECRET is unset. Set it in .env before exposing the server.');
const secret = jwtSecret || 'development-only-change-me';
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
type AuthRequest = Request & { userId?: string };
function auth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
  try { req.userId = (jwt.verify(token, secret) as jwt.JwtPayload).sub; next(); }
  catch { return res.status(401).json({ error: 'Your session has expired. Please sign in again.' }); }
}
const userFields = 'id,name,email';
const taskFields = `id,title,description,status,priority,to_char(due_date,'YYYY-MM-DD') AS due,to_char(due_time,'HH24:MI') AS "dueTime",label,assignees,created_at AS "createdAt",updated_at AS "updatedAt"`;
const timeSchema=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/,'Time must be in HH:MM format').nullable().optional();
const taskSchema = z.object({ title:z.string().trim().min(1).max(240), description:z.string().max(3000).default(''), status:z.enum(['To Do','In Progress','Review','Done']).default('To Do'), priority:z.enum(['High','Medium','Low']).default('Medium'), due:z.string().nullable().optional(), dueTime:timeSchema, label:z.string().trim().min(1).max(60).default('Product'), assignees:z.array(z.string().max(40)).max(10).default([]) });
const patchSchema = taskSchema.partial();
app.get('/api/health', async (_req,res) => { try { await query('SELECT 1'); res.json({ok:true,database:'connected'}); } catch { res.status(503).json({ok:false,database:'unavailable'}); } });
app.post('/api/auth/register', async (req,res) => {
  const parsed = z.object({ name:z.string().trim().min(1).max(100), email:z.string().email().max(200), password:z.string().min(8).max(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({error:parsed.error.issues[0].message});
  try { const {name,email,password}=parsed.data; const hashed=await bcrypt.hash(password,12); const r=await query(`INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING ${userFields}`,[name,email.toLowerCase(),hashed]); const user=r.rows[0]; const token=jwt.sign({sub:user.id},secret,{expiresIn:'7d'}); return res.status(201).json({token,user}); }
  catch (e: unknown) { if ((e as {code?:string}).code==='23505') return res.status(409).json({error:'An account with that email already exists.'}); console.error(e); return res.status(500).json({error:'Could not create your account.'}); }
});
app.post('/api/auth/login', async (req,res) => {
  const parsed=z.object({email:z.string().email(),password:z.string().min(1)}).safeParse(req.body); if(!parsed.success)return res.status(400).json({error:'Enter a valid email and password.'});
  const r=await query(`SELECT id,name,email,password_hash FROM users WHERE email=$1`,[parsed.data.email.toLowerCase()]); const user=r.rows[0]; if(!user||!(await bcrypt.compare(parsed.data.password,user.password_hash)))return res.status(401).json({error:'Email or password is incorrect.'}); const token=jwt.sign({sub:user.id},secret,{expiresIn:'7d'}); delete user.password_hash; return res.json({token,user});
});
app.get('/api/auth/me',auth,async(req:AuthRequest,res)=>{const r=await query(`SELECT ${userFields} FROM users WHERE id=$1`,[req.userId]);if(!r.rowCount)return res.status(401).json({error:'Account not found.'});res.json({user:r.rows[0]})});
app.get('/api/tasks',auth,async(req:AuthRequest,res)=>{const r=await query(`SELECT ${taskFields} FROM tasks WHERE user_id=$1 ORDER BY created_at DESC`,[req.userId]);res.json({tasks:r.rows})});
app.post('/api/tasks',auth,async(req:AuthRequest,res)=>{const parsed=taskSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:parsed.error.issues[0].message});const t=parsed.data;const r=await query(`INSERT INTO tasks(user_id,title,description,status,priority,due_date,due_time,label,assignees) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${taskFields}`,[req.userId,t.title,t.description,t.status,t.priority,t.due||null,t.dueTime||null,t.label,t.assignees]);res.status(201).json({task:r.rows[0]})});
app.patch('/api/tasks/:id',auth,async(req:AuthRequest,res)=>{const parsed=patchSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:parsed.error.issues[0].message});const allowed=parsed.data;const cols:Record<string,string>={title:'title',description:'description',status:'status',priority:'priority',due:'due_date',dueTime:'due_time',label:'label',assignees:'assignees'};const entries=Object.entries(allowed).filter(([k])=>cols[k]);if(!entries.length)return res.status(400).json({error:'No task changes were provided.'});const sets=entries.map(([k],i)=>`${cols[k]}=$${i+1}`).join(', ');const vals=entries.map(([,v])=>v);const r=await query(`UPDATE tasks SET ${sets},updated_at=NOW() WHERE id=$${vals.length+1} AND user_id=$${vals.length+2} RETURNING ${taskFields}`,[...vals,req.params.id,req.userId]);if(!r.rowCount)return res.status(404).json({error:'Task not found.'});res.json({task:r.rows[0]})});
app.delete('/api/tasks/:id',auth,async(req:AuthRequest,res)=>{const r=await query('DELETE FROM tasks WHERE id=$1 AND user_id=$2 RETURNING id',[req.params.id,req.userId]);if(!r.rowCount)return res.status(404).json({error:'Task not found.'});res.status(204).end()});

const commandSchema=z.object({action:z.enum(['create','update','filter','clarify']),title:z.string().trim().min(1).max(240).optional(),description:z.string().max(3000).optional(),label:z.string().trim().min(1).max(60).optional(),filters:z.object({text:z.string().optional(),priority:z.enum(['High','Medium','Low']).optional(),status:z.enum(['To Do','In Progress','Review','Done']).optional(),overdue:z.boolean().optional(),openOnly:z.boolean().optional()}).default({}),updates:z.object({status:z.enum(['To Do','In Progress','Review','Done']).optional(),priority:z.enum(['High','Medium','Low']).optional(),dueOffsetDays:z.number().int().min(-365).max(365).optional(),dueTime:timeSchema}).default({}),response:z.string().max(400).default('')});
function inferTaskDraft(input:string){
  const text=input.trim();
  const updateIntent=/\b(move|reschedule|mark|complete|finish|change|update|set|assign|push)\b/i.test(text);
  const filterIntent=/\b(show|find|list|filter|search|overdue|what)\b/i.test(text);
  const explicitCreate=/^(?:please\s+)?(?:create|add|make|schedule|remind me to)\b/i.test(text);
  if(!explicitCreate&&(updateIntent||filterIntent))return null;
  let title=text.replace(/^(?:please\s+)?(?:(?:create|add|make|schedule)\s+)?(?:(?:a|an|new)\s+)?(?:task|todo|to-do|reminder)\s*(?:(?:called|named|to)\s*)?(?:[:\-]\s*)?/i,'');
  title=title.replace(/^(?:please\s+)?(?:create|add|make|schedule)\s+/i,'');
  let dueOffsetDays:number|undefined;
  const dateMatchers:[RegExp,number][]=[[/\bday after tomorrow\b/i,2],[/\btomorrow\b/i,1],[/\btoday\b/i,0],[/\bnext week\b/i,7]];
  for(const [pattern,offset] of dateMatchers){if(pattern.test(title)){dueOffsetDays=offset;title=title.replace(pattern,' ');break}}
  let dueTime:string|null=null;
  if(/\bnoon\b/i.test(title)){dueTime='12:00';title=title.replace(/\bnoon\b/i,' ')}
  else if(/\bmidnight\b/i.test(title)){dueTime='00:00';title=title.replace(/\bmidnight\b/i,' ')}
  else {
    const meridiem=title.match(/\b(?:at\s*)?(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
    const military=title.match(/\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/);
    const match=meridiem||military;
    if(match){let h=Number(match[1]);const minutes=match[2]||'00';if(meridiem){const pm=/p/i.test(match[3]);h=h%12+(pm?12:0)}dueTime=`${String(h).padStart(2,'0')}:${minutes}`;title=title.replace(match[0],' ')}
  }
  title=title.replace(/\b(?:on|for|at|by|due)\s*$/i,'').replace(/[,:;\-]+\s*$/,'').replace(/\s+/g,' ').trim();
  if(!title)return {title:'',dueOffsetDays,dueTime};
  return {title:title[0].toUpperCase()+title.slice(1),dueOffsetDays,dueTime};
}
app.post('/api/commands',auth,async(req:AuthRequest,res)=>{
  const prompt=z.string().trim().min(2).max(500).safeParse(req.body?.command);if(!prompt.success)return res.status(400).json({error:'Enter a task command.'});
  try{
    const inferred=inferTaskDraft(prompt.data);
    if(inferred){if(!inferred.title)return res.json({message:'What task would you like me to create? Please include the task name.'});const created=await query(`INSERT INTO tasks(user_id,title,description,status,priority,due_date,due_time,label,assignees)
      VALUES($1,$2,'','To Do','Medium',CASE WHEN $3::int IS NULL THEN NULL ELSE CURRENT_DATE + $3::int END,$4,'Product',$5)
      RETURNING ${taskFields}`,[req.userId,inferred.title,inferred.dueOffsetDays??null,inferred.dueTime,['JD']]);return res.status(201).json({message:`Created “${created.rows[0].title}”.`,created:created.rows[0],matched:[],changed:[]})}
    if(!process.env.GROQ_API_KEY)return res.status(503).json({error:'AI commands need a GROQ_API_KEY. Add it to .env; manual task controls are ready.'});
    const groq=new Groq({apiKey:process.env.GROQ_API_KEY});const completion=await groq.chat.completions.create({model:process.env.GROQ_MODEL||'llama-3.3-70b-versatile',temperature:0.1,max_tokens:450,response_format:{type:'json_object'},messages:[{role:'system',content:`Turn a user's task-management request into JSON only. Schema: {"action":"create"|"update"|"filter"|"clarify","title":"task title for create","description":"optional description","label":"Product|Design|Backend|Marketing|Research","filters":{"text":"optional search text","priority":"High|Medium|Low","status":"To Do|In Progress|Review|Done","overdue":true,"openOnly":true},"updates":{"status":"To Do|In Progress|Review|Done","priority":"High|Medium|Low","dueOffsetDays":integer,"dueTime":"HH:MM in 24-hour time"},"response":"short confirmation or clarification"}. For explicit requests to create/add a new task, use create and extract its title and any supplied details. If the user asks to create or schedule something but gives no task title/content, use clarify and ask what task to create. Never invent a task title. Interpret noon/12pm as 12:00, midnight as 00:00, and convert other times to 24-hour HH:MM. Today=0 days, tomorrow=1, next week=7. For show/find/list/filter requests, use filter. For updates to an existing task, use update and set filters.text to the meaningful task subject (excluding generic words like task/bug/high-priority/tomorrow); set openOnly if the user implies an open task. Do not say the system can only update existing tasks: task creation is supported. If unclear or unsupported, use clarify.`},{role:'user',content:prompt.data}]});
    const raw=completion.choices[0]?.message?.content||'{}';const parsed=commandSchema.safeParse(JSON.parse(raw));if(!parsed.success)return res.status(502).json({error:'The AI returned an unsupported command. Try rephrasing it.'});const cmd=parsed.data;
    if(cmd.action==='clarify')return res.json({message:cmd.response||'Please rephrase with a task name and the change you want.'});
    if(cmd.action==='create'){
      if(!cmd.title)return res.json({message:'What task would you like me to create? Include its name, and optionally a due date or time.'});
      const dueOffset=cmd.updates.dueOffsetDays;const dueTime=cmd.updates.dueTime||null;
      const created=await query(`INSERT INTO tasks(user_id,title,description,status,priority,due_date,due_time,label,assignees)
        VALUES($1,$2,$3,$4,$5,CASE WHEN $6::int IS NULL THEN NULL ELSE CURRENT_DATE + $6::int END,$7,$8,$9)
        RETURNING ${taskFields}`,[req.userId,cmd.title,cmd.description||'',cmd.updates.status||'To Do',cmd.updates.priority||'Medium',dueOffset??null,dueTime,cmd.label||'Product',['JD']]);
      return res.status(201).json({message:cmd.response||`Created “${created.rows[0].title}”.`,created:created.rows[0],matched:[],changed:[]});
    }
    const conditions=['user_id=$1'];const vals:unknown[]=[req.userId];const f=cmd.filters;
    if(f.text){vals.push(`%${f.text}%`);conditions.push(`(title ILIKE $${vals.length} OR description ILIKE $${vals.length} OR label ILIKE $${vals.length})`)}
    if(f.priority){vals.push(f.priority);conditions.push(`priority=$${vals.length}`)}if(f.status){vals.push(f.status);conditions.push(`status=$${vals.length}`)}if(f.openOnly)conditions.push("status <> 'Done'");if(f.overdue)conditions.push("due_date < CURRENT_DATE AND status <> 'Done'");
    const where=conditions.join(' AND ');const found=await query(`SELECT ${taskFields} FROM tasks WHERE ${where} ORDER BY created_at DESC`,vals);
    if(cmd.action==='filter')return res.json({message:cmd.response||`Found ${found.rowCount} matching tasks.`,matched:found.rows,changed:[]});
    if(!found.rowCount)return res.json({message:'I could not find any tasks matching that request.',matched:[],changed:[]});
    const u=cmd.updates;if(!u.status&&!u.priority&&u.dueOffsetDays===undefined&&u.dueTime===undefined)return res.json({message:'Tell me what to change, for example “Move high-priority bugs to tomorrow”.',matched:found.rows,changed:[]});
    const changed=[];for(const task of found.rows){const updates:Record<string,unknown>={};if(u.status)updates.status=u.status;if(u.priority)updates.priority=u.priority;if(u.dueOffsetDays!==undefined)updates.due=`${u.dueOffsetDays>=0?'+':''}${u.dueOffsetDays} days`;if(u.dueTime!==undefined)updates.dueTime=u.dueTime;const keys=Object.keys(updates);const set=keys.map((k,i)=>`${k==='due'?'due_date':k==='dueTime'?'due_time':k}=$${i+1}${k==='due'?'::interval + CURRENT_DATE':''}`).join(', ');const values=keys.map(k=>updates[k]);const updated=await query(`UPDATE tasks SET ${set},updated_at=NOW() WHERE id=$${values.length+1} AND user_id=$${values.length+2} RETURNING ${taskFields}`,[...values,task.id,req.userId]);changed.push(updated.rows[0]);}
    res.json({message:cmd.response||`Updated ${changed.length} ${changed.length===1?'task':'tasks'}.`,matched:found.rows,changed});
  }catch(e){console.error('AI command failed:',e);res.status(502).json({error:'Could not process that AI command. Please try again.'})}
});

app.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{console.error(err);res.status(500).json({error:'An unexpected server error occurred.'})});
app.listen(port,()=>console.log(`Taskwise API listening on http://localhost:${port}`));
process.on('SIGINT',async()=>{await pool.end();process.exit(0)});
