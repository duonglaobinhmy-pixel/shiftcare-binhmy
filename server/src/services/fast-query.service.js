import { v4 as uuid } from 'uuid';
import { getPool, middlewareSchemaReady, withTransaction } from './db.service.js';
import { getSignedWoundImageUrl } from './media-storage.service.js';
import { canViewScopedRow, effectiveAreaId, effectiveBranchId } from '../config/access.js';

const iso = value => value ? new Date(value).toISOString() : null;
const dateOnly = value => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

async function ready(){
  try{return await middlewareSchemaReady()}catch{return false}
}

function mapStaffJson(raw){
  const list=Array.isArray(raw)?raw:[];
  return list.filter(Boolean).map(x=>({
    id:String(x.id||''),userId:x.userId||null,username:x.username||'',employeeCode:x.employeeCode||'',fullName:x.fullName||'',role:x.role||'STAFF',areaId:x.areaId||null,areaName:x.areaName||''
  }));
}

function mapShiftRow(x){
  const assignedStaff=mapStaffJson(x.assigned_staff);
  const primary=assignedStaff.find(p=>p.id===x.primary_recorder_staff_id)||null;
  return {
    id:x.id,shiftDate:dateOnly(x.shift_date),shiftType:x.shift_type,status:x.status,
    branchId:x.branch_id,branchName:x.branch_name_cache||'',areaId:x.area_id_cache,areaName:x.area_name_cache||'',roomId:x.room_id_cache,
    assignedStaffIds:assignedStaff.map(p=>p.id),assignedStaff,assignedStaffNames:assignedStaff.map(p=>p.fullName),
    assignedStaffId:primary?.id||'',assignedStaffName:primary?.fullName||'',primaryRecorderId:primary?.id||'',primaryRecorderName:primary?.fullName||'',primaryRecorderCode:primary?.employeeCode||'',
    residentCount:Number(x.resident_count||0),autoCreated:!!x.auto_created,createdBy:x.created_by,createdAt:iso(x.created_at),staffUpdatedBy:x.staff_updated_by,staffUpdatedAt:iso(x.staff_updated_at),lockedBy:x.locked_by,lockedAt:iso(x.locked_at)
  };
}

function scopeShift(user,shift){
  if(!canViewScopedRow(user,shift)) return false;
  if(user.role==='CAREGIVER' && shift.assignedStaff?.length){
    return shift.assignedStaff.some(x=>String(x.userId||'')===String(user.sub)||String(x.id||'')===String(user.sub));
  }
  return true;
}

export async function getStaffOptionsFast(branchId){
  if(!await ready())return null;
  const r=await getPool().query(`
    SELECT sm.id,sm.user_id,u.username,sm.employee_code,sm.full_name,COALESCE(u.role,sm.role_cache,'STAFF') role,
           sm.area_id_cache,sm.area_name_cache
    FROM staff_members sm
    LEFT JOIN users u ON u.id=sm.user_id
    WHERE sm.branch_id=$1 AND sm.deleted=FALSE AND sm.active IS DISTINCT FROM FALSE
    ORDER BY sm.full_name,sm.employee_code
  `,[String(branchId)]);
  return r.rows.map(x=>({id:x.id,userId:x.user_id||null,username:x.username||'',employeeCode:x.employee_code||'',fullName:x.full_name||'',role:x.role||'STAFF',areaId:x.area_id_cache||null,areaName:x.area_name_cache||''}));
}

