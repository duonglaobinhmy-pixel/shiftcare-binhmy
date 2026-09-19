import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { authenticate, allowRoles, allowPermission } from '../middleware/auth.js';
import { getStore, updateStore, getUsers } from '../services/store.service.js';
import { getResidents } from '../services/bcare.service.js';
import { branchInfo } from '../config/branches.js';
import { audit } from '../services/audit.service.js';
import { notifyUrgentCreated,notifyUrgentResolved } from '../services/telegram.service.js';
import { sanitizeWoundImages } from '../services/media-retention.service.js';
import { getStaffOptionsFast,getShiftsFast,getShiftDetailFast,getReportBundleFast,getDashboardBundleFast,getStaffReportBundleFast,createShiftFast,updateShiftStaffFast,replaceShiftRosterFast,deleteShiftFast } from '../services/fast-query.service.js';

const router = Router();
router.use(authenticate);

function visibleByScope(user,row){
  if(user.role==='ADMIN') return true;
  if(row.branchId && row.branchId!==user.branchId) return false;
  if(user.role==='CAREGIVER' && user.areaId && row.areaId && row.areaId!==user.areaId) return false;
  return true;
}
function canAccessShift(user,shift){
  if(!visibleByScope(user,shift))return false;
  if(user.role!=='CAREGIVER')return true;
  if(Array.isArray(shift.assignedStaff)&&shift.assignedStaff.length)return shift.assignedStaff.some(x=>x.id===user.sub||x.userId===user.sub);
  if(Array.isArray(shift.assignedStaffIds)&&shift.assignedStaffIds.length)return shift.assignedStaffIds.includes(user.sub);
  if(shift.assignedStaffId)return shift.assignedStaffId===user.sub;
  return true;
}
function todayVN(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date())}
function dateVN(value){if(!value)return'';if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const d=value instanceof Date?value:new Date(value);if(Number.isNaN(d.getTime()))return'';return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(d)}
function inEventRange(value,range){const d=dateVN(value);return!!d&&range.inRange(d)}
function normalizeDateOnly(value){if(!value)return todayVN();const raw=String(value).trim();if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;const d=new Date(value);if(Number.isNaN(d.getTime()))throw new Error(`Ngày không hợp lệ: ${raw}`);return d.toISOString().slice(0,10)}
function reportRange(query){const today=todayVN();let from=String(query.from||query.date||today),to=String(query.to||query.date||from);if(to<from)[from,to]=[to,from];return{from,to,inRange:(date)=>String(date||'')>=from&&String(date||'')<=to}}
function currentShiftType(){
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',hour12:false}).format(new Date()));
  return hour>=6&&hour<18?'MORNING':'NIGHT';
}
function attentionLevel(x){
  if(x.attentionLevel==='RED'||x.attentionLevel==='YELLOW')return x.attentionLevel;
  if(x.vitals?.alertLevel==='RED'||x.eventType==='FALL')return'RED';
  if(x.vitals?.alertLevel==='YELLOW'||x.priority==='HIGH'||x.vitals?.concern)return'YELLOW';
  return null;
}
function attentionStatus(x){return attentionLevel(x)?(x.attentionStatus==='RESOLVED'?'RESOLVED':'OPEN'):null}
function withAttention(x){return{...x,attentionLevel:attentionLevel(x),attentionStatus:attentionStatus(x)}}
function isAttentionChange(x){return attentionLevel(x)!==null}
function shiftResidentCount(store,shiftId){return store.shiftResidents.filter(x=>x.shiftId===shiftId).length}
const bowelStatuses=new Set(['NORMAL','CONSTIPATION','DIARRHEA','OTHER']);
const urineStatuses=new Set(['NORMAL','SONDE','CATHETER','DIAPER','OTHER','LOW','NONE']);
const vitalRules={pulse:[20,250,'Mạch'],temperature:[30,45,'Nhiệt độ'],bpSys:[40,300,'Huyết áp tâm thu'],bpDia:[20,200,'Huyết áp tâm trương'],spo2:[1,100,'SpO2'],respiratoryRate:[1,100,'Nhịp thở']};
function vitalAlerts(v){
  const rows=[],add=(field,level,message)=>rows.push({field,level,message});
  if(v.pulse!==null){if(v.pulse<=40||v.pulse>=131)add('pulse','RED',`Mạch ${v.pulse} lần/phút`);else if(v.pulse<=50||v.pulse>=91)add('pulse','YELLOW',`Mạch ${v.pulse} lần/phút`)}
  if(v.temperature!==null){if(v.temperature<=35||v.temperature>=39.1)add('temperature','RED',`Nhiệt độ ${v.temperature}°C`);else if(v.temperature<=36||v.temperature>=38.1)add('temperature','YELLOW',`Nhiệt độ ${v.temperature}°C`)}
  if(v.bpSys!==null){if(v.bpSys<=90||v.bpSys>=220)add('bpSys','RED',`Huyết áp tâm thu ${v.bpSys} mmHg`);else if(v.bpSys<=110)add('bpSys','YELLOW',`Huyết áp tâm thu ${v.bpSys} mmHg`)}
  if((v.bpSys!==null&&v.bpSys>180)||(v.bpDia!==null&&v.bpDia>120))add('bpSys','RED',`Huyết áp ${v.bpSys??'—'}/${v.bpDia??'—'} mmHg – cần đo lại và kiểm tra triệu chứng`);
  if(v.spo2!==null){if(v.spo2<=91)add('spo2','RED',`SpO₂ ${v.spo2}%`);else if(v.spo2<=95)add('spo2','YELLOW',`SpO₂ ${v.spo2}%`)}
  if(v.respiratoryRate!==null){if(v.respiratoryRate<=8||v.respiratoryRate>=25)add('respiratoryRate','RED',`Nhịp thở ${v.respiratoryRate} lần/phút`);else if(v.respiratoryRate<=11||v.respiratoryRate>=21)add('respiratoryRate','YELLOW',`Nhịp thở ${v.respiratoryRate} lần/phút`)}
  return rows;
}
function normalizeVitals(vitals){
  if(!vitals)return null;
  const normalized={concern:!!vitals.concern};
  for(const [field,[min,max,label]] of Object.entries(vitalRules)){
    if(vitals[field]===''||vitals[field]===null||vitals[field]===undefined){normalized[field]=null;continue}
    const value=Number(vitals[field]);
    if(!Number.isFinite(value)||value<min||value>max)throw new Error(`${label} phải là số từ ${min} đến ${max}.`);
    normalized[field]=value;
  }
  if((normalized.bpSys===null)!==(normalized.bpDia===null))throw new Error('Cần nhập đủ cả huyết áp tâm thu và tâm trương.');
  if(normalized.bpSys!==null&&normalized.bpSys<=normalized.bpDia)throw new Error('Huyết áp tâm thu phải lớn hơn huyết áp tâm trương.');
  normalized.alerts=vitalAlerts(normalized);
  normalized.alertLevel=normalized.alerts.some(x=>x.level==='RED')?'RED':normalized.alerts.some(x=>x.level==='YELLOW')?'YELLOW':'NORMAL';
  normalized.concern=normalized.concern||normalized.alertLevel==='RED';
  if(normalized.alertLevel==='RED'){
    const urgent=vitals.urgent||{};
    if(!urgent.remeasured||!String(urgent.notifiedTo||'').trim()||!String(urgent.action||'').trim())throw new Error('Cảnh báo Đỏ: bắt buộc xác nhận đo lại, người đã báo và hành động xử lý.');
    normalized.urgent={remeasured:true,notifiedTo:String(urgent.notifiedTo).trim(),action:String(urgent.action).trim(),symptoms:String(urgent.symptoms||'').trim()};
  }else normalized.urgent=null;
  return normalized;
}

