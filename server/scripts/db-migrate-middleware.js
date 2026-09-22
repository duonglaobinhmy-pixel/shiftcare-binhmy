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
for (const filename of ['001_middleware_schema.sql','003_care_status_events.sql']) {
  const sql=await fs.readFile(path.resolve(__dirname,'../db/migrations',filename),'utf8');
  await getPool().query(sql);
  console.log(`Đã áp dụng ${filename}`);
}
console.log('Đã cập nhật schema PostgreSQL cho BCARE middleware layer.');
await getPool().end();