export async function getShiftsFast(user){
  if(!await ready())return null;
  const params=[];let where='1=1';
  if(user.role!=='ADMIN'){params.push(String(user.branchId||''));where+=` AND s.branch_id=$${params.length}`}
  const r=await getPool().query(`
    SELECT s.*,
      COUNT(DISTINCT sr.id) AS resident_count,
      COALESCE(json_agg(DISTINCT jsonb_build_object(
        'id',sm.id,'userId',sm.user_id,'username',u.username,'employeeCode',sm.employee_code,'fullName',sm.full_name,'role',COALESCE(u.role,sm.role_cache,'STAFF'),'areaId',sm.area_id_cache,'areaName',sm.area_name_cache
      )) FILTER (WHERE sm.id IS NOT NULL),'[]'::json) AS assigned_staff
    FROM shifts s
    LEFT JOIN shift_staff ss ON ss.shift_id=s.id
    LEFT JOIN staff_members sm ON sm.id=ss.staff_id
    LEFT JOIN users u ON u.id=sm.user_id
    LEFT JOIN shift_residents sr ON sr.shift_id=s.id
    WHERE ${where}
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `,params);
  return r.rows.map(mapShiftRow).filter(x=>scopeShift(user,x));
}

export async function getShiftDetailFast(user,id){
  if(!await ready())return null;
  const shifts=await getShiftsFast(user);const shift=shifts.find(x=>x.id===String(id));
  if(!shift)return {notFound:true};
  const db=getPool();
  const [rr,cr,tr]=await Promise.all([
    db.query(`SELECT * FROM shift_residents WHERE shift_id=$1 ORDER BY full_name_snapshot`,[id]),
    db.query(`SELECT c.*,v.pulse,v.temperature,v.bp_sys,v.bp_dia,v.spo2,v.respiratory_rate,v.concern,v.alert_level,v.alerts,v.urgent FROM care_records c LEFT JOIN care_record_vitals v ON v.care_record_id=c.id WHERE c.shift_id=$1 AND c.deleted=FALSE ORDER BY c.occurred_at DESC`,[id]),
    db.query(`SELECT * FROM toileting_logs WHERE shift_id=$1 AND deleted=FALSE ORDER BY created_at DESC`,[id])
  ]);
  const images=cr.rows.length?await db.query(`SELECT * FROM care_record_images WHERE care_record_id=ANY($1::text[]) ORDER BY created_at`,[cr.rows.map(x=>x.id)]):{rows:[]};
  const imgMap=new Map();for(const i of images.rows){const a=imgMap.get(i.care_record_id)||[];let url=null;if(i.object_key){try{url=await getSignedWoundImageUrl(i.object_key,900)}catch{}}a.push({id:i.id,objectKey:i.object_key||null,dataUrl:url,url,mimeType:i.mime_type||'',sizeBytes:i.size_bytes||null,createdAt:iso(i.created_at),expiresAt:iso(i.expires_at)});imgMap.set(i.care_record_id,a)}
  const residents=rr.rows.map(x=>({id:x.id,shiftId:x.shift_id,residentId:x.bcare_resident_id,code:x.code_snapshot,fullName:x.full_name_snapshot,branchId:x.branch_id,branchName:x.branch_name_snapshot,areaId:x.area_id_snapshot,areaName:x.area_name_snapshot,roomId:x.room_id_snapshot,roomName:x.room_name_snapshot,bedName:x.bed_name_snapshot,image:x.image_snapshot,derivedStatus:x.derived_status}));
  const changes=cr.rows.map(mapCareRow).map(x=>({...x,woundImages:imgMap.get(x.id)||[]}));
  const toileting=tr.rows.map(mapToiletRow);
  const openIds=new Set(changes.filter(x=>x.attentionLevel&&x.attentionStatus==='OPEN').map(x=>x.residentId));
  return {shift,residents,changes,toileting,alerts:residents.filter(x=>openIds.has(x.residentId))};
}