async function loadRosterForShift(shift,{replace=true}={}){
  let page=1,totalPage=1,items=[];
  do{
    const r=await getResidents({pageIndex:page,pageSize:100,branchId:shift.branchId,roomId:shift.roomId||'',status:1});
    totalPage=Number(r.totalPage||1);items.push(...(r.items||[]));page++;
  }while(page<=totalPage&&page<=20);
  const seen=new Set();
  items=items.filter(r=>{
    if(!r?.id)return false;
    if(shift.branchId&&r.branchId&&String(r.branchId)!==String(shift.branchId))return false;
    if(shift.areaId&&r.areaId&&String(r.areaId)!==String(shift.areaId))return false;
    if(shift.roomId&&r.roomId&&String(r.roomId)!==String(shift.roomId))return false;
    const key=String(r.id);if(seen.has(key))return false;seen.add(key);return true;
  });
  const fast=await replaceShiftRosterFast(shift,items);
  if(fast!==null)return fast;
  await updateStore(store=>{
    if(replace)store.shiftResidents=store.shiftResidents.filter(x=>x.shiftId!==shift.id);
    const existing=new Set(store.shiftResidents.filter(x=>x.shiftId===shift.id).map(x=>String(x.residentId)));
    for(const r of items){if(existing.has(String(r.id)))continue;store.shiftResidents.push({id:uuid(),shiftId:shift.id,residentId:String(r.id),code:r.code||'',fullName:r.fullName||'',branchId:String(r.branchId||shift.branchId),branchName:r.branchName||shift.branchName,areaId:r.areaId||null,areaName:r.areaName||'',roomId:r.roomId||null,roomName:r.roomName||'',bedName:r.bedName||'',image:r.image||'',derivedStatus:'NO_RECORDED_CHANGE'})}
  });
  return items.length;
}
async function createShift(user,body,{auto=false}={}){
  const branchId=user.role==='ADMIN'?String(body.branchId||''):String(user.branchId||'');
  if(!branchId)throw new Error('Bắt buộc xác định cơ sở.');
  const branchName=body.branchName||branchInfo(branchId)?.name||user.branchName||'';
  const requestedIds=[...new Set((Array.isArray(body.assignedStaffIds)?body.assignedStaffIds:[]).map(String).filter(Boolean))];
  const users=await getUsers();
  const shiftType=String(body.shiftType||currentShiftType());
  if(!['MORNING','NIGHT'].includes(shiftType))throw new Error('Chỉ được chọn Ca sáng hoặc Ca tối.');
  const fastStaff=await getStaffOptionsFast(branchId);
  const store=fastStaff===null?await getStore():null;
  const sourceStaff=fastStaff===null?(store.staffMembers||[]).filter(x=>x.active!==false&&!x.deleted&&String(x.branchId)===branchId):fastStaff;
  const assignedStaff=sourceStaff.filter(x=>requestedIds.includes(String(x.id))).map(x=>{const linked=users.find(u=>u.active!==false&&String(u.branchId||'')===branchId&&String(u.employeeCode||'').toLowerCase()===String(x.employeeCode||'').toLowerCase());return{id:String(x.id),userId:linked?.id||x.userId||null,username:linked?.username||x.username||'',employeeCode:x.employeeCode||'',fullName:x.fullName||'',role:linked?.role||x.role||'STAFF',areaId:linked?.areaId||x.areaId||null,areaName:linked?.areaName||x.areaName||''}});
  if(assignedStaff.length<2||assignedStaff.length>3||assignedStaff.length!==requestedIds.length)throw new Error('Mỗi ca phải chọn từ 2 đến 3 nhân sự đang hoạt động thuộc đúng cơ sở.');
  const primaryRecorder=assignedStaff.find(x=>x.id===String(body.primaryRecorderId||''));
  if(!primaryRecorder)throw new Error('Phải chọn một người ghi chính trong danh sách nhân sự trực ca.');
  const base={shiftDate:normalizeDateOnly(body.shiftDate||todayVN()),shiftType,branchId,branchName,areaId:body.areaId||null,areaName:body.areaName||'',roomId:body.roomId||null,autoCreated:auto};
  let shift=await createShiftFast(user,base,{branchName,assignedStaff,primaryRecorder});
  if(!shift){shift={id:uuid(),...base,status:'OPEN',assignedStaffIds:assignedStaff.map(x=>x.id),assignedStaff,assignedStaffNames:assignedStaff.map(x=>x.fullName),assignedStaffId:primaryRecorder.id,assignedStaffName:primaryRecorder.fullName,primaryRecorderId:primaryRecorder.id,primaryRecorderName:primaryRecorder.fullName,primaryRecorderCode:primaryRecorder.employeeCode,createdBy:user.sub,createdAt:new Date().toISOString()};await updateStore(store=>store.shifts.push(shift));}
  const residentCount=await loadRosterForShift(shift,{replace:true});
  await audit(user,auto?'SHIFT_AUTO_CREATE':'SHIFT_CREATE','shift',shift.id,{residentCount,areaId:shift.areaId,branchId:shift.branchId});
  return {...shift,residentCount};
}
router.get('/residents/:residentId/open-shift',async(req,res)=>{
  const s=await getStore();const roster=s.shiftResidents.filter(x=>x.residentId===req.params.residentId&&visibleByScope(req.user,x));const ids=new Set(roster.map(x=>x.shiftId));const shifts=s.shifts.filter(x=>ids.has(x.id)&&x.status==='OPEN'&&visibleByScope(req.user,x)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));res.json({success:true,data:shifts[0]||null});
});

