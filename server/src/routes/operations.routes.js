import { Router } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { authenticate } from '../middleware/auth.js';
import { CARE_BRANCHES } from '../config/branches.js';
import { getStore, getUsers } from '../services/store.service.js';
import { getResidents } from '../services/bcare.service.js';
import { readOperations, transactOperations } from '../services/operations-store.service.js';
import * as D from '../services/operations-domain.service.js';
import { buildReport, legacyReportState, csvReport } from '../services/operations-report.service.js';

const router=Router();router.use(authenticate);
const route=(method,url,handler)=>router[method](url,(req,res,next)=>Promise.resolve(handler(req,res)).catch(next));
const allowedBranches=user=>CARE_BRANCHES.filter(b=>user.role==='ADMIN'||D.grants(user).some(g=>String(g.branchId)===b.id));
function branch(req){const id=String(req.body?.branchId||req.query.branchId||req.user.branchId||'');if(!allowedBranches(req.user).some(b=>b.id===id))D.fail('Cơ sở ngoài phạm vi được cấp.',403);return id}
const ok=(res,data)=>res.json({success:true,data});
const mutation=(permission,fn)=>async(req,res)=>{D.requirePermission(req.user,permission);const id=branch(req);const data=await transactOperations(id,state=>fn(state,req,id));ok(res,data)};
route('get','/operations/bootstrap',async(req,res)=>{
  const id=branch(req);if(!['SHIFT.VIEW','REPORT.VIEW','CSKH.VIEW'].some(p=>req.user.permissions?.includes(p))&&req.user.role!=='ADMIN')D.fail('Không có quyền xem.',403);
  const [state,legacy,users]=await Promise.all([readOperations(id),getStore(),getUsers()]);
  const view=k=>state[k].filter(r=>['zones','floors','rooms','schedules','shifts'].includes(k)?D.containerVisible(req.user,r):D.visible(req.user,r));
  // Assignment selection exposes staff identifiers only, never passwords or medical fields.
  ok(res,{branches:allowedBranches(req.user),zones:view('zones'),floors:view('floors'),rooms:view('rooms'),schedules:view('schedules'),staff:(legacy.staffMembers||[]).filter(s=>s.branchId===id&&!s.deleted&&s.active!==false).map(s=>({id:s.id,fullName:s.fullName,employeeCode:s.employeeCode,areaId:s.areaId,areaName:s.areaName})),residents:view('residents'),users:users.filter(u=>u.active!==false&&(u.branchId===id||D.grants(u).some(g=>g.branchId===id))).map(u=>({id:u.id,fullName:u.fullName})),shifts:view('shifts')});
});
route('post','/operations/org/:kind',mutation('SYSTEM.UPDATE',(s,r,id)=>D.configureOrg(s,r.user,id,r.params.kind,r.body)));
route('post','/operations/residents/sync',async(req,res)=>{
  D.requirePermission(req.user,'SYSTEM.UPDATE');const id=branch(req);let items=[],pageIndex=1,totalPage=1;
  do{const result=await getResidents({branchId:id,pageIndex,pageSize:100});items.push(...result.items);totalPage=Number(result.totalPage||Math.ceil(Number(result.totalItem||items.length)/100)||1);if(!Number.isFinite(totalPage)||totalPage>1000)D.fail('Danh mục quá lớn. Cần đồng bộ theo lô nền.',413);pageIndex++}while(pageIndex<=totalPage);
  if(items.some(r=>String(r.id).startsWith('MOCK-'))&&req.body.allowDemo!==true)D.fail('BCARE đang trả dữ liệu giả lập. Chọn cho phép dữ liệu demo nếu chỉ chạy thử.',409);
  ok(res,await transactOperations(id,s=>D.syncResidents(s,req.user,id,items)));
});
route('post','/operations/shifts',mutation('SHIFT.CREATE',(s,r,id)=>D.ensureShift(s,r.user,id,r.body)));
route('get','/operations/shifts/:id',async(req,res)=>{
  D.requirePermission(req.user,'SHIFT.VIEW');const state=await readOperations(branch(req)),shift=D.getRow(state,'shifts',req.params.id);if(!D.containerVisible(req.user,shift))D.fail('Ca ngoài phạm vi.',403);
  const scopes=state.scopes.filter(s=>s.shiftId===shift.id&&D.containerVisible(req.user,s)),ids=new Set(scopes.map(s=>s.id));
  ok(res,{shift,scopes,assignments:state.assignments.filter(a=>ids.has(a.scopeId)&&D.visible(req.user,a)),residents:state.residents.filter(r=>D.visible(req.user,r)&&scopes.some(s=>s.zoneId===r.zoneId)),tasks:state.tasks.filter(t=>ids.has(t.scopeId)&&D.visible(req.user,t)),activities:state.activities.filter(a=>ids.has(a.scopeId)&&D.visible(req.user,a)),handovers:state.handovers.filter(h=>ids.has(h.scopeId)&&D.visible(req.user,h)).map(h=>({...h,snapshot:undefined}))});
});
route('post','/operations/assignments',async(req,res)=>{D.requirePermission(req.user,'SHIFT.UPDATE');const id=branch(req),legacy=await getStore();ok(res,await transactOperations(id,s=>D.saveAssignment(s,req.user,id,req.body,legacy.staffMembers||[])))});
route('patch','/operations/assignments/:id',mutation('SHIFT.UPDATE',(s,r)=>D.updateAssignment(s,r.user,r.params.id,r.body)));
route('post','/operations/residents/:id/transfers',mutation('SHIFT.UPDATE',(s,r)=>D.transferResident(s,r.user,r.params.id,r.body)));
route('post','/operations/tasks',mutation('SHIFT.UPDATE',(s,r)=>D.createTask(s,r.user,r.body)));
route('post','/operations/activities',async(req,res)=>{D.requirePermission(req.user,'CARE.CREATE');const id=branch(req),legacy=await getStore();ok(res,await transactOperations(id,s=>D.createActivity(s,req.user,req.body,legacy.staffMembers||[])))});
route('patch','/operations/activities/:id',mutation('CARE.UPDATE',(s,r)=>D.updateActivity(s,r.user,r.params.id,r.body)));
route('get','/operations/scopes/:id/handover-preview',async(req,res)=>{D.requirePermission(req.user,'HANDOVER.VIEW');ok(res,D.handoverPreview(await readOperations(branch(req)),req.user,req.params.id))});
route('post','/operations/scopes/:id/sign',mutation('HANDOVER.SIGN',(s,r)=>D.signScope(s,r.user,r.params.id,r.body)));
route('post','/operations/scopes/:id/receive',mutation('HANDOVER.RECEIVE',(s,r)=>D.receiveScope(s,r.user,r.params.id,r.body)));
async function reportFor(req){
  D.requirePermission(req.user,req.path.startsWith('/cskh')?'CSKH.VIEW':'REPORT.VIEW');const requested=req.query.branchId||req.body?.branchId;const branches=allowedBranches(req.user).filter(b=>!requested||b.id===requested);if(requested&&!branches.length)D.fail('Cơ sở ngoài phạm vi.',403);
  const legacy=await getStore(),states=[];for(const b of branches){const current=await readOperations(b.id);states.push(current,legacyReportState(legacy,b.id))}
  const q=req.method==='POST'?req.body:req.query;const cutoff=q.cutoff?D.instant(q.cutoff):D.nowISO();if(cutoff>D.nowISO())D.fail('Mốc báo cáo không được ở tương lai.');const report=buildReport(states,req.user,q,cutoff);report.fingerprint=createHash('sha256').update(JSON.stringify({totals:report.totals,revision:report.revision})).digest('hex');return report;
}
route('get','/reporting/overview',async(req,res)=>ok(res,await reportFor(req)));
route('get','/cskh/daily',async(req,res)=>ok(res,await reportFor(req)));
route('get','/reporting/export',async(req,res)=>{D.requirePermission(req.user,'REPORT.EXPORT');const data=await reportFor(req);if(req.query.expectedFingerprint&&req.query.expectedFingerprint!==data.fingerprint)D.fail('Dữ liệu đã thay đổi. Tải lại báo cáo trước khi xuất.',409);if(data.pagination.rowCount>200)D.fail('Hơn 200 nhóm; thu hẹp bộ lọc hoặc dùng xuất theo từng trang.',413);data.rows=data.rows;res.set('Content-Type','text/csv; charset=utf-8');res.set('Content-Disposition','attachment; filename="ShiftCare-report.csv"');res.send(csvReport(data))});
route('get','/cskh/residents/:id/timeline',async(req,res)=>{
  D.requirePermission(req.user,'CSKH.VIEW');const branchId=branch(req),s=await readOperations(branchId),legacy=legacyReportState(await getStore(),branchId);const r=s.residents.find(r=>r.id===req.params.id)||legacy.residents.find(r=>r.id===req.params.id&&D.visible(req.user,r));if(!r)D.fail('Chưa có NCT trong roster.',404);D.assertVisible(req.user,r);
  const match=x=>x.residentId===r.id&&D.visible(req.user,x);ok(res,{resident:r,activities:[...s.activities,...legacy.activities].filter(match).map(a=>({id:a.id,content:a.content,category:a.category,occurredAt:a.occurredAt,savedAt:a.savedAt,performedByStaffName:a.performedByStaffName,enteredByName:a.enteredByName,zoneName:a.zoneName,floorName:a.floorName})),interactions:s.interactions.filter(match),followups:s.followups.filter(match)});
});
route('post','/cskh/interactions',mutation('CSKH.CREATE',(s,r)=>D.createInteraction(s,r.user,r.body)));
route('post','/follow-ups',async(req,res)=>{D.requirePermission(req.user,'CSKH.CREATE');const id=branch(req),users=await getUsers();ok(res,await transactOperations(id,s=>D.createFollowup(s,req.user,req.body,users)))});
route('patch','/follow-ups/:id',async(req,res)=>{const id=branch(req);ok(res,await transactOperations(id,s=>D.updateFollowup(s,req.user,req.params.id,req.body)))});
route('get','/follow-ups',async(req,res)=>{if(!req.user.permissions?.includes('CSKH.VIEW')&&!req.user.permissions?.includes('FOLLOWUP.VIEW')&&req.user.role!=='ADMIN')D.fail('Không có quyền xem tác vụ.',403);ok(res,(await readOperations(branch(req))).followups.filter(r=>D.visible(req.user,r)&&(req.user.role==='ADMIN'||req.user.permissions?.includes('CSKH.VIEW')||r.ownerId===req.user.sub)))});
route('post','/reporting/snapshots',async(req,res)=>{
  D.requirePermission(req.user,'REPORT.FINALIZE');const id=branch(req);if(req.body.status==='FINAL')D.fail('Chưa hỗ trợ chốt FINAL: cần lịch hiệu lực, kiểm tra đầy đủ và quy trình bổ sung. Có thể lưu bản tạm.');
  // Snapshot reads V2 state and legacy separately: deliberately PROVISIONAL only.
  const report=await reportFor(req);if(report.nextCursor)D.fail('Thu hẹp kỳ/phạm vi để lưu đủ snapshot trong một trang.',413);
  ok(res,await transactOperations(id,s=>{const row={id:randomUUID(),branchId:id,status:'PROVISIONAL',createdBy:req.user.sub,createdAt:D.nowISO(),report};s.snapshots.push(row);D.auditV2(s,req.user,'REPORT_SNAPSHOT',row);return row}));
});
route('get','/operations/audit',async(req,res)=>{D.requirePermission(req.user,'AUDIT.VIEW');const limit=Math.min(200,Math.max(1,Number(req.query.limit)||100));ok(res,(await readOperations(branch(req))).audits.filter(r=>D.visible(req.user,r)).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,limit))});
export default router;