function mapCareRow(x){
  const vitals=(x.pulse!=null||x.temperature!=null||x.bp_sys!=null||x.bp_dia!=null||x.spo2!=null||x.respiratory_rate!=null||x.alert_level)?{
    pulse:x.pulse==null?null:Number(x.pulse),temperature:x.temperature==null?null:Number(x.temperature),bpSys:x.bp_sys==null?null:Number(x.bp_sys),bpDia:x.bp_dia==null?null:Number(x.bp_dia),spo2:x.spo2==null?null:Number(x.spo2),respiratoryRate:x.respiratory_rate==null?null:Number(x.respiratory_rate),concern:!!x.concern,alertLevel:x.alert_level||'NORMAL',alerts:x.alerts||[],urgent:x.urgent||null
  }:null;
  return {id:x.id,clientRequestId:x.client_request_id||'',shiftId:x.shift_id,residentId:x.bcare_resident_id,residentName:x.resident_name_snapshot||'',category:x.category,eventType:x.event_type,priority:x.priority,occurredAt:iso(x.occurred_at),content:x.content||'',intervention:x.intervention||'',notifiedTo:x.notified_to||'',requiresHandover:!!x.requires_handover,followUp:x.follow_up||'',branchId:x.branch_id,branchName:x.branch_name_snapshot||'',areaId:x.area_id_snapshot,areaName:x.area_name_snapshot||'',roomName:x.room_name_snapshot||'',bedName:x.bed_name_snapshot||'',image:x.image_snapshot||'',createdBy:x.created_by,createdByName:x.created_by_name_cache||'',createdAt:iso(x.created_at),updatedBy:x.updated_by,updatedByName:x.updated_by_name_cache||'',updatedAt:iso(x.updated_at),attentionLevel:x.attention_level||null,attentionStatus:x.attention_level?(x.attention_status==='RESOLVED'?'RESOLVED':'OPEN'):null,attentionResolvedAt:iso(x.attention_resolved_at),attentionResolvedBy:x.attention_resolved_by,vitals,woundImages:[]};
}
function mapToiletRow(x){return{id:x.id,clientRequestId:x.client_request_id||'',shiftId:x.shift_id,residentId:x.bcare_resident_id,residentName:x.resident_name_snapshot||'',bowelStatus:x.bowel_status,urineStatus:x.urine_status,urineDetail:x.urine_detail||'',note:x.note||'',branchId:x.branch_id,areaId:x.area_id_snapshot,areaName:x.area_name_snapshot||'',roomName:x.room_name_snapshot||'',bedName:x.bed_name_snapshot||'',image:x.image_snapshot||'',createdBy:x.created_by,createdByName:x.created_by_name_cache||'',createdAt:iso(x.created_at),updatedBy:x.updated_by,updatedAt:iso(x.updated_at)}}