router.post('/residents/:residentId/ensure-open-shift',allowRoles('ADMIN','CAREGIVER'),async(req,res)=>{
  const resident=req.body?.resident||{};
  if(!resident.id||resident.id!==req.params.residentId)return res.status(400).json({success:false,message:'Thiếu thông tin NCT.'});
  if(!visibleByScope(req.user,resident))return res.status(403).json({success:false,message:'NCT ngoài phạm vi được giao.'});
  const s=await getStore();
  const existingRoster=s.shiftResidents.filter(x=>x.residentId===resident.id);const ids=new Set(existingRoster.map(x=>x.shiftId));
  let shift=s.shifts.filter(x=>ids.has(x.id)&&x.status==='OPEN'&&visibleByScope(req.user,x)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if(!shift){
    shift=s.shifts.find(x=>x.status==='OPEN'&&x.shiftDate===todayVN()&&x.shiftType===currentShiftType()&&x.branchId===resident.branchId&&(!resident.areaId||x.areaId===resident.areaId));
  }
  if(!shift)return res.status(422).json({success:false,message:'Chưa có ca trực được Giám đốc cơ sở/Admin tạo, phân công tối thiểu 2 nhân sự và chọn người ghi chính.'});
  else{
    const inRoster=(await getStore()).shiftResidents.some(x=>x.shiftId===shift.id&&x.residentId===resident.id);
    if(!inRoster)await updateStore(store=>store.shiftResidents.push({id:uuid(),shiftId:shift.id,residentId:resident.id,code:resident.code||'',fullName:resident.fullName||'',branchId:resident.branchId,branchName:resident.branchName||shift.branchName,areaId:resident.areaId||null,areaName:resident.areaName||'',roomId:resident.roomId||null,roomName:resident.roomName||'',bedName:resident.bedName||'',image:resident.image||'',derivedStatus:'NO_RECORDED_CHANGE'}));
  }
  res.json({success:true,data:shift});
});

router.get('/dashboard',allowPermission('DASHBOARD.VIEW'),async(req,res)=>{
  const date=String(req.query.date||todayVN());
  const fast=await getDashboardBundleFast(req.user,date);
  const s=fast?{shifts:fast.shifts,shiftResidents:fast.residents,changeLogs:fast.changes,handovers:fast.handovers||[],toiletingLogs:fast.toilets}:await getStore();
  const shifts=s.shifts.filter(x=>String(x.shiftDate)===date&&visibleByScope(req.user,x));
  const ids=new Set(shifts.map(x=>x.id));
  const residents=s.shiftResidents.filter(x=>ids.has(x.shiftId)&&visibleByScope(req.user,x));
  const changes=(fast?s.changeLogs:s.changeLogs.filter(x=>!x.deleted&&visibleByScope(req.user,x)&&dateVN(x.occurredAt||x.createdAt)===date)).map(withAttention);
  const handovers=(s.handovers||[]).filter(x=>ids.has(x.shiftId));
  const allVisibleChanges=fast?fast.outstanding.map(withAttention):(await getStore()).changeLogs.filter(x=>!x.deleted&&visibleByScope(req.user,x)).map(withAttention);
  const outstanding=(fast?allVisibleChanges:allVisibleChanges.filter(x=>x.attentionLevel&&x.attentionStatus==='OPEN')).sort((a,b)=>(a.attentionLevel===b.attentionLevel?String(b.occurredAt||b.createdAt).localeCompare(String(a.occurredAt||a.createdAt)):a.attentionLevel==='RED'?-1:1));
  const byCategory=changes.reduce((a,x)=>(a[x.category]=(a[x.category]||0)+1,a),{});
  const shiftStatus=Object.entries(shifts.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{})).map(([status,count])=>({status,count}));
  const alerts=outstanding.slice(0,50).map(x=>({id:x.id,residentId:x.residentId,residentName:x.residentName,shiftId:x.shiftId,areaName:x.areaName||'',roomName:x.roomName||'',bedName:x.bedName||'',image:x.image||x.woundImages?.[0]?.dataUrl||'',level:x.attentionLevel,latestContent:x.content,latestAt:x.occurredAt||x.createdAt,requiresHandover:x.requiresHandover}));
  const activityResidents=new Set(changes.map(x=>x.residentId).filter(Boolean));
  res.json({success:true,data:{date,todayShifts:shifts.length,uniqueResidents:new Set([...residents.map(x=>x.residentId),...activityResidents]).size,changeLogs:changes.length,openRed:outstanding.filter(x=>x.attentionLevel==='RED').length,openYellow:outstanding.filter(x=>x.attentionLevel==='YELLOW').length,resolvedToday:changes.filter(x=>x.attentionLevel&&x.attentionStatus==='RESOLVED').length,requiresHandover:changes.filter(x=>x.requiresHandover).length,pendingReceive:handovers.filter(x=>x.confirmedAt&&!x.receivedAt).length,byCategory,shiftStatus,alerts}});
});
router.get('/shifts',allowPermission('SHIFT.VIEW'),async(req,res)=>{const fast=await getShiftsFast(req.user);if(fast)return res.json({success:true,data:fast});const s=await getStore();let rows=s.shifts.filter(x=>canAccessShift(req.user,x));rows=rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(x=>({...x,residentCount:shiftResidentCount(s,x.id)}));res.json({success:true,data:rows})});
router.get('/shifts/staff-options',allowPermission('SHIFT.CREATE','SHIFT.UPDATE'),async(req,res)=>{const requestedBranchId=String(req.query.branchId||''),branchId=req.user.role==='ADMIN'?requestedBranchId:String(req.user.branchId||'');if(!branchId)return res.status(400).json({success:false,message:'Thiếu cơ sở.'});const fast=await getStaffOptionsFast(branchId);if(fast!==null)return res.json({success:true,data:fast});const store=await getStore();const staff=(store.staffMembers||[]).filter(x=>x.active!==false&&!x.deleted&&String(x.branchId)===String(branchId)).map(x=>({id:x.id,userId:x.userId||null,username:x.username||'',employeeCode:x.employeeCode,fullName:x.fullName,role:x.role||'STAFF',areaId:x.areaId||null,areaName:x.areaName||''}));res.json({success:true,data:staff})});
router.post('/shifts',allowPermission('SHIFT.CREATE'),async(req,res)=>{try{res.status(201).json({success:true,data:await createShift(req.user,req.body||{})})}catch(e){res.status(400).json({success:false,message:e.message})}});
router.patch('/shifts/:id/staff',allowPermission('SHIFT.UPDATE'),async(req,res)=>{const s=await getStore(),shift=s.shifts.find(x=>x.id===req.params.id);if(!shift||!visibleByScope(req.user,shift))return res.status(404).json({success:false,message:'Không tìm thấy ca'});if(shift.status!=='OPEN')return res.status(422).json({success:false,message:'Ca đã ký bàn giao; không được đổi danh sách người trực đã dùng để đối chất.'});const requestedIds=[...new Set((Array.isArray(req.body?.assignedStaffIds)?req.body.assignedStaffIds:[]).map(String).filter(Boolean))];const users=await getUsers();const assignedStaff=(s.staffMembers||[]).filter(x=>requestedIds.includes(x.id)&&x.active!==false&&!x.deleted&&String(x.branchId)===String(shift.branchId)).map(x=>{const linked=users.find(u=>u.active&&u.branchId===shift.branchId&&String(u.employeeCode||'').toLowerCase()===String(x.employeeCode).toLowerCase());return{id:x.id,userId:linked?.id||x.userId||null,username:linked?.username||x.username||'',employeeCode:x.employeeCode,fullName:x.fullName,role:linked?.role||x.role||'STAFF',areaId:linked?.areaId||x.areaId||null,areaName:linked?.areaName||x.areaName||''}});if(assignedStaff.length<2||assignedStaff.length!==requestedIds.length)return res.status(422).json({success:false,message:'Mỗi ca phải chọn tối thiểu 2 nhân viên đang hoạt động trong danh sách cơ sở.'});const primaryRecorder=assignedStaff.find(x=>x.id===String(req.body?.primaryRecorderId||''));if(!primaryRecorder)return res.status(422).json({success:false,message:'Phải chọn một người ghi chính trong danh sách nhân sự trực ca.'});let updated={...shift,assignedStaffIds:assignedStaff.map(x=>x.id),assignedStaff,assignedStaffNames:assignedStaff.map(x=>x.fullName),assignedStaffId:primaryRecorder.id,assignedStaffName:primaryRecorder.fullName,primaryRecorderId:primaryRecorder.id,primaryRecorderName:primaryRecorder.fullName,primaryRecorderCode:primaryRecorder.employeeCode,staffUpdatedAt:new Date().toISOString(),staffUpdatedBy:req.user.sub};const fastUpdated=await updateShiftStaffFast(shift.id,req.user,{assignedStaff,primaryRecorder});if(!fastUpdated)await updateStore(store=>{const row=store.shifts.find(x=>x.id===shift.id);Object.assign(row,updated)});await audit(req.user,'SHIFT_STAFF_UPDATE','shift',shift.id,{assignedStaffIds:updated.assignedStaffIds,assignedStaffNames:updated.assignedStaffNames,primaryRecorderId:updated.primaryRecorderId});res.json({success:true,data:updated})});
router.post('/shifts/:id/refresh-roster',allowPermission('SHIFT.UPDATE'),async(req,res)=>{
  const fastRows=await getShiftsFast(req.user);let shift=fastRows?.find(x=>x.id===req.params.id);if(!fastRows){const s=await getStore();shift=s.shifts.find(x=>x.id===req.params.id&&visibleByScope(req.user,x));}
  if(!shift)return res.status(404).json({success:false,message:'Không tìm thấy ca'});if(shift.status!=='OPEN')return res.status(422).json({success:false,message:'Ca đã khóa/bàn giao nên không thể nạp lại roster.'});
  try{const residentCount=await loadRosterForShift(shift,{replace:true});await audit(req.user,'SHIFT_ROSTER_REFRESH','shift',shift.id,{residentCount});res.json({success:true,data:{residentCount}})}catch(e){res.status(502).json({success:false,message:`Không nạp được NCT từ BCARE: ${e.message}`})}
});
router.delete('/shifts/:id',allowPermission('SHIFT.DELETE'),async(req,res)=>{
  const fast=await deleteShiftFast(req.user,req.params.id);if(fast){if(fast.notFound)return res.status(404).json({success:false,message:'Không tìm thấy ca'});if(fast.blocked)return res.status(422).json({success:false,message:`Không thể xóa ca đã có dữ liệu (${fast.counts.changes} biến động, ${fast.counts.toileting} tiêu/tiểu, ${fast.counts.handovers} bàn giao). Chỉ Admin mới được xóa ca có dữ liệu.`});await audit(req.user,'SHIFT_DELETE','shift',req.params.id,{shiftDate:fast.shift.shiftDate,shiftType:fast.shift.shiftType,deletedByAdmin:req.user.role==='ADMIN',deletedRecords:fast.counts});return res.json({success:true,deletedRecords:fast.counts});}
  const s=await getStore(),shift=s.shifts.find(x=>x.id===req.params.id);if(!shift||!visibleByScope(req.user,shift))return res.status(404).json({success:false,message:'Không tìm thấy ca'});const changeCount=s.changeLogs.filter(x=>x.shiftId===shift.id).length,toiletCount=s.toiletingLogs.filter(x=>x.shiftId===shift.id).length,handoverCount=s.handovers.filter(x=>x.shiftId===shift.id).length;if((changeCount||toiletCount||handoverCount)&&req.user.role!=='ADMIN')return res.status(422).json({success:false,message:`Không thể xóa ca đã có dữ liệu (${changeCount} biến động, ${toiletCount} tiêu/tiểu, ${handoverCount} bàn giao). Chỉ Admin mới được xóa ca có dữ liệu.`});await updateStore(store=>{store.shifts=store.shifts.filter(x=>x.id!==shift.id);store.shiftResidents=store.shiftResidents.filter(x=>x.shiftId!==shift.id);if(req.user.role==='ADMIN'){store.changeLogs=store.changeLogs.filter(x=>x.shiftId!==shift.id);store.toiletingLogs=store.toiletingLogs.filter(x=>x.shiftId!==shift.id);store.handovers=store.handovers.filter(x=>x.shiftId!==shift.id)}});await audit(req.user,'SHIFT_DELETE','shift',shift.id,{shiftDate:shift.shiftDate,shiftType:shift.shiftType,deletedByAdmin:req.user.role==='ADMIN',deletedRecords:{changes:changeCount,toileting:toiletCount,handovers:handoverCount}});res.json({success:true,deletedRecords:{changes:changeCount,toileting:toiletCount,handovers:handoverCount}})});
