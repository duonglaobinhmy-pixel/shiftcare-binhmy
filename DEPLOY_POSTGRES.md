# BCARE staging: Neon PostgreSQL + Render

## 1) Neon
Create project `bcare-staging`, copy the **Pooled connection string** and save it as `DATABASE_URL`.

## 2) Local test
```bash
cd server
cp .env.example .env
# paste DATABASE_URL and JWT_SECRET into .env
npm install
npm run db:migrate
npm run dev
```
Open `http://localhost:8788/api/health` and verify `database.mode = POSTGRESQL` and `database.ok = true`.

## 3) Deploy
Push the project to GitHub. In Render create a Web Service from the repository, or use `render.yaml`.
Add secrets `DATABASE_URL` and `JWT_SECRET` in Render Environment.

Build command: `npm install && npm run build`
Start command: `npm start`
Health check: `/api/health`

## Notes
- This staging adapter stores the existing BCARE JSON state in PostgreSQL JSONB so current routes do not need to be rewritten.
- It is suitable for online UAT and avoids ephemeral local-file loss.
- Before real production, normalize the main entities into relational tables (shifts, shift_staff, care_records, toileting_logs, handovers, users, audit_logs) and hash passwords.
- Do not store wound photos as base64 in PostgreSQL for production; use object storage and store only metadata/key in DB.