export async function getReportBundleFast(user,{from,to,branchId=''}){
  if(!await ready())return null;
  const effectiveBranch=effectiveBranchId(user,branchId);
  const areaScope=effectiveAreaId(user);
  const db=getPool();

  const shiftParams=[from,to];
  let shiftWhere=`s.shift_date BETWEEN $1::date AND $2::date`;
  if(effectiveBranch){shiftParams.push(effectiveBranch);shiftWhere+=` AND s.branch_id=$${shiftParams.length}`}
  if(areaScope){shiftParams.push(areaScope);shiftWhere+=` AND (s.area_id_cache IS NULL OR s.area_id_cache=$${shiftParams.length})`}

  const sr=await db.query(`
    SELECT s.*,COUNT(DISTINCT r.id) resident_count,
      COALESCE(json_agg(DISTINCT jsonb_build_object(
        'id',sm.id,'userId',sm.user_id,'username',u.username,
        'employeeCode',sm.employee_code,'fullName',sm.full_name,
        'role',COALESCE(u.role,sm.role_cache,'STAFF'),
        'areaId',sm.area_id_cache,'areaName',sm.area_name_cache
      )) FILTER (WHERE sm.id IS NOT NULL),'[]'::json) assigned_staff
    FROM shifts s
    LEFT JOIN shift_staff ss ON ss.shift_id=s.id
    LEFT JOIN staff_members sm ON sm.id=ss.staff_id
    LEFT JOIN users u ON u.id=sm.user_id
    LEFT JOIN shift_residents r ON r.shift_id=s.id
    WHERE ${shiftWhere}
    GROUP BY s.id
    ORDER BY s.shift_date DESC,s.created_at DESC
  `,shiftParams);

  const shifts=sr.rows.map(mapShiftRow).filter(x=>scopeShift(user,x));
  const shiftIds=shifts.map(x=>x.id);
  let residentRows=[];
  let handoverRows=[];
  if(shiftIds.length){
    const [rr,hr]=await Promise.all([
      db.query(`SELECT * FROM shift_residents WHERE shift_id=ANY($1::text[])`,[shiftIds]),
      db.query(`SELECT * FROM handovers WHERE shift_id=ANY($1::text[])`,[shiftIds])
    ]);
    residentRows=rr.rows;
    handoverRows=hr.rows;
  }

  const careParams=[from,to];
  let careWhere=`c.deleted=FALSE AND c.occurred_at >= $1::date AND c.occurred_at < ($2::date + INTERVAL '1 day')`;
  if(effectiveBranch){careParams.push(effectiveBranch);careWhere+=` AND c.branch_id=$${careParams.length}`}
  if(areaScope){careParams.push(areaScope);careWhere+=` AND (c.area_id_snapshot IS NULL OR c.area_id_snapshot=$${careParams.length})`}

  const toiletParams=[from,to];
  let toiletWhere=`t.deleted=FALSE AND t.created_at >= $1::date AND t.created_at < ($2::date + INTERVAL '1 day')`;
  if(effectiveBranch){toiletParams.push(effectiveBranch);toiletWhere+=` AND t.branch_id=$${toiletParams.length}`}
  if(areaScope){toiletParams.push(areaScope);toiletWhere+=` AND (t.area_id_snapshot IS NULL OR t.area_id_snapshot=$${toiletParams.length})`}

  const [cr,tr]=await Promise.all([
    db.query(`SELECT c.*,v.pulse,v.temperature,v.bp_sys,v.bp_dia,v.spo2,v.respiratory_rate,v.concern,v.alert_level,v.alerts,v.urgent FROM care_records c LEFT JOIN care_record_vitals v ON v.care_record_id=c.id WHERE ${careWhere} ORDER BY c.occurred_at DESC`,careParams),
    db.query(`SELECT t.* FROM toileting_logs t WHERE ${toiletWhere} ORDER BY t.created_at DESC`,toiletParams)
  ]);

  const changes=cr.rows.map(mapCareRow),careIds=cr.rows.map(x=>x.id);
  if(careIds.length){
    const ir=await db.query(`SELECT * FROM care_record_images WHERE care_record_id=ANY($1::text[]) ORDER BY created_at`,[careIds]);
    const im=new Map();
    for(const i of ir.rows){
      const a=im.get(i.care_record_id)||[];
      let url=null;
      if(i.object_key){try{url=await getSignedWoundImageUrl(i.object_key,900)}catch{}}
      a.push({id:i.id,objectKey:i.object_key||null,dataUrl:url,url,mimeType:i.mime_type||''});
      im.set(i.care_record_id,a);
    }
    for(const c of changes)c.woundImages=im.get(c.id)||[];
  }

  const residents=residentRows.map(x=>({id:x.id,shiftId:x.shift_id,residentId:x.bcare_resident_id,code:x.code_snapshot,fullName:x.full_name_snapshot,branchId:x.branch_id,branchName:x.branch_name_snapshot,areaId:x.area_id_snapshot,areaName:x.area_name_snapshot,roomId:x.room_id_snapshot,roomName:x.room_name_snapshot,bedName:x.bed_name_snapshot,image:x.image_snapshot,derivedStatus:x.derived_status}));
  const toilets=tr.rows.map(mapToiletRow);

  const outstandingParams=[];
  let outstandingWhere=`c.deleted=FALSE AND c.attention_level IN ('RED','YELLOW') AND COALESCE(c.attention_status,'OPEN')<>'RESOLVED'`;
  if(effectiveBranch){outstandingParams.push(effectiveBranch);outstandingWhere+=` AND c.branch_id=$${outstandingParams.length}`}
  if(areaScope){outstandingParams.push(areaScope);outstandingWhere+=` AND (c.area_id_snapshot IS NULL OR c.area_id_snapshot=$${outstandingParams.length})`}
  const or=await db.query(`SELECT c.*,v.pulse,v.temperature,v.bp_sys,v.bp_dia,v.spo2,v.respiratory_rate,v.concern,v.alert_level,v.alerts,v.urgent FROM care_records c LEFT JOIN care_record_vitals v ON v.care_record_id=c.id WHERE ${outstandingWhere} ORDER BY CASE c.attention_level WHEN 'RED' THEN 0 ELSE 1 END,c.occurred_at DESC LIMIT 500`,outstandingParams);

  return {shifts,residents,changes,toilets,handovers:handoverRows.map(x=>({id:x.id,shiftId:x.shift_id,confirmedAt:iso(x.confirmed_at),receivedAt:iso(x.received_at)})),outstanding:or.rows.map(mapCareRow)};
}

