import '../src/config/env.js';
import { readJson } from '../src/utils/files.js';
import { updateStore, saveUsers, getUsers } from '../src/services/store.service.js';
import { getPool } from '../src/services/db.service.js';

if (!process.env.DATABASE_URL) { console.error('Thiếu DATABASE_URL trong server/.env'); process.exit(1); }
const store=await readJson('store.json',{}); const users=await readJson('users.json',[]);
if(!Array.isArray(users)||!Array.isArray(store.shifts))throw new Error('JSON đầu vào thiếu users hoặc shifts; chưa import.');
await saveUsers([...new Map([...(await getUsers()),...users].map(row=>[String(row.id),row])).values()]);
await updateStore(target=>{for(const key of Object.keys(target)) target[key]=Array.isArray(store[key])?[...new Map([...target[key],...store[key]].map(row=>[String(row.id),row])).values()]:target[key];});
console.log(`Đã import JSON -> middleware relational. users=${users.length||0}, shifts=${store.shifts?.length||0}`);
await getPool().end();
