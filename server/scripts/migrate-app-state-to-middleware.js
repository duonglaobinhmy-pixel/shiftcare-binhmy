import 'dotenv/config';
import { getPool } from '../src/services/db.service.js';
import { updateStore, saveUsers } from '../src/services/store.service.js';

if (!process.env.DATABASE_URL) {
  console.error('Thiếu DATABASE_URL trong server/.env');
  process.exit(1);
}
const db=getPool();
const table=await db.query(`SELECT to_regclass('public.app_state') AS t`);
if(!table.rows[0]?.t){console.log('Không có app_state; bỏ qua migration dữ liệu staging.');await db.end();process.exit(0)}
const rows=await db.query(`SELECT state_key,state_value FROM app_state WHERE state_key IN ('store','users')`);
const map=new Map(rows.rows.map(x=>[x.state_key,x.state_value]));
const store=map.get('store'); const users=map.get('users');
if(Array.isArray(users)) await saveUsers(users);
if(store){await updateStore(target=>{for(const key of Object.keys(target)) target[key]=Array.isArray(store[key])?store[key]:target[key];});}
console.log(`Đã migrate app_state -> middleware relational. users=${Array.isArray(users)?users.length:0}, shifts=${store?.shifts?.length||0}, changes=${store?.changeLogs?.length||0}`);
await db.end();
