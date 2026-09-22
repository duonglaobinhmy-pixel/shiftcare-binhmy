import { readJson, writeJson } from '../utils/files.js';
import { getPool, middlewareSchemaReady, withTransaction } from './db.service.js';
import { uploadWoundImage, getSignedWoundImageUrl, deleteWoundImageObject, storageConfigured } from './media-storage.service.js';

const DEFAULT_STORE = { shifts:[], shiftResidents:[], changeLogs:[], toiletingLogs:[], handovers:[], auditLogs:[], medicationOrders:[], staffMembers:[] };
let queue = Promise.resolve();
const clone = value => JSON.parse(JSON.stringify(value));
const iso = value => { if(!value)return null; const d=new Date(value); return Number.isNaN(d.getTime())?null:d.toISOString(); };
const dateOnly = value => { if(!value)return null; if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.trim()))return value.trim(); const d=value instanceof Date?value:new Date(value); if(Number.isNaN(d.getTime()))throw new Error(`Ngày không hợp lệ: ${String(value)}`); return d.toISOString().slice(0,10); };
let storeCache={value:null,expiresAt:0};
export function invalidateStoreCache(){storeCache={value:null,expiresAt:0}}

function mergeExtra(extra, canonical) { return { ...(extra || {}), ...canonical }; }
function strip(obj, keys=[]) { const out={...(obj||{})}; for(const k of keys) delete out[k]; return out; }
async function ensureBranch(db, id, name='') {
  if (!id) return;
  await db.query(`INSERT INTO bcare_branches_ref(bcare_branch_id,name_cache,last_synced_at) VALUES($1,$2,NOW()) ON CONFLICT(bcare_branch_id) DO UPDATE SET name_cache=COALESCE(NULLIF(EXCLUDED.name_cache,''),bcare_branches_ref.name_cache)`, [String(id), String(name||'')]);
}
async function ensureResident(db, row={}) {
  if (!row.residentId) return;
  await ensureBranch(db, row.branchId, row.branchName);
  await db.query(`
    INSERT INTO bcare_residents_ref(bcare_resident_id,code_cache,full_name_cache,branch_id,area_id_cache,area_name_cache,room_id_cache,room_name_cache,bed_name_cache,image_cache,last_synced_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
    ON CONFLICT(bcare_resident_id) DO UPDATE SET
      code_cache=COALESCE(NULLIF(EXCLUDED.code_cache,''),bcare_residents_ref.code_cache),
      full_name_cache=COALESCE(NULLIF(EXCLUDED.full_name_cache,''),bcare_residents_ref.full_name_cache),
      branch_id=COALESCE(EXCLUDED.branch_id,bcare_residents_ref.branch_id),
      area_id_cache=COALESCE(EXCLUDED.area_id_cache,bcare_residents_ref.area_id_cache),
      area_name_cache=COALESCE(NULLIF(EXCLUDED.area_name_cache,''),bcare_residents_ref.area_name_cache),
      room_id_cache=COALESCE(EXCLUDED.room_id_cache,bcare_residents_ref.room_id_cache),
      room_name_cache=COALESCE(NULLIF(EXCLUDED.room_name_cache,''),bcare_residents_ref.room_name_cache),
      bed_name_cache=COALESCE(NULLIF(EXCLUDED.bed_name_cache,''),bcare_residents_ref.bed_name_cache),
      image_cache=COALESCE(NULLIF(EXCLUDED.image_cache,''),bcare_residents_ref.image_cache),
      last_synced_at=NOW()
  `,[String(row.residentId),String(row.code||row.residentCode||''),String(row.fullName||row.residentName||''),row.branchId?String(row.branchId):null,row.areaId?String(row.areaId):null,String(row.areaName||''),row.roomId?String(row.roomId):null,String(row.roomName||''),String(row.bedName||''),String(row.image||'')]);
}

export async function getUsers() {
  if (!await middlewareSchemaReady()) return readJson('users.json', []);
  const db=getPool();
  const [u,p]=await Promise.all([db.query(`SELECT * FROM users ORDER BY username`),db.query(`SELECT user_id,permission FROM user_permissions ORDER BY permission`)]);
  const perms=new Map(); for(const x of p.rows){const a=perms.get(x.user_id)||[];a.push(x.permission);perms.set(x.user_id,a)}
  return u.rows.map(x=>mergeExtra(x.legacy_extra,{
    id:x.id,username:x.username,password:x.password,employeeCode:x.employee_code||'',fullName:x.full_name,role:x.role,
    branchId:x.branch_id,branchName:x.branch_name_cache||'',areaId:x.area_id_cache,areaName:x.area_name_cache||'',
    permissions:perms.get(x.id)||[],active:x.active,
    ...(x.deactivated_at?{deactivatedAt:iso(x.deactivated_at)}:{}),...(x.deactivated_by?{deactivatedBy:x.deactivated_by}:{})
  }));
}

