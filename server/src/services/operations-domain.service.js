import { randomUUID } from 'node:crypto';
import { hasPermission } from '../config/permissions.js';
export const TZ='Asia/Ho_Chi_Minh';
export const nowISO=()=>new Date().toISOString();
export function fail(message,status=422){throw Object.assign(new Error(message),{status})}
export const dayVN=value=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export function dateOnly(value){const text=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(new Date(`${text}T00:00:00Z`).getTime())||new Date(`${text}T00:00:00Z`).toISOString().slice(0,10)!==text)fail('Ngày không hợp lệ.');return text}
export function instant(value){const d=new Date(value);if(!value||Number.isNaN(d.getTime()))fail('Thời điểm không hợp lệ.');return d.toISOString()}
export const plusDays=(date,n)=>new Date(new Date(`${date}T00:00:00Z`).getTime()+n*86400000).toISOString().slice(0,10);
export function periodFilter(q={},asOf=nowISO()){
  const period=q.period||'day';let from,to;const anchor=dateOnly(q.date||q.from||dayVN(asOf));
  if(period==='day')from=to=anchor;
  else if(period==='week'){const d=new Date(`${anchor}T00:00:00Z`);from=plusDays(anchor,-((d.getUTCDay()+6)%7));to=plusDays(from,6)}
  else if(period==='month'){from=anchor.slice(0,7)+'-01';to=new Date(Date.UTC(Number(anchor.slice(0,4)),Number(anchor.slice(5,7)),0)).toISOString().slice(0,10)}
  else if(period==='custom'){from=dateOnly(q.from);to=dateOnly(q.to);if(from>to)fail('Từ ngày phải nhỏ hơn hoặc bằng đến ngày.')}
  else fail('Kỳ báo cáo không hợp lệ.');
  if((new Date(`${to}T00:00:00Z`)-new Date(`${from}T00:00:00Z`))/86400000>365)fail('Màn hình hỗ trợ tối đa 366 ngày một lần; chọn khoảng nhỏ hơn.',413);
  const timeBasis=q.timeBasis||'businessDate';if(!['businessDate','occurredAt','savedAt'].includes(timeBasis))fail('Cơ sở thời gian không hợp lệ.');
  const groupBy=q.groupBy||'zone';if(!['zone','floor','day','staff','resident'].includes(groupBy))fail('Nhóm báo cáo không hợp lệ.');
  const attribution=q.attribution||'performer';if(!['performer','enteredBy','coPerformer'].includes(attribution))fail('Vai trò hoạt động không hợp lệ.');
  return {period,from,to,timeBasis,groupBy,attribution,branchId:String(q.branchId||''),zoneId:String(q.zoneId||''),floorId:String(q.floorId||''),staffId:String(q.staffId||''),shiftType:String(q.shiftType||''),startInclusive:instant(`${from}T00:00:00+07:00`),endExclusive:instant(`${plusDays(to,1)}T00:00:00+07:00`),locationMode:q.locationMode||'responsibleScope'};
}
export function grants(user,at=nowISO()){
  const explicit=Array.isArray(user.userScopes)?user.userScopes:[];
  if(explicit.length)return explicit.filter(g=>(!g.validFrom||g.validFrom<=at)&&(!g.validTo||at<g.validTo));
  return user.branchId?[{branchId:user.branchId,zoneId:user.areaId||null}]:[];
}
export function visible(user,row,at=nowISO()){
  if(user.role==='ADMIN')return true;
  return grants(user,at).some(g=>String(g.branchId)===String(row.branchId)&&(!g.zoneId||String(g.zoneId)===String(row.zoneId||row.areaId))&&(!g.floorId||String(g.floorId)===String(row.floorId))&&(!g.residentId||String(g.residentId)===String(row.residentId||row.id)));
}
export function containerVisible(user,row){if(user.role==='ADMIN')return true;return grants(user).some(g=>String(g.branchId)===String(row.branchId)&&(!row.zoneId||!g.zoneId||String(g.zoneId)===String(row.zoneId))&&(!row.floorId||!g.floorId||String(g.floorId)===String(row.floorId)))}
export function requirePermission(user,permission){if(!hasPermission(user,permission))fail('Không có quyền thực hiện chức năng này.',403)}
export function assertVisible(user,row){if(!row||!visible(user,row))fail('Đối tượng ngoài phạm vi được cấp.',403)}
export function getRow(state,kind,id){const row=state[kind].find(r=>String(r.id)===String(id));if(!row)fail('Không tìm thấy đối tượng.',404);return row}
export function auditV2(state,user,action,row,detail={}){state.audits.push({id:randomUUID(),branchId:row.branchId,zoneId:row.zoneId||null,scopeId:row.scopeId||null,residentId:row.residentId||null,action,targetId:row.id,userId:user.sub,at:nowISO(),detail})}
export function requireCurrentCareScope(user,scope){if(user.role==='CARE_SHARED'&&!(scope.startsAt<=nowISO()&&nowISO()<scope.endsAt))fail('Chăm sóc viên chỉ ghi trong ca hiện hành đang mở.',423)}
function scopeRow(state,user,id,open=false){const scope=getRow(state,'scopes',id);if(!containerVisible(user,scope))fail('Phạm vi khu chưa được cấp.',403);if(open&&scope.status!=='OPEN')fail('Khu đã bàn giao và khóa ghi nhận.',423);if(open)requireCurrentCareScope(user,scope);return scope}
export function touch(state,scopeId){const row=getRow(state,'scopes',scopeId);row.dataVersion++;row.updatedAt=nowISO()}
function localShiftHours(date,config){const start=instant(`${date}T${config.startTime}:00+07:00`);const endDate=config.endTime<=config.startTime?plusDays(date,1):date;return{startsAt:start,endsAt:instant(`${endDate}T${config.endTime}:00+07:00`)}}
function validateLocation(state,row){if(row.zoneId)getRow(state,'zones',row.zoneId);if(row.floorId){const f=getRow(state,'floors',row.floorId);if(f.zoneId!==row.zoneId)fail('Tầng không thuộc khu.')}if(row.roomId){const r=getRow(state,'rooms',row.roomId);if(r.zoneId!==row.zoneId||(r.floorId||null)!==(row.floorId||null))fail('Phòng không thuộc tuyến khu/tầng.')}}
export function locationAt(state,residentId,at){return state.locations.find(x=>x.residentId===residentId&&x.validFrom<=at&&(!x.validTo||at<x.validTo))||null}
export function configureOrg(state,user,branchId,kind,b){
  requirePermission(user,'SYSTEM.UPDATE');if(!['zones','floors','rooms','schedules'].includes(kind))fail('Danh mục không hợp lệ.');
  const existing=b.id?getRow(state,kind,b.id):null;const row={...(existing||{}),id:existing?.id||randomUUID(),branchId,name:String(b.name??existing?.name??'').trim(),zoneId:b.zoneId??existing?.zoneId??null,floorId:b.floorId??existing?.floorId??null,active:b.active??existing?.active??true,updatedAt:nowISO()};
  if(kind==='zones'){row.zoneId=row.id;row.isDefault=!!b.isDefault;if(row.isDefault&&state.zones.some(z=>z.id!==row.id&&z.active&&z.isDefault))fail('Cơ sở chỉ có một scope mặc định.');if(!row.name)fail('Tên khu bắt buộc.')}
  if(kind==='floors'||kind==='rooms'){if(!row.zoneId)fail('Phải chọn khu.');validateLocation(state,{...row,roomId:null,floorId:kind==='floors'?null:row.floorId});if(!row.name)fail('Tên bắt buộc.')}
  if(kind==='schedules'){
    Object.assign(row,{shiftType:b.shiftType,startTime:b.startTime,endTime:b.endTime,minimumStaff:Number(b.minimumStaff??0),required:b.required!==false});
    if(!['MORNING','AFTERNOON','NIGHT'].includes(row.shiftType)||![row.startTime,row.endTime].every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t||''))||!Number.isInteger(row.minimumStaff)||row.minimumStaff<0)fail('Lịch ca/giờ/số nhân sự không hợp lệ.');
    if(state.schedules.some(x=>x.id!==row.id&&x.active&&x.zoneId===row.zoneId&&x.shiftType===row.shiftType))fail('Lịch khu/loại ca đã tồn tại.');getRow(state,'zones',row.zoneId);
  }
  if(existing&&['floors','rooms'].includes(kind)&&((existing.zoneId||null)!==(row.zoneId||null)||(existing.floorId||null)!==(row.floorId||null)))fail('Không đổi tuyến cha của danh mục đã tạo; dùng danh mục mới và chuyển vị trí.');
  assertVisible(user,row);if(existing)Object.assign(existing,row);else state[kind].push(row);auditV2(state,user,'ORG_SAVE',row,{kind});return row;
}
export function ensureShift(state,user,branchId,b){
  requirePermission(user,'SHIFT.CREATE');const businessDate=dateOnly(b.businessDate);if(user.role==='CARE_SHARED'&&businessDate!==dayVN(nowISO())&&businessDate!==plusDays(dayVN(nowISO()),-1))fail('Chăm sóc viên chỉ vào ca hiện hành.',423);if(!['MORNING','AFTERNOON','NIGHT'].includes(b.shiftType))fail('Loại ca không hợp lệ.');
  const calendars=state.schedules.filter(x=>x.active&&x.shiftType===b.shiftType&&containerVisible(user,x)&&state.zones.some(z=>z.id===x.zoneId&&z.active));if(!calendars.length)fail('Cần cấu hình lịch ca theo khu trước khi tạo ca.');if(user.role==='CARE_SHARED'&&!calendars.some(c=>{const h=localShiftHours(businessDate,c);return h.startsAt<=nowISO()&&nowISO()<h.endsAt}))fail('Ca chưa bắt đầu hoặc đã kết thúc.',423);
  let shift=state.shifts.find(x=>x.businessDate===businessDate&&x.shiftType===b.shiftType);
  if(!shift){shift={id:randomUUID(),branchId,businessDate,shiftType:b.shiftType,status:'OPEN',createdAt:nowISO()};state.shifts.push(shift)}
  for(const config of calendars)if(!state.scopes.some(x=>x.shiftId===shift.id&&x.zoneId===config.zoneId)){
    const zone=getRow(state,'zones',config.zoneId);state.scopes.push({id:randomUUID(),branchId,shiftId:shift.id,businessDate,shiftType:b.shiftType,zoneId:zone.id,zoneName:zone.name,status:'OPEN',dataVersion:1,minimumStaff:config.minimumStaff,required:config.required,...localShiftHours(businessDate,config)});
  }
  auditV2(state,user,'SHIFT_ENSURE',shift);return shift;
}
export function saveAssignment(state,user,branchId,b,staff){
  requirePermission(user,'SHIFT.UPDATE');const scope=scopeRow(state,user,b.scopeId,true),person=staff.find(x=>x.id===b.staffId&&x.branchId===branchId&&x.active!==false&&!x.deleted);if(!person)fail('Nhân sự không hoạt động hoặc không thuộc cơ sở.');
  const startsAt=instant(b.startsAt||scope.startsAt),endsAt=instant(b.endsAt||scope.endsAt);if(startsAt>=endsAt||startsAt<scope.startsAt||endsAt>scope.endsAt)fail('Khoảng phân công phải nằm trong ca.');
  const floorId=b.floorId||null;if(floorId&&getRow(state,'floors',floorId).zoneId!==scope.zoneId)fail('Tầng không thuộc khu trực.');
  const residentIds=[...new Set(b.residentIds||[])];for(const id of residentIds){const r=getRow(state,'residents',id);if(r.zoneId!==scope.zoneId)fail('NCT không thuộc khu phân công.')}
  const role=b.function||'DUTY';if(!['LEAD','RECORDER','DUTY','SUPPORT'].includes(role))fail('Chức năng không hợp lệ.');
  const row={id:randomUUID(),branchId,shiftId:scope.shiftId,scopeId:scope.id,zoneId:scope.zoneId,zoneName:scope.zoneName,floorId,residentIds,staffId:person.id,staffName:person.fullName,employeeCode:person.employeeCode,homeZoneId:person.areaId||null,homeZoneName:person.areaName||'',linkedUserId:person.userId||null,function:role,startsAt,endsAt,status:'PLANNED',source:'ASSIGNMENT',version:1};
  assertVisible(user,row);state.assignments.push(row);touch(state,scope.id);auditV2(state,user,'ASSIGNMENT_CREATE',row);return row;
}
export function updateAssignment(state,user,id,b){
  requirePermission(user,'SHIFT.UPDATE');const row=getRow(state,'assignments',id);scopeRow(state,user,row.scopeId,true);assertVisible(user,row);if(Number(b.expectedVersion)!==row.version)fail('Phân công đã thay đổi.',409);
  if(b.endsAt){const end=instant(b.endsAt);if(end<=row.startsAt||end>getRow(state,'scopes',row.scopeId).endsAt)fail('Khoảng kết thúc không hợp lệ.');row.endsAt=end}
  if(b.status){if(!['PLANNED','PRESENT','ABSENT','REPLACED','CANCELLED'].includes(b.status))fail('Trạng thái phân công không hợp lệ.');row.status=b.status;row.presenceSource=['PRESENT','ABSENT'].includes(b.status)?'MANUAL_CONFIRMATION':null;row.presenceConfirmedBy=user.sub;row.presenceConfirmedAt=nowISO()}
  if(!String(b.reason||'').trim())fail('Cần lý do điều chỉnh.');row.version++;touch(state,row.scopeId);auditV2(state,user,'ASSIGNMENT_UPDATE',row,{reason:b.reason});return row;
}
export function syncResidents(state,user,branchId,items){
  requirePermission(user,'SYSTEM.UPDATE');const at=nowISO();let count=0;
  for(const source of items){if(String(source.branchId)!==branchId)continue;const zoneId=source.areaId||state.zones.find(z=>z.isDefault&&z.active)?.id||null;
    if(zoneId&&!state.zones.some(z=>z.id===zoneId))state.zones.push({id:zoneId,zoneId,branchId,name:source.areaName||'Chưa xác định',active:true,source:'BCARE'});
    const candidate={branchId,zoneId,floorId:null,residentId:String(source.id)};if(!visible(user,candidate))continue;
    // Source contains no verified floor: never infer a floor from a room number.
    const existing=state.residents.find(r=>r.id===String(source.id));
    const row={...(existing||{}),id:String(source.id),residentId:String(source.id),branchId,code:source.code||'',name:source.fullName||source.residentName||'',zoneId,zoneName:source.areaName||state.zones.find(z=>z.id===zoneId)?.name||'Chưa xác định',floorId:existing?.floorId||null,floorName:existing?.floorName||'',roomId:source.roomId||null,roomName:source.roomName||'',bedId:source.bedId||null,bedName:source.bedName||'',active:true,source:source.id.startsWith('MOCK-')?'DEMO':'BCARE'};
    if(!existing){state.residents.push(row);state.locations.push({id:randomUUID(),...row,residentId:row.id,validFrom:at,validTo:null,source:row.source})}
    else { // Explicit transfer owns location history; sync only updates name/code.
      existing.name=row.name;existing.code=row.code;
    }count++;
  }
  for(const scope of state.scopes.filter(s=>s.status==='OPEN'))touch(state,scope.id);
  auditV2(state,user,'ROSTER_SYNC',{id:branchId,branchId},{count});return{count};
}
export function transferResident(state,user,id,b){
  requirePermission(user,'SHIFT.UPDATE');const resident=getRow(state,'residents',id);assertVisible(user,resident);const at=instant(b.effectiveAt);if(at>nowISO()||!String(b.reason||'').trim())fail('Thời điểm chuyển/lý do không hợp lệ.');
  const current=locationAt(state,id,at);if(!current||current.validTo||at<=current.validFrom)fail('Chỉ chuyển từ khoảng vị trí hiện hành; không chèn lịch sử hồi tố.');
  if(state.activities.some(a=>a.residentId===id&&a.occurredAt>=at))fail('Đã có ghi nhận sau thời điểm chuyển. Chọn thời điểm mới hoặc làm quy trình bổ sung.');
  const zone=getRow(state,'zones',b.zoneId);if(!zone.active)fail('Khu đích đã ngừng hoạt động.');const loc={id:randomUUID(),branchId:resident.branchId,residentId:id,zoneId:zone.id,zoneName:zone.name,floorId:b.floorId||null,floorName:b.floorId?getRow(state,'floors',b.floorId).name:'',roomId:b.roomId||null,roomName:b.roomId?getRow(state,'rooms',b.roomId).name:'',bedId:null,bedName:String(b.bedName||''),validFrom:at,validTo:null,reason:b.reason};validateLocation(state,loc);assertVisible(user,loc);
  const sourceScopes=state.scopes.filter(s=>s.zoneId===resident.zoneId&&s.startsAt<=at&&at<s.endsAt),destScopes=state.scopes.filter(s=>s.zoneId===zone.id&&s.startsAt<=at&&at<s.endsAt);if(sourceScopes.some(s=>s.status!=='OPEN')||destScopes.some(s=>s.status!=='OPEN'))fail('Phạm vi nguồn/đích đã khóa.',423);
  const tasks=state.tasks.filter(t=>t.residentId===id&&t.status!=='DONE'&&t.status!=='CANCELLED');for(const t of tasks){const old=getRow(state,'scopes',t.scopeId),dest=state.scopes.find(s=>s.shiftId===old.shiftId&&s.zoneId===zone.id&&s.status==='OPEN');if(!dest)fail('Tạo scope tiếp nhận trước khi chuyển việc đang mở.');touch(state,old.id);t.scopeId=dest.id;t.zoneId=dest.zoneId;t.zoneName=dest.zoneName;t.floorId=loc.floorId;t.floorName=loc.floorName;touch(state,dest.id)}
  current.validTo=at;state.locations.push(loc);for(const f of state.followups.filter(f=>f.residentId===id&&!['CLOSED','CANCELLED'].includes(f.status))){f.zoneId=loc.zoneId;f.floorId=loc.floorId;f.version++}Object.assign(resident,{zoneId:loc.zoneId,zoneName:loc.zoneName,floorId:loc.floorId,floorName:loc.floorName,roomId:loc.roomId,roomName:loc.roomName,bedName:loc.bedName});for(const s of new Set([...sourceScopes,...destScopes]))touch(state,s.id);auditV2(state,user,'RESIDENT_TRANSFER',loc,{reason:b.reason});return resident;
}
export function createTask(state,user,b){
  requirePermission(user,'SHIFT.UPDATE');const scope=scopeRow(state,user,b.scopeId,true),resident=getRow(state,'residents',b.residentId);assertVisible(user,resident);if(resident.zoneId!==scope.zoneId)fail('NCT không thuộc khu.');const dueAt=instant(b.dueAt);if(dueAt<scope.startsAt||dueAt>scope.endsAt)fail('Hạn việc phải nằm trong ca.');
  const title=String(b.title||'').trim();if(!title||title.length>300)fail('Tên việc bắt buộc, tối đa 300 ký tự.');const row={id:randomUUID(),branchId:scope.branchId,shiftId:scope.shiftId,scopeId:scope.id,zoneId:scope.zoneId,zoneName:scope.zoneName,floorId:resident.floorId,floorName:resident.floorName,residentId:resident.id,residentName:resident.name,businessDate:scope.businessDate,dueAt,title,status:'PENDING',createdAt:nowISO()};state.tasks.push(row);touch(state,scope.id);auditV2(state,user,'TASK_CREATE',row);return row;
}
export function createActivity(state,user,b,staff){
  requirePermission(user,'CARE.CREATE');const scope=scopeRow(state,user,b.scopeId);
  const requestId=String(b.clientRequestId||'');if(!/^[A-Za-z0-9._-]{8,100}$/.test(requestId))fail('Thiếu mã chống ghi trùng.');
  const duplicate=state.activities.find(a=>a.clientRequestId===requestId&&a.enteredByUserId===user.sub);if(duplicate){assertVisible(user,duplicate);if(duplicate.scopeId!==b.scopeId||duplicate.residentId!==b.residentId||duplicate.content!==String(b.content||'').trim())fail('Mã gửi lại đã được lưu với nội dung khác. Tải lại hoạt động để đối chiếu.',409);return duplicate}
  if(scope.status!=='OPEN')fail('Khu đã bàn giao và khóa ghi nhận.',423);
  requireCurrentCareScope(user,scope);const at=instant(b.occurredAt);if(at<scope.startsAt||at>=scope.endsAt||at>nowISO())fail('Thời điểm thực hiện phải nằm trong ca và không ở tương lai.');
  const resident=getRow(state,'residents',b.residentId),loc=locationAt(state,resident.id,at);if(!loc||loc.zoneId!==scope.zoneId)fail('NCT không thuộc khu tại thời điểm thực hiện.');assertVisible(user,loc);
  const performers=[b.performedByStaffId,...(b.coPerformerIds||[])];if(new Set(performers).size!==performers.length||!performers[0])fail('Người thực hiện/phối hợp không hợp lệ.');
  for(const id of performers){if(!staff.some(s=>s.id===id&&s.active!==false&&!s.deleted))fail('Nhân sự không hoạt động.');if(!state.assignments.some(a=>a.scopeId===scope.id&&a.staffId===id&&a.startsAt<=at&&at<a.endsAt&&!['ABSENT','CANCELLED','REPLACED'].includes(a.status)&&(!a.floorId||a.floorId===loc.floorId)&&(!a.residentIds.length||a.residentIds.includes(resident.id))))fail('Người thực hiện chưa được phân công đúng khu/tầng/NCT/thời gian.')}
  const content=String(b.content||'').trim();if(!content||content.length>2000)fail('Nội dung bắt buộc, tối đa 2000 ký tự.');const category=String(b.category||'');if(!['ROUTINE','OBSERVATION','HYGIENE','TOILETING','OTHER'].includes(category))fail('Loại chăm sóc không hợp lệ.');
  let task=null;if(b.taskId){task=getRow(state,'tasks',b.taskId);if(task.scopeId!==scope.id||task.residentId!==resident.id||task.status==='CANCELLED'||task.status==='DONE')fail('Nhiệm vụ không hợp lệ hoặc đã hoàn thành.');}
  const savedAt=nowISO();const row={id:randomUUID(),branchId:scope.branchId,shiftId:scope.shiftId,scopeId:scope.id,businessDate:scope.businessDate,shiftType:scope.shiftType,zoneId:scope.zoneId,zoneName:scope.zoneName,floorId:loc.floorId,floorName:loc.floorName,roomId:loc.roomId,roomName:loc.roomName,bedId:loc.bedId,bedName:loc.bedName,locationAtEvent:{zoneId:loc.zoneId,zoneName:loc.zoneName,floorId:loc.floorId,floorName:loc.floorName,roomId:loc.roomId,roomName:loc.roomName,bedName:loc.bedName},residentId:resident.id,residentName:resident.name,performedByStaffId:performers[0],performedByStaffName:staff.find(s=>s.id===performers[0]).fullName,coPerformerIds:performers.slice(1),enteredByUserId:user.sub,enteredByName:user.fullName,clientRequestId:requestId,occurredAt:at,savedAt,content,category,taskId:task?.id||null,version:1,requiresHandover:!!b.requiresHandover,versions:[]};
  state.activities.push(row);if(task){task.status='DONE';task.completedAt=at;task.activityId=row.id}touch(state,scope.id);auditV2(state,user,'ACTIVITY_CREATE',row);return row;
}
export function updateActivity(state,user,id,b){
  requirePermission(user,'CARE.UPDATE');const row=getRow(state,'activities',id);scopeRow(state,user,row.scopeId,true);assertVisible(user,row);if(user.role==='CARE_SHARED'&&row.enteredByUserId!==user.sub)fail('Chỉ sửa ghi nhận do tài khoản này nhập.',403);if(Number(b.expectedVersion)!==row.version)fail('Ghi nhận đã được sửa trên thiết bị khác. Nội dung chưa lưu vẫn được giữ.',409);const content=String(b.content||'').trim();if(!content||content.length>2000)fail('Nội dung bắt buộc, tối đa 2000 ký tự.');row.versions.push({version:row.version,content:row.content,updatedAt:row.updatedAt||row.savedAt});row.content=content;row.version++;row.updatedAt=nowISO();row.updatedBy=user.sub;touch(state,row.scopeId);auditV2(state,user,'ACTIVITY_UPDATE',row);return row;
}
export function handoverPreview(state,user,id){const scope=scopeRow(state,user,id),at=nowISO();assertVisible(user,scope);return{scope,dataVersion:scope.dataVersion,residents:state.residents.filter(r=>r.zoneId===scope.zoneId),participants:state.assignments.filter(a=>a.scopeId===id&&a.status!=='CANCELLED'),activities:state.activities.filter(a=>a.scopeId===id),pendingTasks:state.tasks.filter(t=>t.scopeId===id&&t.status!=='DONE'&&t.status!=='CANCELLED'&&t.dueAt<=at),handover:state.handovers.find(h=>h.scopeId===id)||null}}
export function signScope(state,user,id,b){
  requirePermission(user,'HANDOVER.SIGN');const scope=scopeRow(state,user,id,true);if(b.confirm!==true)fail('Cần xác nhận đã rà soát.');if(Number(b.dataVersion)!==scope.dataVersion)fail('Khu có dữ liệu mới. Mở lại bản rà soát trước khi ký.',409);const preview=handoverPreview(state,user,id);
  const people=new Set(preview.participants.filter(a=>!['ABSENT','CANCELLED','REPLACED'].includes(a.status)).map(a=>a.staffId));if(people.size<scope.minimumStaff)fail(`Khu cần tối thiểu ${scope.minimumStaff} nhân sự theo cấu hình.`);
  if(preview.pendingTasks.length&&!String(b.note||'').trim())fail('Cần ghi lý do/việc chuyển tiếp khi còn nhiệm vụ đến hạn.');
  const representative=preview.participants.find(a=>a.staffId===b.representativeStaffId&&!['ABSENT','REPLACED','CANCELLED'].includes(a.status));if(user.role==='CARE_SHARED'&&!representative)fail('Chọn người đại diện trong phân công có hiệu lực.');
  const row={id:randomUUID(),representativeStaffId:representative?.staffId||null,representativeStaffName:representative?.staffName||null,branchId:scope.branchId,shiftId:scope.shiftId,scopeId:id,zoneId:scope.zoneId,zoneName:scope.zoneName,businessDate:scope.businessDate,version:1,signedBy:user.sub,signedByName:user.fullName,signedAt:nowISO(),note:String(b.note||''),snapshot:structuredClone(preview),participants:preview.participants.map(a=>({...a,individualSignature:false})),receipts:[]};state.handovers.push(row);scope.status='SIGNED';scope.signedAt=row.signedAt;touch(state,id);const shift=getRow(state,'shifts',scope.shiftId),siblings=state.scopes.filter(s=>s.shiftId===shift.id);shift.status=siblings.every(s=>s.status!=='OPEN')?'SIGNED':'PARTIALLY_SIGNED';auditV2(state,user,'SCOPE_SIGN',row);return row;
}
export function receiveScope(state,user,id,b){
  requirePermission(user,'HANDOVER.RECEIVE');const scope=scopeRow(state,user,id);const handover=state.handovers.find(h=>h.scopeId===id);if(!handover||b.confirm!==true)fail('Bàn giao chưa ký hoặc chưa xác nhận nhận.');const target=scopeRow(state,user,b.receivingScopeId,true);if(target.zoneId!==scope.zoneId||target.startsAt<scope.endsAt||target.id===scope.id)fail('Phải nhận vào ca tiếp theo cùng khu.');
  const existing=handover.receipts.find(r=>r.receivingScopeId===target.id);if(existing)return existing;const row={id:randomUUID(),receivingScopeId:target.id,receivedBy:user.sub,receivedByName:user.fullName,receivedAt:nowISO(),note:String(b.note||'')};handover.receipts.push(row);for(const task of state.tasks.filter(t=>t.scopeId===id&&!['DONE','CANCELLED'].includes(t.status))){task.originScopeId=task.originScopeId||id;task.scopeId=target.id;task.shiftId=target.shiftId;task.carriedAt=row.receivedAt;task.carryHistory=task.carryHistory||[];task.carryHistory.push({fromScopeId:id,toScopeId:target.id,receivedAt:row.receivedAt})}scope.status='RECEIVED';touch(state,id);touch(state,target.id);auditV2(state,user,'SCOPE_RECEIVE',handover,row);return row;
}
export function createInteraction(state,user,b){
  requirePermission(user,'CSKH.CREATE');const r=getRow(state,'residents',b.residentId);assertVisible(user,r);const content=String(b.content||'').trim();if(!content||content.length>2000)fail('Nội dung bắt buộc, tối đa 2000 ký tự.');const occurredAt=instant(b.occurredAt);if(occurredAt>nowISO())fail('Thời điểm liên hệ ở tương lai.');if(!['PHONE','VISIT','MESSAGE','OTHER'].includes(b.channel))fail('Kênh không hợp lệ.');
  const row={id:randomUUID(),branchId:r.branchId,residentId:r.id,zoneId:r.zoneId,floorId:r.floorId,residentName:r.name,channel:b.channel,contactName:String(b.contactName||''),content,occurredAt,savedAt:nowISO(),enteredByUserId:user.sub,enteredByName:user.fullName};state.interactions.push(row);auditV2(state,user,'INTERACTION_CREATE',row);return row;
}
export function createFollowup(state,user,b,users){
  requirePermission(user,'CSKH.CREATE');const r=getRow(state,'residents',b.residentId);assertVisible(user,r);const owner=users.find(u=>u.id===b.ownerId&&u.active!==false&&visible({...u,sub:u.id},r));if(!owner)fail('Người nhận ngoài phạm vi hoặc đã khóa.');const title=String(b.title||'').trim();if(!title||title.length>300)fail('Tên tác vụ bắt buộc, tối đa 300 ký tự.');
  const row={id:randomUUID(),branchId:r.branchId,residentId:r.id,residentName:r.name,zoneId:r.zoneId,floorId:r.floorId,title,ownerId:owner.id,ownerName:owner.fullName,dueAt:instant(b.dueAt),createdAt:nowISO(),createdBy:user.sub,status:'OPEN',version:1,history:[]};state.followups.push(row);auditV2(state,user,'FOLLOWUP_CREATE',row);return row;
}
export function updateFollowup(state,user,id,b){
  if(!hasPermission(user,'CSKH.UPDATE')&&!hasPermission(user,'FOLLOWUP.UPDATE'))fail('Không có quyền xử lý tác vụ.',403);const row=getRow(state,'followups',id);if(!hasPermission(user,'CSKH.UPDATE')&&(row.ownerId!==user.sub||!['IN_PROGRESS','RESOLVED'].includes(b.status)))fail('Chỉ xử lý việc được giao; CSKH xác minh đóng/mở lại.',403);assertVisible(user,row);if(Number(b.expectedVersion)!==row.version)fail('Tác vụ đã thay đổi.',409);if(!['IN_PROGRESS','RESOLVED','CLOSED','OPEN','CANCELLED'].includes(b.status)||!String(b.note||'').trim())fail('Trạng thái/kết quả xử lý không hợp lệ.');if(['CLOSED','CANCELLED'].includes(b.status)&&user.role!=='ADMIN'&&user.role!=='BRANCH_DIRECTOR'&&user.role!=='CSKH')fail('Chỉ CSKH/người quản lý xác minh đóng tác vụ.',403);
  row.history.push({at:nowISO(),from:row.status,to:b.status,note:b.note,userId:user.sub});row.status=b.status;row.version++;auditV2(state,user,'FOLLOWUP_UPDATE',row);return row;
}
