import '../src/config/env.js';
import {getPool,withTransaction} from '../src/services/db.service.js';
import {hashPassword} from '../src/utils/password.js';
import {randomUUID} from 'node:crypto';
const pool=getPool();if(!pool)throw Error('DATABASE_URL required');
try{await withTransaction(async db=>{
 const {rows}=await db.query('SELECT id,password FROM users FOR UPDATE');
 for(const u of rows){if(u.password&&!u.password.startsWith('scrypt$'))await db.query("UPDATE users SET password=$2,legacy_extra=legacy_extra-'password' WHERE id=$1",[u.id,hashPassword(u.password)]);else await db.query("UPDATE users SET legacy_extra=legacy_extra-'password' WHERE id=$1",[u.id]);}
 if(!rows.length){const password=process.env.INITIAL_ADMIN_PASSWORD;if(!password||password.length<16)throw Error('Empty DB: set INITIAL_ADMIN_PASSWORD (16+ chars) for this command only');await db.query("INSERT INTO users(id,username,password,full_name,role) VALUES($1,'admin',$2,'Quản trị hệ thống','ADMIN')",[randomUUID(),hashPassword(password)]);}
 console.log('Account migration completed. Rotate any former demo credentials.');
});}finally{await pool.end()}