router.get('/shifts/:id',allowPermission('SHIFT.VIEW'),async(req,res)=>{
  const fast=await getShiftDetailFast(req.user,req.params.id);if(fast){if(fast.notFound)return res.status(404).json({success:false,message:'Không tìm thấy ca hoặc bạn không thuộc ca trực này'});return res.json({success:true,data:fast});}
  const s=await getStore(),shift=s.shifts.find(x=>x.id===req.params.id);if(!shift||!canAccessShift(req.user,shift))return res.status(404).json({success:false,message:'Không tìm thấy ca hoặc bạn không thuộc ca trực này'});const residents=s.shiftResidents.filter(x=>x.shiftId===shift.id&&visibleByScope(req.user,x));const changes=s.changeLogs.filter(x=>x.shiftId===shift.id&&!x.deleted).map(withAttention);const toileting=s.toiletingLogs.filter(x=>x.shiftId===shift.id&&!x.deleted);const alertIds=new Set(changes.filter(x=>x.attentionLevel&&x.attentionStatus==='OPEN').map(x=>x.residentId));const alerts=residents.filter(x=>alertIds.has(x.residentId));res.json({success:true,data:{shift,residents,changes,toileting,alerts}});
});
router.post('/change-logs',allowPermission('CARE.CREATE'),async(req,res)=>{
  const b=req.body||{},s=await getStore(),shift=s.shifts.find(x=>x.id===b.shiftId);if(!shift||!canAccessShift(req.user,shift))return res.status(404).json({success:false,message:'Ca không hợp lệ hoặc bạn không thuộc ca trực'});const duplicate=b.clientRequestId&&s.changeLogs.find(x=>x.clientRequestId===b.clientRequestId&&x.createdBy===req.user.sub);if(duplicate)return res.json({success:true,data:withAttention(duplicate),duplicate:true});if(shift.status!=='OPEN')return res.status(422).json({success:false,message:'Ca đã ký bàn giao nên bị khóa. Chỉ Admin mới được sửa hoặc xóa bản ghi đã có; không được thêm mới.'});
  const inRoster=s.shiftResidents.some(x=>x.shiftId===shift.id&&x.residentId===b.residentId&&visibleByScope(req.user,x));if(!inRoster)return res.status(422).json({success:false,message:'NCT không thuộc roster ca này.'});
  if(!b.residentId||!b.category||!String(b.content||'').trim())return res.status(400).json({success:false,message:'Thiếu NCT, nhóm biến động hoặc nội dung'});if(b.requiresHandover&&!String(b.followUp||'').trim())return res.status(422).json({success:false,message:'Đã chọn cần bàn giao thì phải nhập việc ca sau cần biết/làm'});
  const occurredAt=b.occurredAt?new Date(b.occurredAt):new Date();if(Number.isNaN(occurredAt.getTime())||occurredAt.getTime()>Date.now()+5*60*1000)return res.status(422).json({success:false,message:'Thời điểm ghi nhận không hợp lệ hoặc đang ở tương lai.'});
  let vitals,woundImages;try{vitals=normalizeVitals(b.vitals);woundImages=sanitizeWoundImages(b.woundImages)}catch(e){return res.status(422).json({success:false,message:e.message})}
  const row={id:uuid(),clientRequestId:String(b.clientRequestId||''),shiftId:b.shiftId,residentId:b.residentId,residentName:b.residentName||'',category:b.category,eventType:b.eventType||'OBSERVATION',priority:vitals?.alertLevel==='RED'?'HIGH':(['LOW','MEDIUM','HIGH'].includes(b.priority)?b.priority:'MEDIUM'),occurredAt:occurredAt.toISOString(),content:String(b.content).trim(),intervention:b.intervention||'',notifiedTo:b.notifiedTo||'',vitals,woundImages,requiresHandover:!!b.requiresHandover,followUp:b.followUp||'',branchId:shift.branchId,branchName:shift.branchName||'',areaId:b.areaId||shift.areaId||null,areaName:b.areaName||'',roomName:b.roomName||'',bedName:b.bedName||'',image:b.image||'',createdBy:req.user.sub,createdByName:req.user.fullName,createdAt:new Date().toISOString(),deleted:false};row.attentionLevel=attentionLevel(row);row.attentionStatus=row.attentionLevel?'OPEN':null;
  await updateStore(store=>{store.changeLogs.unshift(row);const sr=store.shiftResidents.find(x=>x.shiftId===row.shiftId&&x.residentId===row.residentId);if(sr)sr.derivedStatus=row.requiresHandover?'REQUIRES_HANDOVER':'RECORDED_CHANGE'});await audit(req.user,'CHANGE_CREATE','change_log',row.id,{residentId:row.residentId,category:row.category,priority:row.priority});if(row.attentionLevel==='RED')void notifyUrgentCreated(row).then(result=>result.sent&&audit(req.user,'TELEGRAM_URGENT_SENT','change_log',row.id,{messageId:result.messageId})).catch(error=>console.error('Telegram urgent alert failed:',error.message));res.status(201).json({success:true,data:row});
});
router.patch('/change-logs/:id',allowPermission('CARE.UPDATE'),async(req,res)=>{
  const b=req.body||{};let found=null,shift=null,forbidden=false,locked=false;await updateStore(store=>{found=store.changeLogs.find(x=>x.id===req.params.id&&!x.deleted);if(!found)return;shift=store.shifts.find(x=>x.id===found.shiftId);if(!shift)return;if(!canAccessShift(req.user,shift)){forbidden=true;return}locked=shift.status!=='OPEN';if(locked&&req.user.role!=='ADMIN'){forbidden=true;return}if(locked&&!String(b.overrideReason||'').trim())return;if(req.user.role==='CAREGIVER'&&found.createdBy!==req.user.sub){forbidden=true;return}if(!visibleByScope(req.user,found)){forbidden=true;return}if(b.category)found.category=b.category;if(typeof b.content==='string'&&b.content.trim())found.content=b.content.trim();if(typeof b.requiresHandover==='boolean')found.requiresHandover=b.requiresHandover;if(typeof b.followUp==='string')found.followUp=b.followUp;if(Array.isArray(b.woundImages))found.woundImages=sanitizeWoundImages(b.woundImages);found.updatedBy=req.user.sub;found.updatedByName=req.user.fullName;found.updatedAt=new Date().toISOString();if(locked){found.adminOverrideReason=String(b.overrideReason).trim();found.adminOverriddenAt=found.updatedAt;found.adminOverriddenBy=req.user.sub}});
  if(!found)return res.status(404).json({success:false,message:'Không tìm thấy bản ghi'});if(!shift)return res.status(422).json({success:false,message:'Không tìm thấy ca của bản ghi'});if(forbidden)return res.status(403).json({success:false,message:locked?'Ca đã ký bàn giao; chỉ Admin được sửa bản ghi.':'Không có quyền sửa bản ghi này'});if(locked&&!String(b.overrideReason||'').trim())return res.status(422).json({success:false,message:'Admin phải nhập lý do khi sửa dữ liệu sau bàn giao.'});if(found.requiresHandover&&!String(found.followUp||'').trim())return res.status(422).json({success:false,message:'Cần nhập nội dung bàn giao'});await audit(req.user,locked?'CHANGE_ADMIN_OVERRIDE_UPDATE':'CHANGE_UPDATE','change_log',found.id,{residentId:found.residentId,overrideReason:locked?String(b.overrideReason).trim():undefined});res.json({success:true,data:found});
});
router.post('/change-logs/:id/resolve',allowPermission('CARE.UPDATE'),async(req,res)=>{
  const note=String(req.body?.note||'').trim();if(!note)return res.status(422).json({success:false,message:'Vui lòng ghi ngắn kết quả xử lý trước khi hoàn tất.'});
  let found=null,shift=null,forbidden=false,locked=false,alreadyResolved=false;await updateStore(store=>{found=store.changeLogs.find(x=>x.id===req.params.id&&!x.deleted);if(!found)return;shift=store.shifts.find(x=>x.id===found.shiftId);locked=shift?.status!=='OPEN';if(!shift||!canAccessShift(req.user,shift)||!visibleByScope(req.user,found)||(locked&&req.user.role!=='ADMIN')){forbidden=true;return}const level=attentionLevel(found);if(!level)return;if(found.attentionStatus==='RESOLVED'){alreadyResolved=true;return}found.attentionLevel=level;found.attentionStatus='RESOLVED';found.resolutionNote=note;found.resolvedBy=req.user.sub;found.resolvedByName=req.user.fullName;found.resolvedAt=new Date().toISOString();if(locked){found.adminOverrideReason=`Hoàn tất xử lý sau bàn giao: ${note}`;found.adminOverriddenAt=found.resolvedAt;found.adminOverriddenBy=req.user.sub}});
  if(!found)return res.status(404).json({success:false,message:'Không tìm thấy biến động'});if(forbidden)return res.status(403).json({success:false,message:locked?'Ca đã ký bàn giao; chỉ Admin được cập nhật kết quả xử lý.':'Biến động ngoài phạm vi được giao.'});if(!attentionLevel(found))return res.status(422).json({success:false,message:'Biến động này không thuộc danh sách cần xử lý.'});if(alreadyResolved)return res.json({success:true,data:withAttention(found),duplicate:true});await audit(req.user,locked?'CHANGE_ADMIN_OVERRIDE_RESOLVE':'CHANGE_RESOLVE','change_log',found.id,{residentId:found.residentId,note});if(found.attentionLevel==='RED')void notifyUrgentResolved(found).then(result=>result.sent&&audit(req.user,'TELEGRAM_URGENT_RESOLVED','change_log',found.id,{messageId:result.messageId})).catch(error=>console.error('Telegram resolved alert failed:',error.message));res.json({success:true,data:withAttention(found)});
});
router.post('/change-logs/:id/restore',allowPermission('CARE.DELETE'),async(req,res)=>{if(req.user.role!=='ADMIN')return res.status(403).json({success:false,message:'Chỉ Admin được khôi phục bản ghi.'});let found=null;await updateStore(store=>{found=store.changeLogs.find(x=>x.id===req.params.id);if(found){found.deleted=false;found.restoredBy=req.user.sub;found.restoredAt=new Date().toISOString()}});if(!found)return res.status(404).json({success:false,message:'Không tìm thấy bản ghi'});await audit(req.user,'CHANGE_RESTORE','change_log',found.id);res.json({success:true,data:found})});
router.delete('/change-logs/:id',allowPermission('CARE.DELETE'),async(req,res)=>{if(req.user.role!=='ADMIN')return res.status(403).json({success:false,message:'Chỉ Admin được xóa bản ghi chăm sóc.'});const reason=String(req.body?.reason||'').trim();if(!reason)return res.status(422).json({success:false,message:'Admin phải nhập lý do xóa để lưu audit.'});let found=null;await updateStore(store=>{found=store.changeLogs.find(x=>x.id===req.params.id);if(found){found.deleted=true;found.deletedAt=new Date().toISOString();found.deletedBy=req.user.sub;found.deleteReason=reason}});if(!found)return res.status(404).json({success:false,message:'Không tìm thấy bản ghi'});await audit(req.user,'CHANGE_SOFT_DELETE','change_log',found.id,{reason});res.json({success:true})});