export async function getDashboardBundleFast(user,date){
  return getReportBundleFast(user,{from:date,to:date,branchId:''});
}

export async function getStaffReportBundleFast(user,{from,to,branchId=''}){
  if(!await ready())return null;
  const effectiveBranch=effectiveBranchId(user,branchId);
  const areaScope=effectiveAreaId(user);
  const db=getPool();

  const shiftParams=[from,to];
  let shiftWhere=`s.shift_date BETWEEN $1::date AND $2::date`;
  if(effectiveBranch){shiftParams.push(effectiveBranch);shiftWhere+=` AND s.branch_id=$${shiftParams.length}`}
  if(areaScope){shiftParams.push(areaScope);shiftWhere+=` AND (s.area_id_cache IS NULL OR s.area_id_cache=$${shiftParams.length})`}
  const sr=await db.query(`SELECT s.*,COUNT(DISTINCT r.id) resident_count,COALESCE(json_agg(DISTINCT jsonb_build_object('id',sm.id,'userId',sm.user_id,'username',u.username,'employeeCode',sm.employee_code,'fullName',sm.full_name,'role',COALESCE(u.role,sm.role_cache,'STAFF'),'areaId',sm.area_id_cache,'areaName',sm.area_name_cache)) FILTER (WHERE sm.id IS NOT NULL),'[]'::json) assigned_staff FROM shifts s LEFT JOIN shift_staff ss ON ss.shift_id=s.id LEFT JOIN staff_members sm ON sm.id=ss.staff_id LEFT JOIN users u ON u.id=sm.user_id LEFT JOIN shift_residents r ON r.shift_id=s.id WHERE ${shiftWhere} GROUP BY s.id ORDER BY s.shift_date DESC,s.created_at DESC`,shiftParams);
  const shifts=sr.rows.map(mapShiftRow).filter(x=>scopeShift(user,x));
  const shiftIds=shifts.map(x=>x.id);

  const careParams=[from,to];
  let careWhere=`c.deleted=FALSE AND c.occurred_at >= $1::date AND c.occurred_at < ($2::date + INTERVAL '1 day')`;
  if(effectiveBranch){careParams.push(effectiveBranch);careWhere+=` AND c.branch_id=$${careParams.length}`}
  if(areaScope){careParams.push(areaScope);careWhere+=` AND (c.area_id_snapshot IS NULL OR c.area_id_snapshot=$${careParams.length})`}

  const [cr,dir,hr]=await Promise.all([
    db.query(`SELECT c.*,v.pulse,v.temperature,v.bp_sys,v.bp_dia,v.spo2,v.respiratory_rate,v.concern,v.alert_level,v.alerts,v.urgent FROM care_records c LEFT JOIN care_record_vitals v ON v.care_record_id=c.id WHERE ${careWhere} ORDER BY c.occurred_at DESC`,careParams),
    db.query(`SELECT sm.id,sm.user_id,u.username,sm.employee_code,sm.full_name,sm.branch_id,br.name_cache branch_name,COALESCE(u.role,sm.role_cache,'STAFF') role FROM staff_members sm LEFT JOIN users u ON u.id=sm.user_id LEFT JOIN bcare_branches_ref br ON br.bcare_branch_id=sm.branch_id WHERE sm.deleted=FALSE AND sm.active IS DISTINCT FROM FALSE ${effectiveBranch?'AND sm.branch_id=$1':''} ORDER BY sm.full_name`,effectiveBranch?[effectiveBranch]:[]),
    shiftIds.length?db.query(`SELECT * FROM handovers WHERE shift_id=ANY($1::text[])`,[shiftIds]):Promise.resolve({rows:[]})
  ]);

  return {shifts,changes:cr.rows.map(mapCareRow),handovers:hr.rows.map(x=>({id:x.id,shiftId:x.shift_id,confirmedAt:iso(x.confirmed_at),receivedAt:iso(x.received_at)})),staffDirectory:dir.rows.map(x=>({id:String(x.id),userId:x.user_id||null,username:x.username||'',employeeCode:x.employee_code||'',fullName:x.full_name||'',branchId:x.branch_id||'',branchName:x.branch_name||'',role:x.role||'STAFF'}))};
}

