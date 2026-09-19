import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from '../src/services/db.service.js';

if (!process.env.DATABASE_URL) {
  console.error('Thiếu DATABASE_URL trong server/.env');
  process.exit(1);
}
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const sql=await fs.readFile(path.resolve(__dirname,'../db/migrations/001_middleware_schema.sql'),'utf8');
await getPool().query(sql);
console.log('Đã tạo schema PostgreSQL cho BCARE middleware layer.');
await getPool().end();