router.post('/toileting-logs',allowPermission('CARE.CREATE'),async(req,res)=>{
  const b=req.body||{},s=await getStore(),shift=s.shifts.find(x=>x.id===b.shiftId);if(!shift||!canAccessShift(req.user,shift))return res.status(404).json({success:false,message:'Ca không hợp lệ hoặc bạn không thuộc ca trực'});const duplicate=b.clientRequestId&&s.toiletingLogs.find(x=>x.clientRequestId===b.clientRequestId&&x.createdBy===req.user.sub);if(duplicate)return res.json({success:true,data:duplicate,duplicate:true});if(shift.status!=='OPEN')return res.status(422).json({success:false,message:'Ca đã ký bàn giao nên bị khóa, không thể thêm ghi nhận.'});if(!b.residentId)return res.status(400).json({success:false,message:'Thiếu NCT'});if(!bowelStatuses.has(b.bowelStatus||'NORMAL'))return res.status(422).json({success:false,message:'Trạng thái tiêu không hợp lệ.'});if(!urineStatuses.has(b.urineStatus||'NORMAL'))return res.status(422).json({success:false,message:'Trạng thái tiểu không hợp lệ.'});if(b.urineStatus==='OTHER'&&!String(b.urineDetail||'').trim())return res.status(422).json({success:false,message:'Vui lòng mô tả tình trạng tiểu khi chọn Khác.'});const row={id:uuid(),clientRequestId:String(b.clientRequestId||''),shiftId:b.shiftId,residentId:b.residentId,residentName:b.residentName||'',bowelStatus:b.bowelStatus||'NORMAL',urineStatus:b.urineStatus||'NORMAL',urineDetail:b.urineStatus==='OTHER'?String(b.urineDetail||'').trim():'',note:String(b.note||'').trim(),branchId:shift.branchId,areaId:b.areaId||shift.areaId||null,areaName:b.areaName||'',roomName:b.roomName||'',bedName:b.bedName||'',image:b.image||'',createdBy:req.user.sub,createdByName:req.user.fullName,createdAt:new Date().toISOString(),deleted:false};await updateStore(store=>store.toiletingLogs.unshift(row));await audit(req.user,'TOILETING_CREATE','toileting_log',row.id,{residentId:row.residentId,urineStatus:row.urineStatus});res.status(201).json({success:true,data:row});
});