export async function createShiftFast(user,body,{branchName='',assignedStaff=[],primaryRecorder}={}){
  if(!await ready())return null;
  const id=uuid();const shiftDate=dateOnly(body.shiftDate)||dateOnly(new Date());
  await withTransaction(async db=>{
    await db.query(`INSERT INTO bcare_branches_ref(bcare_branch_id,name_cache,last_synced_at) VALUES($1,$2,NOW()) ON CONFLICT(bcare_branch_id) DO UPDATE SET name_cache=COALESCE(NULLIF(EXCLUDED.name_cache,''),bcare_branches_ref.name_cache),last_synced_at=NOW()`,[String(body.branchId),String(branchName||'')]);
    await db.query(`INSERT INTO shifts(id,shift_date,shift_type,status,branch_id,branch_name_cache,area_id_cache,area_name_cache,room_id_cache,primary_recorder_staff_id,auto_created,created_by,created_at) VALUES($1,$2,$3,'OPEN',$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,[id,shiftDate,body.shiftType,body.branchId,branchName,body.areaId||null,body.areaName||'',body.roomId||null,primaryRecorder.id,!!body.autoCreated,user.sub]);
    for(const p of assignedStaff)await db.query(`INSERT INTO shift_staff(shift_id,staff_id,is_primary_recorder) VALUES($1,$2,$3)`,[id,p.id,p.id===primaryRecorder.id]);
  });
  return {id,shiftDate,shiftType:body.shiftType,status:'OPEN',branchId:body.branchId,branchName,areaId:body.areaId||null,areaName:body.areaName||'',roomId:body.roomId||null,assignedStaffIds:assignedStaff.map(x=>x.id),assignedStaff,assignedStaffNames:assignedStaff.map(x=>x.fullName),assignedStaffId:primaryRecorder.id,assignedStaffName:primaryRecorder.fullName,primaryRecorderId:primaryRecorder.id,primaryRecorderName:primaryRecorder.fullName,primaryRecorderCode:primaryRecorder.employeeCode,autoCreated:!!body.autoCreated,createdBy:user.sub,createdAt:new Date().toISOString()};
}

export async function updateShiftStaffFast(id,user,{assignedStaff,primaryRecorder}){
  if(!await ready())return null;
  await withTransaction(async db=>{await db.query(`DELETE FROM shift_staff WHERE shift_id=$1`,[id]);for(const p of assignedStaff)await db.query(`INSERT INTO shift_staff(shift_id,staff_id,is_primary_recorder) VALUES($1,$2,$3)`,[id,p.id,p.id===primaryRecorder.id]);await db.query(`UPDATE shifts SET primary_recorder_staff_id=$2,staff_updated_by=$3,staff_updated_at=NOW() WHERE id=$1`,[id,primaryRecorder.id,user.sub])});
  return true;
}

export async function replaceShiftRosterFast(shift,items){
  if(!await ready())return null;
  await withTransaction(async db=>{
    await db.query(`DELETE FROM shift_residents WHERE shift_id=$1`,[shift.id]);
    for(const r of items){
      await db.query(`INSERT INTO bcare_branches_ref(bcare_branch_id,name_cache,last_synced_at) VALUES($1,$2,NOW()) ON CONFLICT(bcare_branch_id) DO UPDATE SET name_cache=COALESCE(NULLIF(EXCLUDED.name_cache,''),bcare_branches_ref.name_cache),last_synced_at=NOW()`,[String(r.branchId||shift.branchId),String(r.branchName||shift.branchName||'')]);
      await db.query(`INSERT INTO bcare_residents_ref(bcare_resident_id,code_cache,full_name_cache,branch_id,area_id_cache,area_name_cache,room_id_cache,room_name_cache,bed_name_cache,image_cache,last_synced_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) ON CONFLICT(bcare_resident_id) DO UPDATE SET code_cache=EXCLUDED.code_cache,full_name_cache=EXCLUDED.full_name_cache,branch_id=EXCLUDED.branch_id,area_id_cache=EXCLUDED.area_id_cache,area_name_cache=EXCLUDED.area_name_cache,room_id_cache=EXCLUDED.room_id_cache,room_name_cache=EXCLUDED.room_name_cache,bed_name_cache=EXCLUDED.bed_name_cache,image_cache=EXCLUDED.image_cache,last_synced_at=NOW()`,[String(r.id),String(r.code||''),String(r.fullName||''),String(r.branchId||shift.branchId),r.areaId?String(r.areaId):null,String(r.areaName||''),r.roomId?String(r.roomId):null,String(r.roomName||''),String(r.bedName||''),String(r.image||'')]);
      await db.query(`INSERT INTO shift_residents(id,shift_id,bcare_resident_id,code_snapshot,full_name_snapshot,branch_id,branch_name_snapshot,area_id_snapshot,area_name_snapshot,room_id_snapshot,room_name_snapshot,bed_name_snapshot,image_snapshot,derived_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'NO_RECORDED_CHANGE') ON CONFLICT(shift_id,bcare_resident_id) DO NOTHING`,[uuid(),shift.id,String(r.id),String(r.code||''),String(r.fullName||''),String(r.branchId||shift.branchId),String(r.branchName||shift.branchName||''),r.areaId?String(r.areaId):null,String(r.areaName||''),r.roomId?String(r.roomId):null,String(r.roomName||''),String(r.bedName||''),String(r.image||'')]);
    }
  });
  return items.length;
}

export async function deleteShiftFast(user,id){
  if(!await ready())return null;
  return withTransaction(async db=>{
    const sr=await db.query(`SELECT * FROM shifts WHERE id=$1`,[id]);if(!sr.rowCount)return {notFound:true};const shift=sr.rows[0];
    if(user.role!=='ADMIN'&&String(shift.branch_id)!==String(user.branchId||''))return {notFound:true};
    const c=await db.query(`SELECT (SELECT COUNT(*) FROM care_records WHERE shift_id=$1)::int changes,(SELECT COUNT(*) FROM toileting_logs WHERE shift_id=$1)::int toileting,(SELECT COUNT(*) FROM handovers WHERE shift_id=$1)::int handovers`,[id]);const counts=c.rows[0];
    if((counts.changes||counts.toileting||counts.handovers)&&user.role!=='ADMIN')return {blocked:true,counts};
    await db.query(`DELETE FROM shifts WHERE id=$1`,[id]);
    return {deleted:true,counts,shift:{id,shiftDate:dateOnly(shift.shift_date),shiftType:shift.shift_type,branchId:shift.branch_id}};
  });
}
