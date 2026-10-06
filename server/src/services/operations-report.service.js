import { createHash } from 'node:crypto';
import { periodFilter, visible, nowISO, dayVN, plusDays } from './operations-domain.service.js';

const distinct=(rows,key)=>new Set(rows.map(r=>r[key]).filter(Boolean)).size;
const ratio=(a,b)=>b?Math.round(a/b*10000)/100:null;
const inside=(date,f)=>date>=f.from&&date<=f.to;
export function legacyReportState(legacy,branchId){
  const shifts=(legacy.shifts||[]).filter(s=>s.branchId===branchId).map(s=>({...s,businessDate:s.shiftDate,legacy:true}));const shiftMap=new Map(shifts.map(s=>[s.id,s]));
  const roster=(legacy.shiftResidents||[]).filter(r=>shiftMap.has(r.shiftId)).map(r=>({...r,id:r.residentId,residentId:r.residentId,name:r.residentName||r.fullName||'',zoneId:r.areaId||null,zoneName:r.areaName||'Chưa xác định',floorId:r.floorId||null,floorName:r.floorName||'',businessDate:shiftMap.get(r.shiftId).businessDate,legacy:true}));
  const activities=[...(legacy.changeLogs||[]),...(legacy.toiletingLogs||[])].filter(a=>!a.deleted&&shiftMap.has(a.shiftId)).map(a=>{
    const shift=shiftMap.get(a.shiftId),resident=roster.find(r=>r.shiftId===a.shiftId&&r.residentId===a.residentId);
    return {...a,businessDate:shift.businessDate,shiftType:shift.shiftType,zoneId:a.areaId||resident?.zoneId||null,zoneName:a.areaName||resident?.zoneName||'Chưa xác định',floorId:a.floorId||null,floorName:a.floorName||'',occurredAt:a.occurredAt||a.createdAt,savedAt:a.savedAt||a.createdAt,enteredByUserId:a.createdBy,enteredByName:a.createdByName||'',performedByStaffId:a.performedByStaffId||null,performedByStaffName:a.performedByStaffName||'',coPerformerIds:a.coPerformerIds||[],content:a.content||a.note||'',category:a.category||'TOILETING',legacy:true};
  });
  const assignments=shifts.flatMap(s=>(s.assignedStaff||[]).map(p=>({id:`legacy:${s.id}:${p.id}`,branchId,shiftId:s.id,zoneId:s.areaId||null,zoneName:s.areaName||'Chưa xác định',floorId:null,staffId:p.id,staffName:p.fullName,employeeCode:p.employeeCode,linkedUserId:p.userId||null,businessDate:s.businessDate,legacy:true,status:'PLANNED',function:p.id===s.primaryRecorderId?'RECORDER':'DUTY'})));
  return {shifts,residents:roster,activities,assignments};
}
export function buildReport(states,user,q={},asOf=nowISO()){
  const f=periodFilter(q,asOf),flatten=k=>states.flatMap(s=>s[k]||[]).filter(r=>visible(user,r)&&(!f.branchId||r.branchId===f.branchId));
  if(f.locationMode!=='responsibleScope')throw Object.assign(new Error('Bản này hỗ trợ nhóm theo khu chịu trách nhiệm.'),{status:422});
  const shifts=states.flatMap(s=>s.shifts||[]).filter(s=>user.role==='ADMIN'||(user.userScopes?.length?user.userScopes.some(g=>g.branchId===s.branchId):user.branchId===s.branchId)),shiftMap=new Map(shifts.map(s=>[s.id,s]));
  const allActivities=flatten('activities').filter(a=>(a.savedAt||a.createdAt||'')<=asOf);
  const spatial=r=>(!f.zoneId||r.zoneId===f.zoneId)&&(!f.floorId||r.floorId===f.floorId);
  const shiftType=r=>!f.shiftType||(r.shiftType||shiftMap.get(r.shiftId)?.shiftType)===f.shiftType;
  const eventDay=a=>f.timeBasis==='businessDate'?a.businessDate:dayVN(a[f.timeBasis]||a.createdAt);
  const selectedActivities=allActivities.filter(a=>spatial(a)&&shiftType(a)&&inside(eventDay(a),f));
  const allAssignments=flatten('assignments');
  const activities=selectedActivities.filter(a=>!f.staffId||(f.attribution==='performer'?a.performedByStaffId===f.staffId:f.attribution==='coPerformer'?(a.coPerformerIds||[]).includes(f.staffId):allAssignments.some(x=>x.staffId===f.staffId&&x.linkedUserId===a.enteredByUserId)));
  const tasks=flatten('tasks').filter(t=>spatial(t)&&shiftType(t)&&inside(t.businessDate,f)&&t.createdAt<=asOf&&t.status!=='CANCELLED'&&t.dueAt<=asOf);
  const backlog=flatten('tasks').filter(t=>spatial(t)&&shiftType(t)&&t.createdAt<=asOf&&t.status!=='CANCELLED'&&t.dueAt<f.startInclusive&&(!t.completedAt||t.completedAt>asOf));
  const assignments=allAssignments.filter(a=>spatial(a)&&inside(a.businessDate||shiftMap.get(a.shiftId)?.businessDate||'',f)&&shiftType(a)&&(!f.staffId||a.staffId===f.staffId));
  const scopes=flatten('scopes').filter(s=>spatial(s)&&inside(s.businessDate,f)&&shiftType(s));
  const locationRows=flatten('locations');
  const roster=states.flatMap(s=>s.residents||[]).flatMap(r=>{
    if(r.legacy)return visible(user,r)&&spatial(r)&&inside(r.businessDate,f)?[r]:[];
    const histories=locationRows.filter(l=>l.residentId===r.id&&l.branchId===r.branchId&&l.validFrom<f.endExclusive&&(!l.validTo||l.validTo>f.startInclusive)&&spatial(l));
    return histories.flatMap(l=>{
      const located={...r,...l,id:r.id,residentId:r.id,name:r.name};
      if(f.groupBy!=='day')return [located];
      const days=[];for(let date=f.from;date<=f.to;date=plusDays(date,1)){const start=new Date(`${date}T00:00:00+07:00`).toISOString(),end=new Date(`${plusDays(date,1)}T00:00:00+07:00`).toISOString();if(l.validFrom<end&&(!l.validTo||l.validTo>start))days.push({...located,businessDate:date})}return days;
    });
  }).filter(r=>(!f.branchId||r.branchId===f.branchId)&&visible(user,r));
  const metric=(aa,tt,rr,ss)=>({residentsWithActivity:distinct(aa,'residentId'),rosterResidents:distinct(rr,'residentId'),activityCount:distinct(aa,'id'),uniqueStaff:distinct(ss,'staffId'),dueTasks:distinct(tt,'id'),completedTasks:distinct(tt.filter(t=>t.completedAt&&t.completedAt<=asOf),'id'),completionPercent:ratio(distinct(tt.filter(t=>t.completedAt&&t.completedAt<=asOf),'id'),distinct(tt,'id')),missingTasks:distinct(tt.filter(t=>!t.completedAt||t.completedAt>asOf),'id'),unknownPerformer:aa.filter(a=>!a.performedByStaffId).length,unmappedFloor:aa.filter(a=>!a.floorId).length});
  const groups=new Map();if(f.groupBy==='day')for(let date=f.from;date<=f.to;date=plusDays(date,1))groups.set(date,{id:date,name:date,activities:[],tasks:[],residents:[],assignments:[]});const group=r=>{
    if(f.groupBy==='day'){const d=r.occurredAt?eventDay(r):r.businessDate||shiftMap.get(r.shiftId)?.businessDate;return {id:d||'UNKNOWN',name:d||'Chưa xác định'}}
    if(f.groupBy==='floor')return{id:`${r.branchId}:${r.zoneId||'UNKNOWN'}:${r.floorId||'UNKNOWN'}`,name:`${r.zoneName||'Chưa xác định'} / ${r.floorName||'Chưa xác định'}`};
    if(f.groupBy==='resident')return{id:r.residentId||r.id,name:r.residentName||r.name||'NCT'};
    if(f.groupBy==='staff')return{id:f.attribution==='enteredBy'?(r.enteredByUserId||r.linkedUserId||'UNKNOWN'):(r.performedByStaffId||r.staffId||'UNKNOWN'),name:f.attribution==='enteredBy'?(r.enteredByName||r.staffName||'Chưa xác định'):(r.performedByStaffName||r.staffName||'Chưa xác định')};
    return{id:`${r.branchId}:${r.zoneId||'UNKNOWN'}`,name:r.zoneName||'Chưa xác định'};
  };
  const add=(collection,key)=>collection.forEach(r=>{const g=group(r);if(!groups.has(g.id))groups.set(g.id,{...g,activities:[],tasks:[],residents:[],assignments:[]});groups.get(g.id)[key].push(r)});
  if(f.groupBy==='staff'&&f.attribution==='coPerformer'){
    for(const a of activities)for(const id of a.coPerformerIds||[]){const p=allAssignments.find(x=>x.staffId===id);add([{...a,performedByStaffId:id,performedByStaffName:p?.staffName||id}],'activities')}
  }else add(activities,'activities');
  if(f.groupBy!=='staff'){add(tasks,'tasks');add(roster,'residents')}add(assignments,'assignments');
  const rows=[...groups.values()].map(g=>({id:g.id,name:g.name,...metric(g.activities,g.tasks,g.residents,g.assignments)})).sort((a,b)=>a.name.localeCompare(b.name,'vi'));
  if(f.groupBy==='staff')for(const row of rows){row.dueTasks=null;row.completedTasks=null;row.completionPercent=null;row.missingTasks=null}
  const residentMap=new Map();for(const r of roster)residentMap.set(r.residentId||r.id,{id:r.residentId||r.id,name:r.name||r.residentName,zoneName:r.zoneName||'Chưa xác định',floorName:r.floorName||'',roomName:r.roomName||'',bedName:r.bedName||''});
  for(const a of activities)if(!residentMap.has(a.residentId))residentMap.set(a.residentId,{id:a.residentId,name:a.residentName,zoneName:a.zoneName,floorName:a.floorName,roomName:a.roomName,bedName:a.bedName});
  const residents=[...residentMap.values()].map(r=>{const aa=activities.filter(a=>a.residentId===r.id),tt=tasks.filter(t=>t.residentId===r.id),latest=aa.toSorted?aa.toSorted((a,b)=>b.occurredAt.localeCompare(a.occurredAt))[0]:[...aa].sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt))[0];return{...r,activityCount:aa.length,dueTasks:tt.length,completedTasks:tt.filter(t=>t.completedAt&&t.completedAt<=asOf).length,lastOccurredAt:latest?.occurredAt||null,lastContent:latest?.content||'',pendingFromPriorPeriod:backlog.filter(t=>t.residentId===r.id).length}});
  const schedules=flatten('schedules').filter(s=>s.active&&s.required&&spatial(s)&&shiftType(s));let expected=0,created=0,signed=0;const handoverRows=[];
  // Recurring daily schedule only. The report states this source explicitly.
  for(let date=f.from;date<=f.to;date=plusDays(date,1))for(const plan of schedules){
    const endDate=plan.endTime<=plan.startTime?plusDays(date,1):date;const dueAt=new Date(`${endDate}T${plan.endTime}:00+07:00`).toISOString();if(dueAt>asOf)continue;
    expected++;const s=scopes.find(x=>x.zoneId===plan.zoneId&&x.businessDate===date&&x.shiftType===plan.shiftType);if(s)created++;if(s?.signedAt&&s.signedAt<=asOf)signed++;handoverRows.push({id:s?.id||`${plan.id}:${date}`,businessDate:date,zoneName:s?.zoneName||flatten('zones').find(z=>z.id===plan.zoneId)?.name||'',shiftType:plan.shiftType,status:s?.status||'NOT_CREATED',dataVersion:s?.dataVersion||null});
  }
  const cursor=Math.max(0,Number(q.cursor||0)),limit=Math.max(1,Math.min(200,Number(q.limit||100)));if(!Number.isInteger(cursor)||!Number.isInteger(limit))throw Object.assign(new Error('Phân trang không hợp lệ.'),{status:422});const paginate=items=>items.slice(cursor,cursor+limit);
  const revision=createHash('sha256').update(JSON.stringify({activities:activities.map(a=>[a.id,a.version,a.updatedAt,a.content]).sort((a,b)=>a[0].localeCompare(b[0])),tasks:[...tasks,...backlog].map(t=>[t.id,t.status,t.completedAt]).sort((a,b)=>a[0].localeCompare(b[0])),assignments:assignments.map(a=>[a.id,a.version,a.status]).sort((a,b)=>a[0].localeCompare(b[0])),scopes:scopes.map(s=>[s.id,s.dataVersion,s.status]).sort((a,b)=>a[0].localeCompare(b[0])),roster:roster.map(r=>[r.residentId,r.zoneId,r.floorId]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})).digest('hex');
  return {revision,resolvedFilter:{...f,branchIds:[...new Set(states.flatMap(s=>Object.values(s).flat()).filter(r=>r.branchId&&visible(user,r)).map(r=>r.branchId))]},timezone:'Asia/Ho_Chi_Minh',asOf,cutoff:asOf,dataThrough:asOf,reportVersion:1,status:dayVN(asOf)<=f.to?'PROVISIONAL':'UNFINALIZED',sourceBasis:{timeBasis:f.timeBasis,attribution:f.attribution,statusBasis:'CURRENT',locationMode:'responsibleScope',rosterBasis:'LOCATION_HISTORY_AND_LEGACY_ROSTER',handoverBasis:'CURRENT_DAILY_SCHEDULE'},totals:{...metric(activities,tasks,roster,assignments),pendingFromPriorPeriod:backlog.length},rows:paginate(rows),residents:paginate(residents),activities:paginate([...activities].sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt))).map(a=>({id:a.id,residentId:a.residentId,residentName:a.residentName,businessDate:a.businessDate,zoneName:a.zoneName,floorName:a.floorName,occurredAt:a.occurredAt,savedAt:a.savedAt,performedByStaffName:a.performedByStaffName||'Chưa xác định',enteredByName:a.enteredByName||'',content:a.content,category:a.category,version:a.version||1,scopeId:a.scopeId,legacy:!!a.legacy})),assignments:paginate(assignments),handovers:paginate(handoverRows),completeness:{expectedScopes:expected,createdScopes:created,signedScopes:signed,handoverPercent:ratio(signed,expected),missingScopes:expected-created,unmappedFloor:activities.filter(a=>!a.floorId).length,unknownPerformer:activities.filter(a=>!a.performedByStaffId).length,hasCarePlan:tasks.length>0,legacyRows:activities.filter(a=>a.legacy).length},pagination:{cursor,limit,rowCount:rows.length,residentCount:residents.length,activityCount:activities.length,assignmentCount:assignments.length,handoverCount:handoverRows.length},nextCursor:Math.max(rows.length,residents.length,activities.length,assignments.length,handoverRows.length)>cursor+limit?String(cursor+limit):null};
}
export function csvReport(report){
  const safe=value=>{let s=String(value??'');if(/^[=+\-@\t\r]/.test(s))s=`'${s}`;return`"${s.replace(/"/g,'""')}"`};
  const data=[['Từ ngày',report.resolvedFilter.from,'Đến ngày',report.resolvedFilter.to,'Thời gian',report.asOf,'Trạng thái',report.status],['Cơ sở',report.resolvedFilter.branchId||report.resolvedFilter.branchIds.join(';'),'Ca',report.resolvedFilter.shiftType,'Nhân viên',report.resolvedFilter.staffId,'Kỳ',report.resolvedFilter.period],['Cơ sở thời gian',report.sourceBasis.timeBasis,'Vai trò',report.sourceBasis.attribution,'Khu',report.resolvedFilter.zoneId,'Tầng',report.resolvedFilter.floorId],['Nhóm','NCT có hoạt động','Hoạt động','Việc đến hạn','Hoàn thành','Tỷ lệ %','Chưa hoàn thành'],...report.rows.map(r=>[r.name,r.residentsWithActivity,r.activityCount,r.dueTasks,r.completedTasks,r.completionPercent??'N/A',r.missingTasks]),['TỔNG (đếm DISTINCT lại)',report.totals.residentsWithActivity,report.totals.activityCount,report.totals.dueTasks,report.totals.completedTasks,report.totals.completionPercent??'N/A',report.totals.missingTasks]];return'\uFEFF'+data.map(r=>r.map(safe).join(',')).join('\r\n');
}
