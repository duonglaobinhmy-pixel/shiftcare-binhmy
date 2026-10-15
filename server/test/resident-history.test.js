import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'shiftcare-carry-'));
process.env.SHIFTCARE_DATA_DIR=temp;process.env.DATABASE_URL='';
const {default:core}=await import('../src/routes/core.routes.js');
const {default:users}=await import('../src/routes/users.routes.js');
const {getStore,updateStore,saveUsers}=await import('../src/services/store.service.js');
const {signUser}=await import('../src/middleware/auth.js');
const admin={id:'admin',role:'ADMIN',fullName:'Admin',active:true};
const care={id:'care',role:'CARE_SHARED',branchId:'426c773d-44da-4455-ea30-08dd70451305',fullName:'Care',active:true};
const other={...care,id:'other',branchId:'other'};
const cskh={id:'cskh',role:'CSKH',branchId:'426c773d-44da-4455-ea30-08dd70451305',active:true};
const director={id:'director',role:'BRANCH_DIRECTOR',branchId:'426c773d-44da-4455-ea30-08dd70451305',active:true};
await saveUsers([admin,care,other,cskh,director]);
const person={id:'p',fullName:'NV',employeeCode:'NV01'};
const makeShift=(id,date,type,status='OPEN',branchId='426c773d-44da-4455-ea30-08dd70451305')=>({id,shiftDate:date,shiftType:type,status,branchId,assignedStaff:[person]});
const shifts=[makeShift('source','2026-10-06','NIGHT','HANDOVER_CONFIRMED'),makeShift('morning','2026-10-07','MORNING'),makeShift('night','2026-10-07','NIGHT'),makeShift('future','2026-10-08','MORNING'),makeShift('foreign','2026-10-06','NIGHT','OPEN','other')];
const record=(id,shiftId,extra={})=>({id,shiftId,residentId:'r',residentName:'NCT',branchId:'426c773d-44da-4455-ea30-08dd70451305',category:'HEALTH',priority:'HIGH',occurredAt:'2026-10-06T16:00:00Z',createdAt:'2026-10-06T16:00:00Z',content:'Đo lại và theo dõi',attentionLevel:'RED',attentionStatus:'OPEN',...extra});
await updateStore(s=>{s.shifts=shifts;s.shiftResidents=shifts.map(sh=>({id:`r-${sh.id}`,residentId:'r',fullName:'NCT',branchId:sh.branchId,shiftId:sh.id}));s.changeLogs=[record('red','source'),record('yellow','source',{priority:'MEDIUM',attentionLevel:'YELLOW'}),record('follow','source',{priority:'LOW',attentionLevel:null,attentionStatus:null,requiresHandover:true,followUp:'Theo dõi ăn uống'}),record('done','source',{attentionStatus:'RESOLVED'}),record('deleted','source',{deleted:true}),record('not-roster','source',{residentId:'absent'}),record('foreign-record','foreign',{branchId:'other'}),record('future-record','future')];s.toiletingLogs=[];s.handovers=[{id:'signed',shiftId:'source',confirmedAt:'2026-10-07T00:00:00Z',participants:[person]}];s.auditLogs=[];s.staffMembers=[];});
const app=express();app.use(express.json());app.use('/api/users',users);app.use('/api',core);app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const call=async(url,user=care,method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${url}`,{method,headers:{Authorization:`Bearer ${signUser(user)}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json()}};
try{
 await test('History is paginated, scoped to roster and branch, includes completed prior work and excludes later shifts/deleted records',async()=>{
  await updateStore(s=>{
    s.changeLogs=Array.from({length:45},(_,i)=>record(`history-${String(i).padStart(3,'0')}`,'source',{attentionStatus:i%2?'OPEN':'RESOLVED',resolutionNote:i%2?'':'Đã xử lý',occurredAt:new Date(Date.UTC(2026,9,6,0,i)).toISOString()}));
    s.changeLogs.push(record('future','future'),record('cross','foreign',{branchId:'other'}),record('deleted','source',{deleted:true}),record('not-roster','source',{residentId:'absent'}));
  });
  const path='/shifts/morning/residents/r/history';
  const first=await call(path);assert.equal(first.status,200);assert.equal(first.body.data.items.length,20);assert.equal(first.body.data.nextOffset,20);assert.ok(first.body.data.items.some(x=>x.attentionStatus==='RESOLVED'));
  const next=await call(path+'?offset=20'),last=await call(path+'?offset=40');assert.equal(next.body.data.items.length,20);assert.equal(last.body.data.items.length,5);assert.equal(last.body.data.nextOffset,null);
  const rows=[...first.body.data.items,...next.body.data.items,...last.body.data.items];assert.equal(new Set(rows.map(x=>x.id)).size,45);assert.ok(rows.every(x=>x.sourceShiftDate==='2026-10-06'&&x.sourceShiftType==='NIGHT'));assert.ok(rows.every((x,i)=>!i||Date.parse(x.occurredAt)<=Date.parse(rows[i-1].occurredAt)));
  for(const user of [admin,director,care,cskh])assert.equal((await call(path,user)).status,200);
  assert.equal((await call(path,other)).status,404);assert.equal((await call('/shifts/morning/residents/absent/history')).status,404);
  assert.equal((await call(path+'?offset=-1')).status,422);assert.equal((await call(path+'?offset=bad')).status,422);
 });
 await test('Reading resident history does not mutate observations, signatures, shifts or audit state',async()=>{
  const before=await getStore();assert.equal((await call('/shifts/morning/residents/r/history')).status,200);assert.deepEqual(await getStore(),before);
 });
}finally{await new Promise(r=>server.close(r));await fs.rm(temp,{recursive:true,force:true});}
