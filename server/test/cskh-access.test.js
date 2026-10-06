import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'shiftcare-cskh-'));
process.env.SHIFTCARE_DATA_DIR=temp;
process.env.SHIFTCARE_OPERATIONS_DATA_DIR=path.join(temp,'operations');
process.env.DATABASE_URL='';
const {default:usersRouter}=await import('../src/routes/users.routes.js');
const {default:operationsRouter}=await import('../src/routes/operations.routes.js');
const {default:authRouter}=await import('../src/routes/auth.routes.js');
const {saveUsers}=await import('../src/services/store.service.js');
const {signUser}=await import('../src/middleware/auth.js');
const {CARE_BRANCHES}=await import('../src/config/branches.js');
const {transactOperations}=await import('../src/services/operations-store.service.js');
const {normalizePermissions}=await import('../src/config/permissions.js');
const branchId=CARE_BRANCHES[0].id,otherBranchId=CARE_BRANCHES[1].id;
const admin={id:'test-admin',role:'ADMIN',username:'admin.test',fullName:'Admin',password:'Test@123',active:true};
await saveUsers([admin]);
const app=express();app.use(express.json());app.use('/api/users',usersRouter);app.use('/api/auth',authRouter);app.use('/api',operationsRouter);app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
async function call(url,token=signUser(admin),method='GET',body){const r=await fetch(origin+url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()}}
try{
 await test('Admin creates multiple individual CSKH accounts; login and scope enforcement work',async()=>{
  const payload={username:'cskh.test',password:'Test@123',fullName:'CSKH',role:'CSKH',branchId};
  assert.equal((await call('/api/users',undefined,'POST',{...payload,branchId:''})).status,400);
  const created=await call('/api/users',undefined,'POST',payload);assert.equal(created.status,201);assert.ok(created.body.data.permissions.includes('CSKH.CREATE'));assert.equal(created.body.data.password,undefined);
  assert.equal((await call('/api/users',undefined,'POST',{...payload,username:'cskh.second'})).status,201);
  const login=await call('/api/auth/login',undefined,'POST',{username:payload.username,password:payload.password});assert.equal(login.status,200);const token=login.body.token;
  assert.equal((await call(`/api/cskh/daily?branchId=${branchId}`,token)).status,200);
  assert.equal((await call(`/api/cskh/daily?branchId=${otherBranchId}`,token)).status,403);
  assert.equal((await call('/api/users',token)).status,403);
  assert.equal((await call('/api/operations/activities',token,'POST',{branchId})).status,403);
  assert.equal((await call('/api/operations/scopes/missing/sign',token,'POST',{branchId})).status,403);
  await transactOperations(branchId,s=>{s.residents.push({id:'test-resident',branchId,name:'NCT',zoneId:'test-zone'})});
  const contact=await call('/api/cskh/interactions',token,'POST',{branchId,residentId:'test-resident',channel:'PHONE',occurredAt:new Date().toISOString(),contactName:'Gia đình',content:'Đã trao đổi'});assert.equal(contact.status,200);
  const changed=await call(`/api/users/${created.body.data.id}`,undefined,'PATCH',{permissions:['CSKH.VIEW','CARE.CREATE','HANDOVER.SIGN']});assert.equal(changed.status,200);assert.deepEqual(changed.body.data.permissions,['CSKH.VIEW']);
  assert.equal((await call('/api/cskh/interactions',token,'POST',{branchId})).status,403);
 });
 await test('CSKH role cap removes forged clinical and account-management permissions',()=>{assert.deepEqual(normalizePermissions({role:'CSKH',permissions:['*','CSKH.VIEW','MEDICAL.ADMINISTER','SHIFT.DELETE','USER.CREATE']}),['CSKH.VIEW'])});
}finally{await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true})}