router.patch('/toileting-logs/:id',allowPermission('CARE.UPDATE'),async(req,res)=>{
  const b=req.body||{};let found=null,shift=null,forbidden=false,locked=false,missingOverride=false;
  await updateStore(store=>{
    found=store.toiletingLogs.find(x=>x.id===req.params.id&&!x.deleted);if(!found)return;
    shift=store.shifts.find(x=>x.id===found.shiftId);if(!shift||!canAccessShift(req.user,shift)||!visibleByScope(req.user,found)){forbidden=true;return}
    locked=shift.status!=='OPEN';
    if(locked&&req.user.role!=='ADMIN'){forbidden=true;return}
    if(locked&&!String(b.overrideReason||'').trim()){missingOverride=true;return}
    if(req.user.role==='CAREGIVER'&&found.createdBy!==req.user.sub){forbidden=true;return}
    const bowelStatus=b.bowelStatus||found.bowelStatus||'NORMAL';
    const urineStatus=b.urineStatus||found.urineStatus||'NORMAL';
    if(!bowelStatuses.has(bowelStatus)||!urineStatuses.has(urineStatus))return;
    if(urineStatus==='OTHER'&&!String(b.urineDetail||'').trim())return;
    found.bowelStatus=bowelStatus;found.urineStatus=urineStatus;found.urineDetail=urineStatus==='OTHER'?String(b.urineDetail||'').trim():'';
    if(typeof b.note==='string')found.note=b.note.trim();found.updatedBy=req.user.sub;found.updatedByName=req.user.fullName;found.updatedAt=new Date().toISOString();
    if(locked){found.adminOverrideReason=String(b.overrideReason).trim();found.adminOverriddenAt=found.updatedAt;found.adminOverriddenBy=req.user.sub}
  });
  if(!found)return res.status(404).json({success:false,message:'Không tìm thấy lịch sử tiêu/tiểu'});
  if(forbidden)return res.status(403).json({success:false,message:locked?'Ca đã ký bàn giao; chỉ Admin được sửa lịch sử tiêu/tiểu.':'Bạn không có quyền sửa bản ghi này.'});
  if(missingOverride)return res.status(422).json({success:false,message:'Admin phải nhập lý do khi sửa dữ liệu sau bàn giao.'});
  const bowelStatus=b.bowelStatus||found.bowelStatus,urineStatus=b.urineStatus||found.urineStatus;
  if(!bowelStatuses.has(bowelStatus)||!urineStatuses.has(urineStatus))return res.status(422).json({success:false,message:'Trạng thái tiêu/tiểu không hợp lệ.'});
  if(urineStatus==='OTHER'&&!String(b.urineDetail||'').trim())return res.status(422).json({success:false,message:'Vui lòng mô tả tình trạng tiểu khi chọn Khác.'});
  await audit(req.user,locked?'TOILETING_ADMIN_OVERRIDE_UPDATE':'TOILETING_UPDATE','toileting_log',found.id,{residentId:found.residentId,overrideReason:locked?String(b.overrideReason).trim():undefined});res.json({success:true,data:found});
});

router.delete('/toileting-logs/:id',allowPermission('CARE.DELETE'),async(req,res)=>{
  if(req.user.role!=='ADMIN')return res.status(403).json({success:false,message:'Chỉ Admin được xóa lịch sử tiêu/tiểu để giữ audit.'});
  const reason=String(req.body?.reason||'').trim();if(!reason)return res.status(422).json({success:false,message:'Admin phải nhập lý do xóa để lưu audit.'});
  let found=null;await updateStore(store=>{found=store.toiletingLogs.find(x=>x.id===req.params.id&&!x.deleted);if(found){found.deleted=true;found.deletedAt=new Date().toISOString();found.deletedBy=req.user.sub;found.deleteReason=reason}});
  if(!found)return res.status(404).json({success:false,message:'Không tìm thấy lịch sử tiêu/tiểu'});await audit(req.user,'TOILETING_SOFT_DELETE','toileting_log',found.id,{reason,residentId:found.residentId});res.json({success:true});
});

router.get('/shifts/:id/handover-preview',allowPermission('HANDOVER.VIEW','HANDOVER.SIGN','HANDOVER.RECEIVE'),async(req,res)=>{
  const s=await getStore(),shift=s.shifts.find(x=>x.id===req.params.id);if(!shift||!canAccessShift(req.user,shift))return res.status(404).json({success:false,message:'Không tìm thấy ca hoặc bạn không thuộc ca trực'});const residents=s.shiftResidents.filter(x=>x.shiftId===shift.id),changes=s.changeLogs.filter(x=>x.shiftId===shift.id&&!x.deleted).map(withAttention),toilets=s.toiletingLogs.filter(x=>x.shiftId===shift.id&&!x.deleted),changed=new Set(changes.map(x=>x.residentId)),handover=s.handovers.find(x=>x.shiftId===shift.id)||null,openAttention=changes.filter(x=>x.attentionLevel&&x.attentionStatus==='OPEN');res.json({success:true,data:{shift,handover,assignedStaff:shift.assignedStaff||[],summary:{totalResidents:residents.length,noRecordedChange:residents.length-changed.size,changed:changed.size,requiresHandover:changes.filter(x=>x.requiresHandover).length,openRed:openAttention.filter(x=>x.attentionLevel==='RED').length,openYellow:openAttention.filter(x=>x.attentionLevel==='YELLOW').length,toiletingAbnormal:toilets.filter(x=>x.bowelStatus!=='NORMAL'||x.urineStatus!=='NORMAL').length},changes,handoverItems:changes.filter(x=>x.requiresHandover||(x.attentionLevel&&x.attentionStatus==='OPEN')),toileting:toilets.filter(x=>x.bowelStatus!=='NORMAL'||x.urineStatus!=='NORMAL')}});
});
async function verifyPassword(user,password){const users=await getUsers();return users.some(x=>x.id===user.sub&&x.active&&x.password===password)}
router.post('/shifts/:id/handover/confirm',allowPermission('HANDOVER.SIGN'),async(req,res)=>{
  const s=await getStore(),shift=s.shifts.find(x=>x.id===req.params.id);if(!shift||!canAccessShift(req.user,shift))return res.status(404).json({success:false,message:'Không tìm thấy ca hoặc bạn không thuộc ca trực'});if(shift.status!=='OPEN')return res.status(422).json({success:false,message:'Ca không ở trạng thái OPEN để ký bàn giao.'});if(!req.body?.confirm)return res.status(422).json({success:false,message:'Chưa xác nhận đã rà soát ca.'});const assigned=Array.isArray(shift.assignedStaff)?shift.assignedStaff:[];if(assigned.length<2)return res.status(422).json({success:false,message:'Ca chưa đủ tối thiểu 2 nhân sự nên không được ký bàn giao.'});const selectedIds=[...new Set((Array.isArray(req.body?.participantIds)?req.body.participantIds:[]).map(String))];const assignedIds=assigned.map(x=>x.id);if(selectedIds.length!==assignedIds.length||assignedIds.some(id=>!selectedIds.includes(id)))return res.status(422).json({success:false,message:'Phải tick xác nhận đầy đủ tất cả nhân sự đã được phân công trong ca.'});let handover;const confirmedAt=new Date().toISOString();await updateStore(store=>{const storedShift=store.shifts.find(x=>x.id===shift.id);if(!storedShift)throw new Error('Ca không còn tồn tại.');handover=store.handovers.find(x=>x.shiftId===shift.id);if(!handover){handover={id:uuid(),shiftId:shift.id,branchId:shift.branchId,version:1};store.handovers.push(handover)}handover.summaryNote=req.body?.note||'';handover.confirmedBy=req.user.sub;handover.confirmedByName=req.user.fullName;handover.confirmedAt=confirmedAt;handover.participants=assigned.map(x=>({userId:x.id,username:x.username,employeeCode:x.employeeCode||x.username,fullName:x.fullName,acknowledged:true,acknowledgedAt:confirmedAt,recordedBy:req.user.sub}));storedShift.status='HANDOVER_CONFIRMED';storedShift.lockedAt=confirmedAt;storedShift.lockedBy=req.user.sub});await audit(req.user,'HANDOVER_CONFIRM','handover',handover.id,{participantIds:selectedIds,participantNames:assigned.map(x=>x.fullName)});res.json({success:true,data:handover});
});
router.post('/shifts/:id/handover/receive',allowPermission('HANDOVER.RECEIVE'),async(req,res)=>{
  const s=await getStore(),shift=s.shifts.find(x=>x.id===req.params.id);if(!shift||!canAccessShift(req.user,shift))return res.status(404).json({success:false,message:'Không tìm thấy ca hoặc bạn không thuộc ca trực'});const existing=s.handovers.find(x=>x.shiftId===shift.id);if(!existing?.confirmedAt)return res.status(422).json({success:false,message:'Ca chưa được ký bàn giao'});if(!req.body?.confirm)return res.status(422).json({success:false,message:'Chưa xác nhận đã nhận bàn giao.'});if(!await verifyPassword(req.user,req.body?.password||''))return res.status(401).json({success:false,message:'Mật khẩu xác nhận không đúng.'});let handover;await updateStore(store=>{const storedShift=store.shifts.find(x=>x.id===shift.id);if(!storedShift)throw new Error('Ca không còn tồn tại.');handover=store.handovers.find(x=>x.shiftId===shift.id);handover.receivedBy=req.user.sub;handover.receivedByName=req.user.fullName;handover.receivedAt=new Date().toISOString();storedShift.status='RECEIVED'});await audit(req.user,'HANDOVER_RECEIVE','handover',handover.id);res.json({success:true,data:handover});
});
router.post('/shifts/:id/close',allowPermission('SHIFT.UPDATE'),async(req,res)=>{let shift;await updateStore(store=>{shift=store.shifts.find(x=>x.id===req.params.id);if(shift&&visibleByScope(req.user,shift))shift.status='CLOSED'});if(!shift)return res.status(404).json({success:false,message:'Không tìm thấy ca'});await audit(req.user,'SHIFT_CLOSE','shift',shift.id);res.json({success:true,data:shift})});

