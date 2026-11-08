# Taskwise

A full-stack task manager built with React, Express, PostgreSQL, and Groq. User accounts keep tasks private. The task board, task editor, status drag-and-drop, search, priority filter, and AI command bar all use the same API and database records.

## Set up Supabase, step by step

1. Sign in at [supabase.com/dashboard](https://supabase.com/dashboard) and click **New project**. Choose an organization, enter a project name, create a strong database password, and select a region near you. Save the database password somewhere private; Supabase will not show it again.
2. Wait for the project to finish provisioning, then open the project dashboard.
3. Click **Connect** near the top of the project dashboard, then choose **Direct** (or **Direct connection**) and copy the PostgreSQL URI. This app's Express API uses the `pg` driver and connects directly; it does not need the Supabase JavaScript SDK or its API keys.
5. In the copied URI, replace `[YOUR-PASSWORD]` with the database password from step 1. If the password contains reserved URL characters such as `@`, `#`, `/`, `?`, or a space, URL-encode those characters before inserting it. Keep the whole connection string private.
6. In the project folder, create a file named `.env` by copying `.env.example`. On PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

7. Open `.env` and set `DATABASE_URL` to the complete URI from step 5. Also replace `JWT_SECRET` with a long random value. You can generate one with:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   `GROQ_API_KEY` is optional for now; add a Groq key there later to enable AI commands. Do not put database passwords or API keys in the React source or commit `.env`.
8. Install packages if needed: `pnpm install`.
9. Create the app tables in your Supabase database: `pnpm db:migrate`.
10. Optional: add a demo account and sample tasks with `pnpm db:seed`. Defaults are `demo@taskwise.local` / `taskwise123`; override them with `SEED_EMAIL`, `SEED_PASSWORD`, and `SEED_NAME`.
11. Start the frontend and API: `pnpm dev`, then open http://localhost:5173. The API health check is http://localhost:3001/api/health.

Supabase's current instructions and connection options are in [Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres). Direct connections use port `5432` and may require IPv6. If the migration reports a network/IPv6 connection error, use a Supabase pooler URI instead; the hostname, username, and port are specific to your project, so copy them from the dashboard rather than composing them yourself.

The first account can be created from the sign-in page. To run the production frontend, use `pnpm build`; serve the generated `dist` directory from a static host and run the Express API separately. Set `CLIENT_ORIGIN` to the deployed frontend origin.

## AI command behavior

The server sends the requested command to Groq for structured intent, validates that intent, scopes all database reads and updates to the signed-in user, and applies supported updates to the same task rows the visual controls edit. Commands can create tasks, update a task's status, priority, or due date/time, or filter the board by text, status, priority, or overdue state. For example: `Create a task: Call the dentist tomorrow at 12pm`. If the task title is missing, the assistant asks what to create. If `GROQ_API_KEY` is unset, the API returns a setup message and ordinary task controls continue to work.

## Environment

See `.env.example` for the full list. Never put Groq keys or `JWT_SECRET` in client-side code. Passwords are stored as bcrypt hashes; signed sessions expire after seven days.
