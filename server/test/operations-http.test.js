import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'shiftcare-v2-test-'));
process.env.SHIFTCARE_OPERATIONS_DATA_DIR=temp;
if(process.env.DATABASE_URL)throw new Error('Integration tests require JSON mode; unset DATABASE_URL.');
const {default:router}=await import('../src/routes/operations.routes.js');
const {getUsers}=await import('../src/services/store.service.js');
const {signUser}=await import('../src/middleware/auth.js');
const {CARE_BRANCHES}=await import('../src/config/branches.js');
const {transactOperations,readOperations}=await import('../src/services/operations-store.service.js');
const app=express();app.use(express.json());app.use('/api',router);app.use((e,req,res,next)=>res.status(e.status||500).json({message:e.message}));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,user=(await getUsers()).find(u=>u.role==='ADMIN'&&u.active!==false),token=signUser(user),branchId=CARE_BRANCHES[0].id;
async function call(url,method='GET',body){const query=method==='GET'?`?branchId=${branchId}`:'';const response=await fetch(origin+'/api'+url+query,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify({branchId,...body})});return{status:response.status,body:await response.json()}}
try{
  await test('API persists shared shifts, independent scopes and denies stale handover',async()=>{
    const zone=(await call('/operations/org/zones','POST',{name:'Khu kiểm thử'})).body.data;
    assert.ok(zone.id);
    const schedule=await call('/operations/org/schedules','POST',{zoneId:zone.id,shiftType:'NIGHT',startTime:'18:00',endTime:'06:00',minimumStaff:0});assert.equal(schedule.status,200);
    const requests=await Promise.all(Array.from({length:8},()=>call('/operations/shifts','POST',{businessDate:'2026-10-04',shiftType:'NIGHT'})));assert.equal(new Set(requests.map(r=>r.body.data.id)).size,1);
    const state=await readOperations(branchId);assert.equal(state.shifts.length,1);assert.equal(state.scopes.length,1);
    const scope=state.scopes[0];
    await transactOperations(branchId,s=>{s.residents.push({id:'http-resident',residentId:'http-resident',branchId,name:'NCT kiểm thử',zoneId:zone.id});s.locations.push({id:'http-location',residentId:'http-resident',branchId,zoneId:zone.id,validFrom:'2026-10-01T00:00:00Z',validTo:null})});
    const preview=await call(`/operations/scopes/${scope.id}/handover-preview`);assert.equal(preview.status,200);
    const task=await call('/operations/tasks','POST',{scopeId:scope.id,residentId:'http-resident',title:'Việc kiểm thử',dueAt:'2026-10-05T04:00:00+07:00'});assert.equal(task.status,200);
    const stale=await call(`/operations/scopes/${scope.id}/sign`,'POST',{confirm:true,dataVersion:preview.body.data.dataVersion,note:'Còn việc chuyển tiếp'});assert.equal(stale.status,409);
    const fresh=(await call(`/operations/scopes/${scope.id}/handover-preview`)).body.data;
    const signed=await call(`/operations/scopes/${scope.id}/sign`,'POST',{confirm:true,dataVersion:fresh.dataVersion,note:'Còn việc chuyển tiếp'});assert.equal(signed.status,200);
    const locked=await call('/operations/tasks','POST',{scopeId:scope.id,residentId:'http-resident',title:'Không được ghi sau khóa',dueAt:'2026-10-05T04:00:00+07:00'});assert.equal(locked.status,423);
    const after=await readOperations(branchId);assert.equal(after.tasks.length,1);assert.equal(after.scopes[0].status,'SIGNED');assert.ok(after.audits.length);
    const reportResponse=await fetch(origin+'/api/reporting/overview?'+new URLSearchParams({branchId,period:'day',date:'2026-10-04'}),{headers:{Authorization:`Bearer ${token}`}});const report=await reportResponse.json();assert.equal(reportResponse.status,200);assert.ok(report.data.resolvedFilter);assert.equal(report.data.completeness.signedScopes,1);
  });
  await test('API requires authentication and rejects invalid org parents',async()=>{
    const denied=await fetch(origin+'/api/operations/bootstrap?branchId='+branchId);assert.equal(denied.status,401);
    const parent=await call('/operations/org/floors','POST',{zoneId:'missing',name:'Tầng sai'});assert.equal(parent.status,404);
  });
}finally{await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true})}