router.get('/reports',allowPermission('REPORT.VIEW'),async(req,res)=>{
  const range=reportRange(req.query),branchId=req.user.role==='ADMIN'?String(req.query.branchId||''):String(req.user.branchId||'');
  const fast=await getReportBundleFast(req.user,{from:range.from,to:range.to,branchId});
  const base=fast?{shifts:fast.shifts,shiftResidents:fast.residents,changeLogs:fast.changes,toiletingLogs:fast.toilets,outstanding:fast.outstanding}:await getStore();
  const shifts=base.shifts.filter(x=>range.inRange(x.shiftDate)&&(!branchId||String(x.branchId)===branchId)&&visibleByScope(req.user,x));
  const ids=new Set(shifts.map(x=>x.id));
  const residents=base.shiftResidents.filter(x=>ids.has(x.shiftId)&&visibleByScope(req.user,x));
  const changes=(fast?base.changeLogs:base.changeLogs.filter(x=>!x.deleted&&inEventRange(x.occurredAt||x.createdAt,range)&&(!branchId||String(x.branchId)===branchId)&&visibleByScope(req.user,x))).map(withAttention);
  const toilets=fast?base.toiletingLogs:base.toiletingLogs.filter(x=>!x.deleted&&inEventRange(x.createdAt,range)&&(!branchId||String(x.branchId)===branchId)&&visibleByScope(req.user,x));
  const outstanding=(fast?base.outstanding.map(withAttention):(await getStore()).changeLogs.filter(x=>!x.deleted&&(!branchId||String(x.branchId)===branchId)&&visibleByScope(req.user,x)).map(withAttention).filter(x=>x.attentionLevel&&x.attentionStatus==='OPEN')).sort((a,b)=>(a.attentionLevel===b.attentionLevel?String(b.occurredAt||b.createdAt).localeCompare(String(a.occurredAt||a.createdAt)):a.attentionLevel==='RED'?-1:1));
  const byCategory=changes.reduce((a,x)=>(a[x.category]=(a[x.category]||0)+1,a),{}),byArea=changes.reduce((a,x)=>(a[x.areaName||'Chưa xác định']=(a[x.areaName||'Chưa xác định']||0)+1,a),{});
  const attentionInRange=changes.filter(isAttentionChange),resolvedInRange=attentionInRange.filter(x=>x.attentionStatus==='RESOLVED');
  const shiftDetails=shifts.map(x=>({id:x.id,shiftDate:x.shiftDate,shiftType:x.shiftType,status:x.status,branchId:x.branchId,branchName:x.branchName,areaName:x.areaName,residentCount:residents.filter(r=>r.shiftId===x.id).length,changeCount:changes.filter(c=>c.shiftId===x.id).length,handoverCount:changes.filter(c=>c.shiftId===x.id&&c.requiresHandover).length,assignedStaff:(x.assignedStaff||[]).map(p=>({id:p.id,employeeCode:p.employeeCode,fullName:p.fullName})),primaryRecorderName:x.primaryRecorderName||x.assignedStaffName||''}));
  const residentMap=new Map();
  // Báo cáo biến động chỉ tạo NCT khi NCT có phát sinh biến động hoặc tiêu/tiểu trong kỳ; không đổ toàn bộ roster vào báo cáo.
  for(const c of changes){const key=String(c.residentId);const row=residentMap.get(key)||{residentId:key,residentName:c.residentName||'NCT',branchId:c.branchId||'',branchName:c.branchName||'',areaName:c.areaName||'',roomName:c.roomName||'',bedName:c.bedName||'',changeCount:0,redOpen:0,yellowOpen:0,resolvedCount:0,handoverCount:0,toiletingAbnormal:0,lastEventAt:null,lastContent:'',latestVitals:null,images:[]};row.changeCount++;if(c.attentionLevel==='RED'&&c.attentionStatus==='OPEN')row.redOpen++;if(c.attentionLevel==='YELLOW'&&c.attentionStatus==='OPEN')row.yellowOpen++;if(c.attentionStatus==='RESOLVED')row.resolvedCount++;if(c.requiresHandover)row.handoverCount++;const at=c.occurredAt||c.createdAt;if(!row.lastEventAt||String(at)>String(row.lastEventAt)){row.lastEventAt=at;row.lastContent=c.content||'';row.latestVitals=c.vitals||null}const imgs=(c.woundImages||[]).map(x=>x?.dataUrl||x?.image||x).filter(Boolean);row.images.push(...imgs.slice(0,2));residentMap.set(key,row)}
  for(const t of toilets){const key=String(t.residentId);const row=residentMap.get(key)||{residentId:key,residentName:t.residentName||'NCT',branchId:t.branchId||'',branchName:t.branchName||'',areaName:t.areaName||'',roomName:t.roomName||'',bedName:t.bedName||'',changeCount:0,redOpen:0,yellowOpen:0,resolvedCount:0,handoverCount:0,toiletingAbnormal:0,lastEventAt:null,lastContent:'',latestVitals:null,images:[]};if(t.bowelStatus!=='NORMAL'||t.urineStatus!=='NORMAL')row.toiletingAbnormal++;residentMap.set(key,row)}
  const branchMap=new Map();
  const ensureBranch=(id,name)=>{const key=String(id||'UNKNOWN');if(!branchMap.has(key))branchMap.set(key,{branchId:key,branchName:name||'Chưa xác định',shifts:0,residentIds:new Set(),changes:0,redOpen:0,yellowOpen:0});return branchMap.get(key)};
  for(const sh of shifts){const row=ensureBranch(sh.branchId,sh.branchName);row.shifts++}
  for(const c of changes){const row=ensureBranch(c.branchId,c.branchName);row.changes++;row.residentIds.add(String(c.residentId));if(c.attentionLevel==='RED'&&c.attentionStatus==='OPEN')row.redOpen++;if(c.attentionLevel==='YELLOW'&&c.attentionStatus==='OPEN')row.yellowOpen++}
  for(const t of toilets){const row=ensureBranch(t.branchId,t.branchName);row.residentIds.add(String(t.residentId))}
  const branchSummaries=[...branchMap.values()].map(x=>({branchId:x.branchId,branchName:x.branchName,shifts:x.shifts,residents:x.residentIds.size,changes:x.changes,redOpen:x.redOpen,yellowOpen:x.yellowOpen})).sort((a,b)=>String(a.branchName).localeCompare(String(b.branchName),'vi'));
  const residentSummaries=[...residentMap.values()].sort((a,b)=>(b.redOpen-a.redOpen)||(b.yellowOpen-a.yellowOpen)||(b.changeCount-a.changeCount)||String(a.residentName).localeCompare(String(b.residentName),'vi'));
  res.json({success:true,data:{from:range.from,to:range.to,branchId,shifts:shifts.length,uniqueResidents:residentSummaries.length,changes:changes.length,openRed:outstanding.filter(x=>x.attentionLevel==='RED').length,openYellow:outstanding.filter(x=>x.attentionLevel==='YELLOW').length,resolvedToday:resolvedInRange.length,resolutionRate:attentionInRange.length?Math.round(resolvedInRange.length*100/attentionInRange.length):100,requiresHandover:changes.filter(x=>x.requiresHandover).length,toiletingLogs:toilets.length,toiletingAbnormal:toilets.filter(x=>x.bowelStatus!=='NORMAL'||x.urineStatus!=='NORMAL').length,byCategory,byArea,branchSummaries,shiftDetails,residentSummaries,outstanding,details:[...changes].sort((a,b)=>String(b.occurredAt||b.createdAt).localeCompare(String(a.occurredAt||a.createdAt))),toiletingDetails:[...toilets].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))}});
});
router.get('/reports/staff',allowPermission('REPORT.VIEW'),async(req,res)=>{
  const range=reportRange(req.query),branchId=req.user.role==='ADMIN'?String(req.query.branchId||''):String(req.user.branchId||'');
  const fast=await getStaffReportBundleFast(req.user,{from:range.from,to:range.to,branchId});
  const store=fast?null:await getStore();
  const shifts=(fast?fast.shifts:store.shifts.filter(x=>range.inRange(x.shiftDate)&&(!branchId||String(x.branchId)===branchId)&&visibleByScope(req.user,x)));
  const changes=(fast?fast.changes:store.changeLogs.filter(x=>!x.deleted&&inEventRange(x.occurredAt||x.createdAt,range)&&(!branchId||String(x.branchId)===branchId)&&visibleByScope(req.user,x))).map(withAttention);
  const handovers=fast?fast.handovers:store.handovers.filter(x=>shifts.some(s=>s.id===x.shiftId));
  const directory=fast?fast.staffDirectory:(store.staffMembers||[]).filter(x=>x.active!==false&&!x.deleted&&(!branchId||String(x.branchId)===branchId));
  const byId=new Map();
  const ensurePerson=(person,branchName='')=>{const key=String(person.id||person.userId||person.employeeCode||person.fullName);if(!byId.has(key))byId.set(key,{id:key,userId:person.userId||null,employeeCode:person.employeeCode||'',fullName:person.fullName||person.username||'Nhân viên',branchName:branchName||person.branchName||'',shiftCount:0,primaryCount:0,changeCount:0,redCount:0,openCount:0,shiftIds:[],shifts:[]});return byId.get(key)};
  const calendar=shifts.map(shift=>({id:shift.id,shiftDate:shift.shiftDate,shiftType:shift.shiftType,status:shift.status,branchId:shift.branchId,branchName:shift.branchName||'',areaName:shift.areaName||'Toàn cơ sở',handover:!!handovers.find(h=>h.shiftId===shift.id&&h.confirmedAt),primaryRecorderId:shift.primaryRecorderId||shift.assignedStaffId||'',primaryRecorderName:shift.primaryRecorderName||shift.assignedStaffName||'',staff:(shift.assignedStaff||[]).map(p=>({id:p.id,userId:p.userId||null,employeeCode:p.employeeCode||'',fullName:p.fullName||'',isPrimary:String(p.id)===String(shift.primaryRecorderId||shift.assignedStaffId||'')}))}));
  for(const shift of shifts){for(const person of (shift.assignedStaff||[])){const row=ensurePerson(person,shift.branchName||'');row.shiftCount++;if(String(person.id)===String(shift.primaryRecorderId))row.primaryCount++;row.shiftIds.push(shift.id);row.shifts.push({id:shift.id,shiftDate:shift.shiftDate,shiftType:shift.shiftType,status:shift.status,areaName:shift.areaName||'Toàn cơ sở',branchName:shift.branchName||'',handover:!!handovers.find(h=>h.shiftId===shift.id&&h.confirmedAt),staff:(shift.assignedStaff||[]).map(p=>({id:p.id,employeeCode:p.employeeCode||'',fullName:p.fullName||''}))})}}
  for(const c of changes){const person=directory.find(p=>String(p.userId||'')===String(c.createdBy||'')||String(p.id||'')===String(c.createdBy||''));if(!person)continue;const row=ensurePerson(person,person.branchName||'');row.changeCount++;if(attentionLevel(c)==='RED')row.redCount++;if(attentionStatus(c)==='OPEN')row.openCount++}
  const staffDetails=[...byId.values()].filter(x=>x.shiftCount||x.changeCount).sort((a,b)=>String(a.fullName).localeCompare(String(b.fullName),'vi'));
  res.json({success:true,data:{from:range.from,to:range.to,branchId,calendar,staffDetails,activityChanges:changes.length}});
});
router.get('/reports/resident/:residentId',allowPermission('REPORT.VIEW'),async(req,res)=>{
  const range=reportRange(req.query),residentId=String(req.params.residentId),branchId=req.user.role==='ADMIN'?String(req.query.branchId||''):String(req.user.branchId||'');
  const fast=await getReportBundleFast(req.user,{from:range.from,to:range.to,branchId});
  const s=fast?{shiftResidents:fast.residents,changeLogs:fast.changes,toiletingLogs:fast.toilets}:await getStore();
  const changes=(fast?s.changeLogs:s.changeLogs.filter(x=>!x.deleted&&inEventRange(x.occurredAt||x.createdAt,range)&&(!branchId||String(x.branchId)===branchId)&&visibleByScope(req.user,x))).filter(x=>String(x.residentId)===residentId).map(withAttention).sort((a,b)=>String(b.occurredAt||b.createdAt).localeCompare(String(a.occurredAt||a.createdAt)));
  const toileting=(fast?s.toiletingLogs:s.toiletingLogs.filter(x=>!x.deleted&&inEventRange(x.createdAt,range)&&(!branchId||String(x.branchId)===branchId)&&visibleByScope(req.user,x))).filter(x=>String(x.residentId)===residentId).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const roster=(s.shiftResidents||[]).filter(x=>String(x.residentId)===residentId);
  const base=changes[0]||toileting[0]||roster[0];
  if(!base)return res.status(404).json({success:false,message:'Không có dữ liệu NCT trong khoảng đã chọn'});
  res.json({success:true,data:{from:range.from,to:range.to,resident:{id:residentId,name:base.residentName||base.fullName||'NCT',areaName:base.areaName||'',roomName:base.roomName||'',bedName:base.bedName||''},summary:{changes:changes.length,openRed:changes.filter(x=>x.attentionLevel==='RED'&&x.attentionStatus==='OPEN').length,openYellow:changes.filter(x=>x.attentionLevel==='YELLOW'&&x.attentionStatus==='OPEN').length,resolved:changes.filter(x=>x.attentionStatus==='RESOLVED').length,handover:changes.filter(x=>x.requiresHandover).length,toiletingAbnormal:toileting.filter(x=>x.bowelStatus!=='NORMAL'||x.urineStatus!=='NORMAL').length},changes,toileting}});
});
router.get('/audit-logs',allowPermission('AUDIT.VIEW'),async(req,res)=>{const s=await getStore();let rows=s.auditLogs;if(req.user.role!=='ADMIN')rows=rows.filter(x=>!x.branchId||x.branchId===req.user.branchId);res.json({success:true,data:rows.slice(0,300)})});

export default router;