export async function saveUsers(users) {
  if (!await middlewareSchemaReady()) return writeJson('users.json', users);
  return withTransaction(async db=>{
    const ids=[];
    for(const u of users){
      ids.push(String(u.id)); await ensureBranch(db,u.branchId,u.branchName);
      await db.query(`
        INSERT INTO users(id,username,password,employee_code,full_name,role,branch_id,branch_name_cache,area_id_cache,area_name_cache,active,deactivated_at,deactivated_by,legacy_extra,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,NOW())
        ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,password=EXCLUDED.password,employee_code=EXCLUDED.employee_code,full_name=EXCLUDED.full_name,role=EXCLUDED.role,branch_id=EXCLUDED.branch_id,branch_name_cache=EXCLUDED.branch_name_cache,area_id_cache=EXCLUDED.area_id_cache,area_name_cache=EXCLUDED.area_name_cache,active=EXCLUDED.active,deactivated_at=EXCLUDED.deactivated_at,deactivated_by=EXCLUDED.deactivated_by,legacy_extra=EXCLUDED.legacy_extra,updated_at=NOW()
      `,[u.id,u.username,u.password||'',u.employeeCode||null,u.fullName||u.username,u.role||'CARE_SHARED',u.branchId||null,u.branchName||'',u.areaId||null,u.areaName||'',u.active!==false,u.deactivatedAt||null,u.deactivatedBy||null,JSON.stringify(u)]);
      await db.query(`DELETE FROM user_permissions WHERE user_id=$1`,[u.id]);
      for(const permission of (u.permissions||[])) await db.query(`INSERT INTO user_permissions(user_id,permission) VALUES($1,$2) ON CONFLICT DO NOTHING`,[u.id,permission]);
    }
    if(ids.length) await db.query(`DELETE FROM users WHERE NOT (id=ANY($1::text[]))`,[ids]); else await db.query(`DELETE FROM users`);
    return users;
  });
}

