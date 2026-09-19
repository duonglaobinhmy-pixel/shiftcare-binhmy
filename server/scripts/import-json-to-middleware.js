import 'dotenv/config';
import { readJson } from '../src/utils/files.js';
import { updateStore, saveUsers } from '../src/services/store.service.js';
import { getPool } from '../src/services/db.service.js';

if (!process.env.DATABASE_URL) { console.error('Thiếu DATABASE_URL trong server/.env'); process.exit(1); }
const store=await readJson('store.json',{}); const users=await readJson('users.json',[]);
await saveUsers(Array.isArray(users)?users:[]);
await updateStore(target=>{for(const key of Object.keys(target)) target[key]=Array.isArray(store[key])?store[key]:target[key];});
console.log(`Đã import JSON -> middleware relational. users=${users.length||0}, shifts=${store.shifts?.length||0}`);
await getPool().end();