export async function getStore() {
  if (!await middlewareSchemaReady()) return readJson('store.json', clone(DEFAULT_STORE));
  if(storeCache.value&&Date.now()<storeCache.expiresAt)return clone(storeCache.value);
  const db=getPool();
  const [branches,residents,staff,shifts,shiftStaff,shiftResidents,care,vitals,images,toilets,instructions,handovers,signs,audits,users,careEvents,careCategories]=await Promise.all([
    db.query(`SELECT * FROM bcare_branches_ref`),db.query(`SELECT * FROM bcare_residents_ref`),db.query(`SELECT * FROM staff_members`),
    db.query(`SELECT * FROM shifts`),db.query(`SELECT * FROM shift_staff`),db.query(`SELECT * FROM shift_residents`),
    db.query(`SELECT * FROM care_records`),db.query(`SELECT * FROM care_record_vitals`),db.query(`SELECT * FROM care_record_images`),
    db.query(`SELECT * FROM toileting_logs`),db.query(`SELECT * FROM care_instructions`),db.query(`SELECT * FROM handovers`),
    db.query(`SELECT * FROM handover_signatures`),db.query(`SELECT * FROM audit_logs ORDER BY occurred_at DESC`),db.query(`SELECT id,username,employee_code,full_name,role FROM users`),db.query(`SELECT care_record_id,event_code FROM care_record_events ORDER BY id`),db.query(`SELECT care_record_id,category_code FROM care_record_categories ORDER BY category_code`)
  ]);
  const bMap=new Map(branches.rows.map(x=>[x.bcare_branch_id,x])); const rMap=new Map(residents.rows.map(x=>[x.bcare_resident_id,x])); const sMap=new Map(staff.rows.map(x=>[x.id,x])); const uMap=new Map(users.rows.map(x=>[x.id,x]));
  const ssMap=new Map(); for(const x of shiftStaff.rows){const a=ssMap.get(x.shift_id)||[];a.push(x);ssMap.set(x.shift_id,a)}
  const vitMap=new Map(vitals.rows.map(x=>[x.care_record_id,x])); const imgMap=new Map(); for(const x of images.rows){const a=imgMap.get(x.care_record_id)||[];a.push(x);imgMap.set(x.care_record_id,a)}
  const eventMap=new Map();for(const x of careEvents.rows){const a=eventMap.get(x.care_record_id)||[];a.push(x.event_code);eventMap.set(x.care_record_id,a)}
  const categoryMap=new Map();for(const x of careCategories.rows){const a=categoryMap.get(x.care_record_id)||[];a.push(x.category_code);categoryMap.set(x.care_record_id,a)}
  const sigMap=new Map(); for(const x of signs.rows){const a=sigMap.get(x.handover_id)||[];a.push(x);sigMap.set(x.handover_id,a)}
  const staffMembers=staff.rows.map(x=>mergeExtra(x.legacy_extra,{id:x.id,employeeCode:x.employee_code,fullName:x.full_name,branchId:x.branch_id,branchName:x.branch_name_cache||bMap.get(x.branch_id)?.name_cache||'',areaId:x.area_id_cache,areaName:x.area_name_cache||'',userId:x.user_id,role:x.role_cache,active:x.active,deleted:x.deleted,createdBy:x.created_by,createdAt:iso(x.created_at),updatedBy:x.updated_by,updatedAt:iso(x.updated_at),deletedBy:x.deleted_by,deletedAt:iso(x.deleted_at),deleteReason:x.delete_reason}));
  const shiftRows=shifts.rows.map(x=>{
    const assigned=(ssMap.get(x.id)||[]).map(link=>{const p=sMap.get(link.staff_id)||{};const u=p.user_id?uMap.get(p.user_id):null;return{id:p.id,userId:p.user_id||null,username:u?.username||'',employeeCode:p.employee_code||'',fullName:p.full_name||'',role:p.role_cache||u?.role||'STAFF',areaId:p.area_id_cache||null,areaName:p.area_name_cache||'',isPrimary:!!link.is_primary_recorder}});
    const primary=assigned.find(p=>p.isPrimary)||null;
    return mergeExtra(x.legacy_extra,{id:x.id,shiftDate:dateOnly(x.shift_date),shiftType:x.shift_type,status:x.status,branchId:x.branch_id,branchName:x.branch_name_cache||bMap.get(x.branch_id)?.name_cache||'',areaId:x.area_id_cache,areaName:x.area_name_cache||'',roomId:x.room_id_cache,assignedStaffIds:assigned.map(p=>p.id),assignedStaff:assigned,assignedStaffNames:assigned.map(p=>p.fullName),assignedStaffId:primary?.id||'',assignedStaffName:primary?.fullName||'',primaryRecorderId:primary?.id||'',primaryRecorderName:primary?.fullName||'',primaryRecorderCode:primary?.employeeCode||'',autoCreated:x.auto_created,createdBy:x.created_by,createdAt:iso(x.created_at),staffUpdatedBy:x.staff_updated_by,staffUpdatedAt:iso(x.staff_updated_at),lockedBy:x.locked_by,lockedAt:iso(x.locked_at)});
  });
  const roster=shiftResidents.rows.map(x=>mergeExtra(x.legacy_extra,{id:x.id,shiftId:x.shift_id,residentId:x.bcare_resident_id,code:x.code_snapshot,fullName:x.full_name_snapshot,branchId:x.branch_id,branchName:x.branch_name_snapshot,areaId:x.area_id_snapshot,areaName:x.area_name_snapshot,roomId:x.room_id_snapshot,roomName:x.room_name_snapshot,bedName:x.bed_name_snapshot,image:x.image_snapshot,derivedStatus:x.derived_status}));
  const changeLogs=await Promise.all(care.rows.map(async x=>{
    const v=vitMap.get(x.id);
    const imgs=await Promise.all((imgMap.get(x.id)||[]).map(async i=>{
      let signedUrl=null;
      if(i.object_key){
        try{signedUrl=await getSignedWoundImageUrl(i.object_key,900)}catch(error){console.error(`[MEDIA] signed URL failed ${i.object_key}:`,error?.message||error)}
      }
      return mergeExtra(i.legacy_extra,{
        id:i.id,objectKey:i.object_key||null,url:signedUrl||null,dataUrl:signedUrl||null,mimeType:i.mime_type||'',
        sizeBytes:i.size_bytes==null?null:Number(i.size_bytes),width:i.width,height:i.height,
        createdAt:iso(i.created_at),expiresAt:iso(i.expires_at),legacyDataOmitted:i.legacy_data_omitted
      });
    }));
    return mergeExtra(x.legacy_extra,{id:x.id,clientRequestId:x.client_request_id||'',shiftId:x.shift_id,residentId:x.bcare_resident_id,residentName:x.resident_name_snapshot,category:x.category,categoryCodes:categoryMap.get(x.id)||[x.category],eventType:x.event_type,eventCodes:eventMap.get(x.id)||[x.event_type],residentStatus:x.resident_status||'IN_FACILITY',priority:x.priority,occurredAt:iso(x.occurred_at),content:x.content,intervention:x.intervention,notifiedTo:x.notified_to,vitals:v?mergeExtra(v.raw,{pulse:v.pulse==null?null:Number(v.pulse),temperature:v.temperature==null?null:Number(v.temperature),bpSys:v.bp_sys==null?null:Number(v.bp_sys),bpDia:v.bp_dia==null?null:Number(v.bp_dia),spo2:v.spo2==null?null:Number(v.spo2),respiratoryRate:v.respiratory_rate==null?null:Number(v.respiratory_rate),bloodGlucose:v.blood_glucose==null?null:Number(v.blood_glucose),insulinDoseUnits:v.insulin_dose_units==null?null:Number(v.insulin_dose_units),concern:v.concern,alertLevel:v.alert_level,alerts:v.alerts||[],urgent:v.urgent||null}):null,woundImages:imgs,requiresHandover:x.requires_handover,followUp:x.follow_up,branchId:x.branch_id,branchName:x.branch_name_snapshot,areaId:x.area_id_snapshot,areaName:x.area_name_snapshot,roomName:x.room_name_snapshot,bedName:x.bed_name_snapshot,image:x.image_snapshot,createdBy:x.created_by,createdByName:x.created_by_name_cache,createdAt:iso(x.created_at),updatedBy:x.updated_by,updatedByName:x.updated_by_name_cache,updatedAt:iso(x.updated_at),deleted:x.deleted,deletedBy:x.deleted_by,deletedAt:iso(x.deleted_at),deleteReason:x.delete_reason,attentionLevel:x.attention_level,attentionStatus:x.attention_status,attentionResolvedAt:iso(x.attention_resolved_at),attentionResolvedBy:x.attention_resolved_by});
  }));
  const toiletingLogs=toilets.rows.map(x=>mergeExtra(x.legacy_extra,{id:x.id,clientRequestId:x.client_request_id||'',shiftId:x.shift_id,residentId:x.bcare_resident_id,residentName:x.resident_name_snapshot,bowelStatus:x.bowel_status,urineStatus:x.urine_status,urineDetail:x.urine_detail,note:x.note,branchId:x.branch_id,areaId:x.area_id_snapshot,areaName:x.area_name_snapshot,roomName:x.room_name_snapshot,bedName:x.bed_name_snapshot,image:x.image_snapshot,createdBy:x.created_by,createdByName:x.created_by_name_cache,createdAt:iso(x.created_at),updatedBy:x.updated_by,updatedAt:iso(x.updated_at),deleted:x.deleted,deletedBy:x.deleted_by,deletedAt:iso(x.deleted_at),deleteReason:x.delete_reason}));
  const medicationOrders=instructions.rows.map(x=>mergeExtra(x.legacy_extra,{id:x.id,type:x.instruction_type,residentId:x.bcare_resident_id,residentName:x.resident_name_snapshot,residentCode:x.resident_code_snapshot,branchId:x.branch_id,branchName:x.branch_name_snapshot,areaId:x.area_id_snapshot,areaName:x.area_name_snapshot,roomName:x.room_name_snapshot,bedName:x.bed_name_snapshot,morning:x.morning,noon:x.noon,evening:x.evening,status:x.status,source:x.source,createdBy:x.created_by,createdByName:x.created_by_name_cache,createdAt:iso(x.created_at),updatedBy:x.updated_by,updatedAt:iso(x.updated_at),stoppedBy:x.stopped_by,stoppedAt:iso(x.stopped_at),stopReason:x.stop_reason,deleted:x.deleted}));
  const handoverRows=handovers.rows.map(x=>mergeExtra(x.legacy_extra,{id:x.id,shiftId:x.shift_id,branchId:x.branch_id,version:x.version,summaryNote:x.summary_note,confirmedBy:x.confirmed_by,confirmedByName:x.confirmed_by_name_cache,confirmedAt:iso(x.confirmed_at),receivedBy:x.received_by,receivedByName:x.received_by_name_cache,receivedAt:iso(x.received_at),participants:(sigMap.get(x.id)||[]).map(s=>({userId:s.staff_id,username:s.username_cache,employeeCode:s.employee_code_cache,fullName:s.full_name_cache,acknowledged:s.acknowledged,acknowledgedAt:iso(s.acknowledged_at),recordedBy:s.recorded_by}))}));
  const auditLogs=audits.rows.map(x=>({id:x.id,actorId:x.actor_id,actorName:x.actor_name,role:x.role,branchId:x.branch_id,action:x.action,objectType:x.object_type,objectId:x.object_id,detail:x.detail||{},occurredAt:iso(x.occurred_at)}));
  const result={shifts:shiftRows,shiftResidents:roster,changeLogs,toiletingLogs,handovers:handoverRows,auditLogs,medicationOrders,staffMembers};
  storeCache={value:clone(result),expiresAt:Date.now()+1500};
  return result;
}

async function persistStore(db, store) {
  const objectsToDelete = new Set();
  for(const x of store.staffMembers||[]){await ensureBranch(db,x.branchId,x.branchName);await db.query(`
    INSERT INTO staff_members(id,employee_code,full_name,branch_id,branch_name_cache,area_id_cache,area_name_cache,user_id,role_cache,active,deleted,created_by,created_at,updated_by,updated_at,deleted_by,deleted_at,delete_reason,legacy_extra)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::timestamptz,NOW()),$14,$15,$16,$17,$18,$19::jsonb)
    ON CONFLICT(id) DO UPDATE SET employee_code=EXCLUDED.employee_code,full_name=EXCLUDED.full_name,branch_id=EXCLUDED.branch_id,branch_name_cache=EXCLUDED.branch_name_cache,area_id_cache=EXCLUDED.area_id_cache,area_name_cache=EXCLUDED.area_name_cache,user_id=EXCLUDED.user_id,role_cache=EXCLUDED.role_cache,active=EXCLUDED.active,deleted=EXCLUDED.deleted,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at,deleted_by=EXCLUDED.deleted_by,deleted_at=EXCLUDED.deleted_at,delete_reason=EXCLUDED.delete_reason,legacy_extra=EXCLUDED.legacy_extra
  `,[x.id,x.employeeCode||'',x.fullName||'',x.branchId,x.branchName||'',x.areaId||null,x.areaName||'',x.userId||null,x.role||'STAFF',x.active!==false,!!x.deleted,x.createdBy||null,x.createdAt||null,x.updatedBy||null,x.updatedAt||null,x.deletedBy||null,x.deletedAt||null,x.deleteReason||null,JSON.stringify(strip(x))]);}
  for(const x of store.shiftResidents||[]) await ensureResident(db,x);
  for(const x of store.changeLogs||[]) await ensureResident(db,x);
  for(const x of store.toiletingLogs||[]) await ensureResident(db,x);
  for(const x of store.medicationOrders||[]) await ensureResident(db,x);

  const shiftIds=[];
  for(const x of store.shifts||[]){shiftIds.push(String(x.id));await ensureBranch(db,x.branchId,x.branchName);await db.query(`
    INSERT INTO shifts(id,shift_date,shift_type,status,branch_id,branch_name_cache,area_id_cache,area_name_cache,room_id_cache,auto_created,created_by,created_at,staff_updated_by,staff_updated_at,locked_by,locked_at,legacy_extra)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,NOW()),$13,$14,$15,$16,$17::jsonb)
    ON CONFLICT(id) DO UPDATE SET shift_date=EXCLUDED.shift_date,shift_type=EXCLUDED.shift_type,status=EXCLUDED.status,branch_id=EXCLUDED.branch_id,branch_name_cache=EXCLUDED.branch_name_cache,area_id_cache=EXCLUDED.area_id_cache,area_name_cache=EXCLUDED.area_name_cache,room_id_cache=EXCLUDED.room_id_cache,auto_created=EXCLUDED.auto_created,staff_updated_by=EXCLUDED.staff_updated_by,staff_updated_at=EXCLUDED.staff_updated_at,locked_by=EXCLUDED.locked_by,locked_at=EXCLUDED.locked_at,legacy_extra=EXCLUDED.legacy_extra
  `,[x.id,dateOnly(x.shiftDate),x.shiftType,x.status||'OPEN',x.branchId,x.branchName||'',x.areaId||null,x.areaName||'',x.roomId||null,!!x.autoCreated,x.createdBy||null,x.createdAt||null,x.staffUpdatedBy||null,x.staffUpdatedAt||null,x.lockedBy||null,x.lockedAt||null,JSON.stringify(strip(x,['assignedStaff','assignedStaffIds','assignedStaffNames']))]);await db.query(`DELETE FROM shift_staff WHERE shift_id=$1`,[x.id]);for(const p of x.assignedStaff||[]){if(!p?.id)continue;await db.query(`INSERT INTO shift_staff(shift_id,staff_id,is_primary_recorder) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[x.id,p.id,p.id===(x.primaryRecorderId||x.assignedStaffId)])}}
  if(shiftIds.length) await db.query(`DELETE FROM shifts WHERE NOT (id=ANY($1::text[]))`,[shiftIds]); else await db.query(`DELETE FROM shifts`);

  await db.query(`DELETE FROM shift_residents`);
  for(const x of store.shiftResidents||[]){await db.query(`INSERT INTO shift_residents(id,shift_id,bcare_resident_id,code_snapshot,full_name_snapshot,branch_id,branch_name_snapshot,area_id_snapshot,area_name_snapshot,room_id_snapshot,room_name_snapshot,bed_name_snapshot,image_snapshot,derived_status,legacy_extra) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,[x.id,x.shiftId,x.residentId,x.code||'',x.fullName||'',x.branchId,x.branchName||'',x.areaId||null,x.areaName||'',x.roomId||null,x.roomName||'',x.bedName||'',x.image||'',x.derivedStatus||'NO_RECORDED_CHANGE',JSON.stringify(strip(x))]);}

  for(const x of store.changeLogs||[]){await db.query(`
    INSERT INTO care_records(id,client_request_id,shift_id,bcare_resident_id,resident_name_snapshot,category,event_type,priority,occurred_at,content,intervention,notified_to,requires_handover,follow_up,branch_id,branch_name_snapshot,area_id_snapshot,area_name_snapshot,room_name_snapshot,bed_name_snapshot,image_snapshot,created_by,created_by_name_cache,created_at,updated_by,updated_by_name_cache,updated_at,deleted,deleted_by,deleted_at,delete_reason,attention_level,attention_status,attention_resolved_at,attention_resolved_by,legacy_extra,resident_status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,COALESCE($24::timestamptz,NOW()),$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36::jsonb,$37)
    ON CONFLICT(id) DO UPDATE SET client_request_id=EXCLUDED.client_request_id,resident_name_snapshot=EXCLUDED.resident_name_snapshot,category=EXCLUDED.category,event_type=EXCLUDED.event_type,resident_status=EXCLUDED.resident_status,priority=EXCLUDED.priority,occurred_at=EXCLUDED.occurred_at,content=EXCLUDED.content,intervention=EXCLUDED.intervention,notified_to=EXCLUDED.notified_to,requires_handover=EXCLUDED.requires_handover,follow_up=EXCLUDED.follow_up,branch_name_snapshot=EXCLUDED.branch_name_snapshot,area_id_snapshot=EXCLUDED.area_id_snapshot,area_name_snapshot=EXCLUDED.area_name_snapshot,room_name_snapshot=EXCLUDED.room_name_snapshot,bed_name_snapshot=EXCLUDED.bed_name_snapshot,image_snapshot=EXCLUDED.image_snapshot,updated_by=EXCLUDED.updated_by,updated_by_name_cache=EXCLUDED.updated_by_name_cache,updated_at=EXCLUDED.updated_at,deleted=EXCLUDED.deleted,deleted_by=EXCLUDED.deleted_by,deleted_at=EXCLUDED.deleted_at,delete_reason=EXCLUDED.delete_reason,attention_level=EXCLUDED.attention_level,attention_status=EXCLUDED.attention_status,attention_resolved_at=EXCLUDED.attention_resolved_at,attention_resolved_by=EXCLUDED.attention_resolved_by,legacy_extra=EXCLUDED.legacy_extra
  `,[x.id,x.clientRequestId||null,x.shiftId,x.residentId,x.residentName||'',x.category||'GENERAL',x.eventCodes?.[0]||x.eventType||'OBSERVATION',x.priority||'MEDIUM',x.occurredAt||x.createdAt||new Date().toISOString(),x.content||'',x.intervention||'',x.notifiedTo||'',!!x.requiresHandover,x.followUp||'',x.branchId,x.branchName||'',x.areaId||null,x.areaName||'',x.roomName||'',x.bedName||'',x.image||'',x.createdBy||null,x.createdByName||'',x.createdAt||null,x.updatedBy||null,x.updatedByName||'',x.updatedAt||null,!!x.deleted,x.deletedBy||null,x.deletedAt||null,x.deleteReason||null,x.attentionLevel||null,x.attentionStatus||null,x.attentionResolvedAt||null,x.attentionResolvedBy||null,JSON.stringify(strip(x,['vitals','woundImages'])),x.residentStatus||'IN_FACILITY']);
  await db.query(`DELETE FROM care_record_events WHERE care_record_id=$1`,[x.id]);
  for(const code of [...new Set(x.eventCodes?.length?x.eventCodes:[x.eventType||'OBSERVATION'])])await db.query(`INSERT INTO care_record_events(care_record_id,event_code) VALUES($1,$2)`,[x.id,code==='HOSPITAL'?'OBSERVATION':code]);
  await db.query(`DELETE FROM care_record_categories WHERE care_record_id=$1`,[x.id]);
  for(const code of [...new Set(x.categoryCodes?.length?x.categoryCodes:[x.category||'HEALTH'])])await db.query(`INSERT INTO care_record_categories(care_record_id,category_code) VALUES($1,$2)`,[x.id,code]);
  await db.query(`DELETE FROM care_record_vitals WHERE care_record_id=$1`,[x.id]);if(x.vitals){const v=x.vitals;await db.query(`INSERT INTO care_record_vitals(care_record_id,pulse,temperature,bp_sys,bp_dia,spo2,respiratory_rate,concern,alert_level,alerts,urgent,raw,blood_glucose,insulin_dose_units) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14)`,[x.id,v.pulse??null,v.temperature??null,v.bpSys??null,v.bpDia??null,v.spo2??null,v.respiratoryRate??null,!!v.concern,v.alertLevel||'NORMAL',JSON.stringify(v.alerts||[]),v.urgent?JSON.stringify(v.urgent):null,JSON.stringify(v),v.bloodGlucose??null,v.insulinDoseUnits??null])}const existingImages=await db.query(`SELECT id,object_key FROM care_record_images WHERE care_record_id=$1`,[x.id]);
    const nextImageIds=[];
    for(const rawImg of x.woundImages||[]){
      const img={...rawImg};
      img.id=String(img.id||'');
      if(!img.id) throw new Error('Ảnh chăm sóc thiếu id.');
      nextImageIds.push(img.id);
      let objectKey=String(img.objectKey||'').trim();
      let mimeType=String(img.mimeType||'').trim();
      let sizeBytes=img.sizeBytes??null;
      const dataUrl=String(img.dataUrl||'');
      if(!objectKey && dataUrl.startsWith('data:image/')){
        if(!storageConfigured()) throw new Error('Không thể lưu ảnh: Object Storage chưa được cấu hình trên server.');
        const uploaded=await uploadWoundImage({dataUrl,branchId:x.branchId,careRecordId:x.id,imageId:img.id,width:img.width,height:img.height,createdAt:img.createdAt,expiresAt:img.expiresAt});
        objectKey=uploaded.objectKey; mimeType=uploaded.mimeType; sizeBytes=uploaded.sizeBytes;
      }
      if(!objectKey) throw new Error('Ảnh không có file trong Object Storage. Vui lòng tải ảnh lại.');
      await db.query(`
        INSERT INTO care_record_images(id,care_record_id,object_key,private_url,mime_type,size_bytes,width,height,created_at,expires_at,legacy_data_omitted,legacy_extra)
        VALUES($1,$2,$3,NULL,$4,$5,$6,$7,COALESCE($8::timestamptz,NOW()),$9,FALSE,$10::jsonb)
        ON CONFLICT(id) DO UPDATE SET object_key=EXCLUDED.object_key,private_url=NULL,mime_type=EXCLUDED.mime_type,size_bytes=EXCLUDED.size_bytes,width=EXCLUDED.width,height=EXCLUDED.height,expires_at=EXCLUDED.expires_at,legacy_data_omitted=FALSE,legacy_extra=EXCLUDED.legacy_extra
      `,[img.id,x.id,objectKey,mimeType,sizeBytes,img.width??null,img.height??null,img.createdAt||null,img.expiresAt||null,JSON.stringify(strip(img,['dataUrl','url','privateUrl']))]);
    }
    for(const previous of existingImages.rows){
      if(!nextImageIds.includes(String(previous.id)) && previous.object_key) objectsToDelete.add(previous.object_key);
    }
    if(nextImageIds.length) await db.query(`DELETE FROM care_record_images WHERE care_record_id=$1 AND NOT (id=ANY($2::text[]))`,[x.id,nextImageIds]);
    else await db.query(`DELETE FROM care_record_images WHERE care_record_id=$1`,[x.id]);
  }

  for(const x of store.toiletingLogs||[]){await db.query(`
    INSERT INTO toileting_logs(id,client_request_id,shift_id,bcare_resident_id,resident_name_snapshot,bowel_status,urine_status,urine_detail,note,branch_id,area_id_snapshot,area_name_snapshot,room_name_snapshot,bed_name_snapshot,image_snapshot,created_by,created_by_name_cache,created_at,updated_by,updated_at,deleted,deleted_by,deleted_at,delete_reason,legacy_extra)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,COALESCE($18::timestamptz,NOW()),$19,$20,$21,$22,$23,$24,$25::jsonb)
    ON CONFLICT(id) DO UPDATE SET bowel_status=EXCLUDED.bowel_status,urine_status=EXCLUDED.urine_status,urine_detail=EXCLUDED.urine_detail,note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at,deleted=EXCLUDED.deleted,deleted_by=EXCLUDED.deleted_by,deleted_at=EXCLUDED.deleted_at,delete_reason=EXCLUDED.delete_reason,legacy_extra=EXCLUDED.legacy_extra
  `,[x.id,x.clientRequestId||null,x.shiftId,x.residentId,x.residentName||'',x.bowelStatus||'NORMAL',x.urineStatus||'NORMAL',x.urineDetail||'',x.note||'',x.branchId,x.areaId||null,x.areaName||'',x.roomName||'',x.bedName||'',x.image||'',x.createdBy||null,x.createdByName||'',x.createdAt||null,x.updatedBy||null,x.updatedAt||null,!!x.deleted,x.deletedBy||null,x.deletedAt||null,x.deleteReason||null,JSON.stringify(strip(x))]);}

  for(const x of store.medicationOrders||[]){await db.query(`
    INSERT INTO care_instructions(id,bcare_resident_id,resident_name_snapshot,resident_code_snapshot,branch_id,branch_name_snapshot,area_id_snapshot,area_name_snapshot,room_name_snapshot,bed_name_snapshot,instruction_type,morning,noon,evening,status,source,created_by,created_by_name_cache,created_at,updated_by,updated_at,stopped_by,stopped_at,stop_reason,deleted,legacy_extra)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,COALESCE($19::timestamptz,NOW()),$20,$21,$22,$23,$24,$25,$26::jsonb)
    ON CONFLICT(id) DO UPDATE SET resident_name_snapshot=EXCLUDED.resident_name_snapshot,resident_code_snapshot=EXCLUDED.resident_code_snapshot,morning=EXCLUDED.morning,noon=EXCLUDED.noon,evening=EXCLUDED.evening,status=EXCLUDED.status,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at,stopped_by=EXCLUDED.stopped_by,stopped_at=EXCLUDED.stopped_at,stop_reason=EXCLUDED.stop_reason,deleted=EXCLUDED.deleted,legacy_extra=EXCLUDED.legacy_extra
  `,[x.id,x.residentId,x.residentName||'',x.residentCode||'',x.branchId,x.branchName||'',x.areaId||null,x.areaName||'',x.roomName||'',x.bedName||'',x.type||'CARE_INSTRUCTION',x.morning||'',x.noon||'',x.evening||'',x.status||'ACTIVE',x.source||'CARE_INSTRUCTION',x.createdBy||null,x.createdByName||'',x.createdAt||null,x.updatedBy||null,x.updatedAt||null,x.stoppedBy||null,x.stoppedAt||null,x.stopReason||null,!!x.deleted,JSON.stringify(strip(x))]);}

  for(const x of store.handovers||[]){await db.query(`
    INSERT INTO handovers(id,shift_id,branch_id,version,summary_note,confirmed_by,confirmed_by_name_cache,confirmed_at,received_by,received_by_name_cache,received_at,legacy_extra,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,NOW())
    ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,summary_note=EXCLUDED.summary_note,confirmed_by=EXCLUDED.confirmed_by,confirmed_by_name_cache=EXCLUDED.confirmed_by_name_cache,confirmed_at=EXCLUDED.confirmed_at,received_by=EXCLUDED.received_by,received_by_name_cache=EXCLUDED.received_by_name_cache,received_at=EXCLUDED.received_at,legacy_extra=EXCLUDED.legacy_extra,updated_at=NOW()
  `,[x.id,x.shiftId,x.branchId,x.version||1,x.summaryNote||'',x.confirmedBy||null,x.confirmedByName||'',x.confirmedAt||null,x.receivedBy||null,x.receivedByName||'',x.receivedAt||null,JSON.stringify(strip(x,['participants']))]);await db.query(`DELETE FROM handover_signatures WHERE handover_id=$1`,[x.id]);for(const p of x.participants||[]){const staffId=String(p.staffId||p.userId||'');if(!staffId||!await db.query(`SELECT 1 FROM staff_members WHERE id=$1`,[staffId]).then(r=>r.rowCount))continue;await db.query(`INSERT INTO handover_signatures(handover_id,staff_id,user_id,username_cache,employee_code_cache,full_name_cache,acknowledged,acknowledged_at,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[x.id,staffId,p.actualUserId||null,p.username||'',p.employeeCode||'',p.fullName||'',p.acknowledged!==false,p.acknowledgedAt||null,p.recordedBy||null])}}

  for(const x of store.auditLogs||[]){await ensureBranch(db,x.branchId,'');await db.query(`INSERT INTO audit_logs(id,actor_id,actor_name,role,branch_id,action,object_type,object_id,detail,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,COALESCE($10::timestamptz,NOW())) ON CONFLICT(id) DO NOTHING`,[x.id,x.actorId||null,x.actorName||'',x.role||'',x.branchId||null,x.action||'',x.objectType||'',x.objectId||null,JSON.stringify(x.detail||{}),x.occurredAt||null]);}
  return [...objectsToDelete];
}

export async function updateStore(mutator) {
  invalidateStoreCache();
  if (!await middlewareSchemaReady()) {
    const operation=queue.then(async()=>{const store=await readJson('store.json',clone(DEFAULT_STORE));const result=await mutator(store);await writeJson('store.json',store);return result});
    queue=operation.then(()=>undefined,()=>undefined);
    return operation;
  }
  const operation=queue.then(async()=>{
    const committed=await withTransaction(async db=>{
      const store=await getStore();
      const result=await mutator(store);
      const objectsToDelete=await persistStore(db,store);
      return {result,objectsToDelete};
    });
    for(const objectKey of committed.objectsToDelete||[]){
      try{await deleteWoundImageObject(objectKey)}catch(error){console.error(`[MEDIA] orphan cleanup failed ${objectKey}:`,error?.message||error)}
    }
    invalidateStoreCache();
    return committed.result;
  });
  queue=operation.then(()=>undefined,()=>undefined);
  return operation;
}
