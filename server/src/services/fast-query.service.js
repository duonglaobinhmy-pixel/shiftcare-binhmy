import { v4 as uuid } from 'uuid';
import { getPool, middlewareSchemaReady, withTransaction } from './db.service.js';
import { getSignedWoundImageUrl } from './media-storage.service.js';

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
    id:String(x.id||''),userId:x.userId||null,username:x.username||'',employeeCode:x.employeeCode||'',fullName:x.fullName||'',role:x.role||'STAFF',areaId:x.areaId||null,areaName:x.areaName||'',isPrimary:!!x.isPrimary
  }));
}

function mapShiftRow(x){
  const assignedStaff=mapStaffJson(x.assigned_staff);
  const primary=assignedStaff.find(p=>p.isPrimary)||null;
  return {
    id:x.id,shiftDate:dateOnly(x.shift_date),shiftType:x.shift_type,status:x.status,
    branchId:x.branch_id,branchName:x.branch_name_cache||'',areaId:x.area_id_cache,areaName:x.area_name_cache||'',roomId:x.room_id_cache,
    assignedStaffIds:assignedStaff.map(p=>p.id),assignedStaff,assignedStaffNames:assignedStaff.map(p=>p.fullName),
    assignedStaffId:primary?.id||'',assignedStaffName:primary?.fullName||'',primaryRecorderId:primary?.id||'',primaryRecorderName:primary?.fullName||'',primaryRecorderCode:primary?.employeeCode||'',
    residentCount:Number(x.resident_count||0),autoCreated:!!x.auto_created,createdBy:x.created_by,createdAt:iso(x.created_at),staffUpdatedBy:x.staff_updated_by,staffUpdatedAt:iso(x.staff_updated_at),lockedBy:x.locked_by,lockedAt:iso(x.locked_at)
  };
}

function scopeShift(user,shift){
  if(user.role==='ADMIN') return true;
  return !shift.branchId || String(shift.branchId)===String(user.branchId||'');
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
        'id',sm.id,'userId',sm.user_id,'username',u.username,'employeeCode',sm.employee_code,'fullName',sm.full_name,'role',COALESCE(u.role,sm.role_cache,'STAFF'),'areaId',sm.area_id_cache,'areaName',sm.area_name_cache,'isPrimary',ss.is_primary_recorder
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
    db.query(`SELECT c.*,v.pulse,v.temperature,v.bp_sys,v.bp_dia,v.spo2,v.respiratory_rate,v.concern,v.alert_level,v.alerts,v.urgent,v.blood_glucose,v.insulin_dose_units FROM care_records c LEFT JOIN care_record_vitals v ON v.care_record_id=c.id WHERE c.shift_id=$1 AND c.deleted=FALSE ORDER BY c.occurred_at DESC`,[id]),
    db.query(`SELECT * FROM toileting_logs WHERE shift_id=$1 AND deleted=FALSE ORDER BY created_at DESC`,[id])
  ]);
  const images=cr.rows.length?await db.query(`SELECT * FROM care_record_images WHERE care_record_id=ANY($1::text[]) ORDER BY created_at`,[cr.rows.map(x=>x.id)]):{rows:[]};
  const events=cr.rows.length?await db.query(`SELECT care_record_id,event_code FROM care_record_events WHERE care_record_id=ANY($1::text[]) ORDER BY id`,[cr.rows.map(x=>x.id)]):{rows:[]};
  const eventMap=new Map();for(const event of events.rows){const codes=eventMap.get(event.care_record_id)||[];codes.push(event.event_code);eventMap.set(event.care_record_id,codes)}
  const categories=cr.rows.length?await db.query(`SELECT care_record_id,category_code FROM care_record_categories WHERE care_record_id=ANY($1::text[]) ORDER BY category_code`,[cr.rows.map(x=>x.id)]):{rows:[]};
  const categoryMap=new Map();for(const category of categories.rows){const codes=categoryMap.get(category.care_record_id)||[];codes.push(category.category_code);categoryMap.set(category.care_record_id,codes)}
  const imgMap=new Map();for(const i of images.rows){const a=imgMap.get(i.care_record_id)||[];let url=null;if(i.object_key){try{url=await getSignedWoundImageUrl(i.object_key,900)}catch{}}a.push({id:i.id,objectKey:i.object_key||null,dataUrl:url,url,mimeType:i.mime_type||'',sizeBytes:i.size_bytes||null,createdAt:iso(i.created_at),expiresAt:iso(i.expires_at)});imgMap.set(i.care_record_id,a)}
  const residents=rr.rows.map(x=>({id:x.id,shiftId:x.shift_id,residentId:x.bcare_resident_id,code:x.code_snapshot,fullName:x.full_name_snapshot,branchId:x.branch_id,branchName:x.branch_name_snapshot,areaId:x.area_id_snapshot,areaName:x.area_name_snapshot,roomId:x.room_id_snapshot,roomName:x.room_name_snapshot,bedName:x.bed_name_snapshot,image:x.image_snapshot,derivedStatus:x.derived_status}));
  const changes=cr.rows.map(mapCareRow).map(x=>({...x,eventCodes:eventMap.get(x.id)||[x.eventType],categoryCodes:categoryMap.get(x.id)||[x.category],woundImages:imgMap.get(x.id)||[]}));
  const toileting=tr.rows.map(mapToiletRow);
  const openIds=new Set(changes.filter(x=>x.attentionLevel&&x.attentionStatus==='OPEN').map(x=>x.residentId));
  return {shift,residents,changes,toileting,alerts:residents.filter(x=>openIds.has(x.residentId))};
}

function mapCareRow(x){
  const vitals=(x.pulse!=null||x.temperature!=null||x.bp_sys!=null||x.bp_dia!=null||x.spo2!=null||x.respiratory_rate!=null||x.blood_glucose!=null||x.insulin_dose_units!=null||x.alert_level)?{
    pulse:x.pulse==null?null:Number(x.pulse),temperature:x.temperature==null?null:Number(x.temperature),bpSys:x.bp_sys==null?null:Number(x.bp_sys),bpDia:x.bp_dia==null?null:Number(x.bp_dia),spo2:x.spo2==null?null:Number(x.spo2),respiratoryRate:x.respiratory_rate==null?null:Number(x.respiratory_rate),bloodGlucose:x.blood_glucose==null?null:Number(x.blood_glucose),insulinDoseUnits:x.insulin_dose_units==null?null:Number(x.insulin_dose_units),concern:!!x.concern,alertLevel:x.alert_level||'NORMAL',alerts:x.alerts||[],urgent:x.urgent||null
  }:null;
  return {id:x.id,clientRequestId:x.client_request_id||'',shiftId:x.shift_id,residentId:x.bcare_resident_id,residentName:x.resident_name_snapshot||'',category:x.category,categoryCodes:Array.isArray(x.legacy_extra?.categoryCodes)&&x.legacy_extra.categoryCodes.length?x.legacy_extra.categoryCodes:[x.category],eventType:x.event_type,residentStatus:x.resident_status||'IN_FACILITY',eventCodes:[x.event_type],priority:x.priority,occurredAt:iso(x.occurred_at),content:x.content||'',intervention:x.intervention||'',notifiedTo:x.notified_to||'',requiresHandover:!!x.requires_handover,followUp:x.follow_up||'',branchId:x.branch_id,branchName:x.branch_name_snapshot||'',areaId:x.area_id_snapshot,areaName:x.area_name_snapshot||'',roomName:x.room_name_snapshot||'',bedName:x.bed_name_snapshot||'',image:x.image_snapshot||'',createdBy:x.created_by,createdByName:x.created_by_name_cache||'',createdAt:iso(x.created_at),updatedBy:x.updated_by,updatedByName:x.updated_by_name_cache||'',updatedAt:iso(x.updated_at),attentionLevel:x.attention_level||null,attentionStatus:x.attention_level?(x.attention_status==='RESOLVED'?'RESOLVED':'OPEN'):null,attentionResolvedAt:iso(x.attention_resolved_at),attentionResolvedBy:x.attention_resolved_by,vitals,woundImages:[]};
}
function mapToiletRow(x){return{id:x.id,clientRequestId:x.client_request_id||'',shiftId:x.shift_id,residentId:x.bcare_resident_id,residentName:x.resident_name_snapshot||'',bowelStatus:x.bowel_status,urineStatus:x.urine_status,urineDetail:x.urine_detail||'',note:x.note||'',branchId:x.branch_id,areaId:x.area_id_snapshot,areaName:x.area_name_snapshot||'',roomName:x.room_name_snapshot||'',bedName:x.bed_name_snapshot||'',image:x.image_snapshot||'',createdBy:x.created_by,createdByName:x.created_by_name_cache||'',createdAt:iso(x.created_at),updatedBy:x.updated_by,updatedAt:iso(x.updated_at)}}

export async function getReportBundleFast(user,{from,to,branchId=''}){
  if(!await ready())return null;
  const effectiveBranch=user.role==='ADMIN'?String(branchId||''):String(user.branchId||'');
  const db=getPool();

  // 1) Lấy phát sinh trước theo ngày Việt Nam.
  const careParams=[from,to];
  let careWhere=`c.deleted=FALSE AND c.occurred_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AND c.occurred_at < ((($2::date + 1)::timestamp) AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
  if(effectiveBranch){careParams.push(effectiveBranch);careWhere+=` AND c.branch_id=$${careParams.length}`}

  const toiletParams=[from,to];
  let toiletWhere=`t.deleted=FALSE AND t.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AND t.created_at < ((($2::date + 1)::timestamp) AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
  if(effectiveBranch){toiletParams.push(effectiveBranch);toiletWhere+=` AND t.branch_id=$${toiletParams.length}`}

  const [cr,tr]=await Promise.all([
    db.query(`SELECT c.*,v.pulse,v.temperature,v.bp_sys,v.bp_dia,v.spo2,v.respiratory_rate,v.concern,v.alert_level,v.alerts,v.urgent,v.blood_glucose,v.insulin_dose_units FROM care_records c LEFT JOIN care_record_vitals v ON v.care_record_id=c.id WHERE ${careWhere} ORDER BY c.occurred_at DESC`,careParams),
    db.query(`SELECT t.* FROM toileting_logs t WHERE ${toiletWhere} ORDER BY t.created_at DESC`,toiletParams)
  ]);

  const changes=cr.rows.map(mapCareRow);
  const toilets=tr.rows.map(mapToiletRow);
  const activityShiftIds=[...new Set([...changes.map(x=>String(x.shiftId||'')),...toilets.map(x=>String(x.shiftId||''))].filter(Boolean))];

  // 2) Ca trong kỳ HOẶC ca đêm hôm trước nhưng có phát sinh trong kỳ.
  const shiftParams=[from,to];
  let shiftWhere=`(s.shift_date BETWEEN $1::date AND $2::date`;
  if(activityShiftIds.length){shiftParams.push(activityShiftIds);shiftWhere+=` OR s.id=ANY($${shiftParams.length}::text[])`}
  shiftWhere+=`)`;
  if(effectiveBranch){shiftParams.push(effectiveBranch);shiftWhere+=` AND s.branch_id=$${shiftParams.length}`}

  const sr=await db.query(`
    SELECT s.*,COUNT(DISTINCT r.id) resident_count,
      COALESCE(json_agg(DISTINCT jsonb_build_object(
        'id',sm.id,'userId',sm.user_id,'username',u.username,
        'employeeCode',sm.employee_code,'fullName',sm.full_name,
        'role',COALESCE(u.role,sm.role_cache,'STAFF'),
        'areaId',sm.area_id_cache,'areaName',sm.area_name_cache,'isPrimary',ss.is_primary_recorder
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

  // 3) Ảnh thêm của các biến động trong kỳ.
  const careIds=cr.rows.map(x=>x.id);
  if(careIds.length){
    const ir=await db.query(`SELECT * FROM care_record_images WHERE care_record_id=ANY($1::text[]) ORDER BY created_at`,[careIds]);
    const im=new Map();
    for(const i of ir.rows){
      const a=im.get(i.care_record_id)||[];
      let url=null;
      if(i.object_key){try{url=await getSignedWoundImageUrl(i.object_key,900)}catch{}}
      a.push({id:i.id,objectKey:i.object_key||null,dataUrl:url,url,mimeType:i.mime_type||'',sizeBytes:i.size_bytes||null,createdAt:iso(i.created_at),expiresAt:iso(i.expires_at)});
      im.set(i.care_record_id,a);
    }
    for(const c of changes)c.woundImages=im.get(c.id)||[];
  }

  const residents=residentRows.map(x=>({id:x.id,shiftId:x.shift_id,residentId:x.bcare_resident_id,code:x.code_snapshot,fullName:x.full_name_snapshot,branchId:x.branch_id,branchName:x.branch_name_snapshot,areaId:x.area_id_snapshot,areaName:x.area_name_snapshot,roomId:x.room_id_snapshot,roomName:x.room_name_snapshot,bedName:x.bed_name_snapshot,image:x.image_snapshot,derivedStatus:x.derived_status}));

  // 4) Cảnh báo còn tồn: cố ý không giới hạn theo ngày để quản lý thấy việc chưa xử lý.
  const outstandingParams=[];
  let outstandingWhere=`c.deleted=FALSE AND c.attention_level IN ('RED','YELLOW') AND COALESCE(c.attention_status,'OPEN')<>'RESOLVED'`;
  if(effectiveBranch){outstandingParams.push(effectiveBranch);outstandingWhere+=` AND c.branch_id=$${outstandingParams.length}`}
  const or=await db.query(`SELECT c.*,v.pulse,v.temperature,v.bp_sys,v.bp_dia,v.spo2,v.respiratory_rate,v.concern,v.alert_level,v.alerts,v.urgent,v.blood_glucose,v.insulin_dose_units FROM care_records c LEFT JOIN care_record_vitals v ON v.care_record_id=c.id WHERE ${outstandingWhere} ORDER BY CASE c.attention_level WHEN 'RED' THEN 0 ELSE 1 END,c.occurred_at DESC LIMIT 500`,outstandingParams);

  return {
    shifts,
    residents,
    changes,
    toilets,
    handovers:handoverRows.map(x=>({id:x.id,shiftId:x.shift_id,confirmedAt:iso(x.confirmed_at),receivedAt:iso(x.received_at)})),
    outstanding:or.rows.map(mapCareRow)
  };
}

export async function getDashboardBundleFast(user,date){
  return getReportBundleFast(user,{from:date,to:date,branchId:''});
}

export async function getStaffReportBundleFast(user,{from,to,branchId=''}){
  if(!await ready())return null;
  const effectiveBranch=user.role==='ADMIN'?String(branchId||''):String(user.branchId||'');
  const db=getPool();

  // 1) Lấy mọi phát sinh theo NGÀY GIỜ VIỆT NAM.
  // Tránh lỗi record 00:00–06:59 giờ VN bị rơi sang ngày UTC hôm trước.
  const careParams=[from,to];
  let careWhere=`c.deleted=FALSE AND c.occurred_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AND c.occurred_at < ((($2::date + 1)::timestamp) AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
  if(effectiveBranch){careParams.push(effectiveBranch);careWhere+=` AND c.branch_id=$${careParams.length}`}

  const toiletParams=[from,to];
  let toiletWhere=`t.deleted=FALSE AND t.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AND t.created_at < ((($2::date + 1)::timestamp) AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
  if(effectiveBranch){toiletParams.push(effectiveBranch);toiletWhere+=` AND t.branch_id=$${toiletParams.length}`}

  const [cr,tr,dir]=await Promise.all([
    db.query(`SELECT c.*,v.pulse,v.temperature,v.bp_sys,v.bp_dia,v.spo2,v.respiratory_rate,v.concern,v.alert_level,v.alerts,v.urgent,v.blood_glucose,v.insulin_dose_units FROM care_records c LEFT JOIN care_record_vitals v ON v.care_record_id=c.id WHERE ${careWhere} ORDER BY c.occurred_at DESC`,careParams),
    db.query(`SELECT t.* FROM toileting_logs t WHERE ${toiletWhere} ORDER BY t.created_at DESC`,toiletParams),
    db.query(`SELECT sm.id,sm.user_id,u.username,sm.employee_code,sm.full_name,sm.branch_id,br.name_cache branch_name,COALESCE(u.role,sm.role_cache,'STAFF') role FROM staff_members sm LEFT JOIN users u ON u.id=sm.user_id LEFT JOIN bcare_branches_ref br ON br.bcare_branch_id=sm.branch_id WHERE sm.deleted=FALSE AND sm.active IS DISTINCT FROM FALSE ${effectiveBranch?'AND sm.branch_id=$1':''} ORDER BY sm.full_name`,effectiveBranch?[effectiveBranch]:[])
  ]);

  const changes=cr.rows.map(mapCareRow);
  const toilets=tr.rows.map(mapToiletRow);
  const activityShiftIds=[...new Set([...changes.map(x=>String(x.shiftId||'')),...toilets.map(x=>String(x.shiftId||''))].filter(Boolean))];

  // 2) Báo cáo nhân viên phải thấy cả:
  // - ca có shift_date nằm trong kỳ; HOẶC
  // - ca đêm hôm trước nhưng có phát sinh trong kỳ đang xem.
  const shiftParams=[from,to];
  let shiftWhere=`(s.shift_date BETWEEN $1::date AND $2::date`;
  if(activityShiftIds.length){shiftParams.push(activityShiftIds);shiftWhere+=` OR s.id=ANY($${shiftParams.length}::text[])`}
  shiftWhere += `)`;
  if(effectiveBranch){shiftParams.push(effectiveBranch);shiftWhere+=` AND s.branch_id=$${shiftParams.length}`}

  const sr=await db.query(`
    SELECT s.*,COUNT(DISTINCT r.id) resident_count,
      COALESCE(json_agg(DISTINCT jsonb_build_object(
        'id',sm.id,'userId',sm.user_id,'username',u.username,
        'employeeCode',sm.employee_code,'fullName',sm.full_name,
        'role',COALESCE(u.role,sm.role_cache,'STAFF'),
        'areaId',sm.area_id_cache,'areaName',sm.area_name_cache,
        'isPrimary',ss.is_primary_recorder
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
  const hr=shiftIds.length?await db.query(`SELECT * FROM handovers WHERE shift_id=ANY($1::text[])`,[shiftIds]):{rows:[]};

  return {
    shifts,
    changes,
    toilets,
    handovers:hr.rows.map(x=>({id:x.id,shiftId:x.shift_id,confirmedAt:iso(x.confirmed_at),receivedAt:iso(x.received_at)})),
    staffDirectory:dir.rows.map(x=>({id:String(x.id),userId:x.user_id||null,username:x.username||'',employeeCode:x.employee_code||'',fullName:x.full_name||'',branchId:x.branch_id||'',branchName:x.branch_name||'',role:x.role||'STAFF'}))
  };
}



export async function getStaffCalendarFast(user,{from,to,branchId='',staffId=''}){
  if(!await ready())return null;
  const effectiveBranch=user.role==='ADMIN'?String(branchId||''):String(user.branchId||'');
  const db=getPool();
  const staffFilter=String(staffId||'');

  const shiftParams=[from,to];
  let shiftWhere=`s.shift_date BETWEEN $1::date AND $2::date`;
  if(effectiveBranch){shiftParams.push(effectiveBranch);shiftWhere+=` AND s.branch_id=$${shiftParams.length}`}
  if(staffFilter){shiftParams.push(staffFilter);shiftWhere+=` AND EXISTS(SELECT 1 FROM shift_staff sx WHERE sx.shift_id=s.id AND sx.staff_id=$${shiftParams.length})`}

  const careParams=[from,to];
  let careWhere=`c.deleted=FALSE AND c.occurred_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AND c.occurred_at < ((($2::date + 1)::timestamp) AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
  if(effectiveBranch){careParams.push(effectiveBranch);careWhere+=` AND c.branch_id=$${careParams.length}`}
  if(staffFilter){careParams.push(staffFilter);careWhere+=` AND EXISTS(SELECT 1 FROM shift_staff sx WHERE sx.shift_id=c.shift_id AND sx.staff_id=$${careParams.length})`}

  const toiletParams=[from,to];
  let toiletWhere=`t.deleted=FALSE AND t.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AND t.created_at < ((($2::date + 1)::timestamp) AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
  if(effectiveBranch){toiletParams.push(effectiveBranch);toiletWhere+=` AND t.branch_id=$${toiletParams.length}`}
  if(staffFilter){toiletParams.push(staffFilter);toiletWhere+=` AND EXISTS(SELECT 1 FROM shift_staff sx WHERE sx.shift_id=t.shift_id AND sx.staff_id=$${toiletParams.length})`}

  const dirParams=[];
  let dirWhere=`sm.deleted=FALSE AND sm.active IS DISTINCT FROM FALSE`;
  if(effectiveBranch){dirParams.push(effectiveBranch);dirWhere+=` AND sm.branch_id=$${dirParams.length}`}

  const [sr,cr,tr,dr]=await Promise.all([
    db.query(`
      SELECT s.shift_date::text AS date,
             COUNT(DISTINCT s.id)::int AS shift_count,
             COUNT(DISTINCT ss.staff_id)::int AS staff_count,
             COUNT(DISTINCT s.id) FILTER (WHERE h.confirmed_at IS NOT NULL)::int AS handover_done,
             COUNT(DISTINCT s.id) FILTER (WHERE h.confirmed_at IS NULL)::int AS handover_pending
      FROM shifts s
      LEFT JOIN shift_staff ss ON ss.shift_id=s.id
      LEFT JOIN handovers h ON h.shift_id=s.id
      WHERE ${shiftWhere}
      GROUP BY s.shift_date
      ORDER BY s.shift_date
    `,shiftParams),
    db.query(`
      SELECT ((c.occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::text AS date,
             COUNT(*)::int AS change_count,
             COUNT(*) FILTER (WHERE c.attention_level='RED')::int AS red_count,
             COUNT(*) FILTER (WHERE c.attention_level='YELLOW')::int AS yellow_count,
             COUNT(*) FILTER (WHERE c.attention_level IN ('RED','YELLOW') AND COALESCE(c.attention_status,'OPEN')<>'RESOLVED')::int AS open_count
      FROM care_records c
      WHERE ${careWhere}
      GROUP BY ((c.occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
      ORDER BY 1
    `,careParams),
    db.query(`
      SELECT ((t.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::text AS date,
             COUNT(*)::int AS toileting_count
      FROM toileting_logs t
      WHERE ${toiletWhere}
      GROUP BY ((t.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
      ORDER BY 1
    `,toiletParams),
    db.query(`
      SELECT sm.id,sm.employee_code,sm.full_name,sm.branch_id,COALESCE(br.name_cache,'') branch_name
      FROM staff_members sm
      LEFT JOIN bcare_branches_ref br ON br.bcare_branch_id=sm.branch_id
      WHERE ${dirWhere}
      ORDER BY sm.full_name,sm.employee_code
    `,dirParams)
  ]);

  const days=new Map();
  const ensure=date=>{if(!days.has(date))days.set(date,{date,shiftCount:0,staffCount:0,changeCount:0,toiletingCount:0,redCount:0,yellowCount:0,openCount:0,handoverDone:0,handoverPending:0});return days.get(date)};
  for(const x of sr.rows){const d=ensure(x.date);d.shiftCount=Number(x.shift_count||0);d.staffCount=Number(x.staff_count||0);d.handoverDone=Number(x.handover_done||0);d.handoverPending=Number(x.handover_pending||0)}
  for(const x of cr.rows){const d=ensure(x.date);d.changeCount=Number(x.change_count||0);d.redCount=Number(x.red_count||0);d.yellowCount=Number(x.yellow_count||0);d.openCount=Number(x.open_count||0)}
  for(const x of tr.rows){const d=ensure(x.date);d.toiletingCount=Number(x.toileting_count||0)}
  const rows=[...days.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const summary=rows.reduce((a,x)=>({
    shiftCount:a.shiftCount+x.shiftCount,
    changeCount:a.changeCount+x.changeCount,
    toiletingCount:a.toiletingCount+x.toiletingCount,
    redCount:a.redCount+x.redCount,
    yellowCount:a.yellowCount+x.yellowCount,
    handoverDone:a.handoverDone+x.handoverDone,
    handoverPending:a.handoverPending+x.handoverPending,
    staffCount:0
  }),{shiftCount:0,changeCount:0,toiletingCount:0,redCount:0,yellowCount:0,handoverDone:0,handoverPending:0,staffCount:0});

  const uniqueStaffParams=[from,to];
  let uniqueStaffWhere=`s.shift_date BETWEEN $1::date AND $2::date`;
  if(effectiveBranch){uniqueStaffParams.push(effectiveBranch);uniqueStaffWhere+=` AND s.branch_id=$${uniqueStaffParams.length}`}
  if(staffFilter){uniqueStaffParams.push(staffFilter);uniqueStaffWhere+=` AND ss.staff_id=$${uniqueStaffParams.length}`}
  const ur=await db.query(`SELECT COUNT(DISTINCT ss.staff_id)::int n FROM shifts s JOIN shift_staff ss ON ss.shift_id=s.id WHERE ${uniqueStaffWhere}`,uniqueStaffParams);
  summary.staffCount=Number(ur.rows[0]?.n||0);

  return {
    from,to,branchId:effectiveBranch,staffId:staffFilter,
    days:rows,
    summary,
    staffDirectory:dr.rows.map(x=>({id:String(x.id),employeeCode:x.employee_code||'',fullName:x.full_name||'',branchId:x.branch_id||'',branchName:x.branch_name||''}))
  };
}

export async function getStaffDayDetailFast(user,{date,branchId='',staffId=''}){
  if(!await ready())return null;
  const effectiveBranch=user.role==='ADMIN'?String(branchId||''):String(user.branchId||'');
  const staffFilter=String(staffId||'');
  const db=getPool();

  const params=[date,date,date,date,date];
  let where=`(
    s.shift_date=$1::date
    OR EXISTS(
      SELECT 1 FROM care_records cx
      WHERE cx.shift_id=s.id AND cx.deleted=FALSE
        AND cx.occurred_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND cx.occurred_at < ((($3::date + 1)::timestamp) AT TIME ZONE 'Asia/Ho_Chi_Minh')
    )
    OR EXISTS(
      SELECT 1 FROM toileting_logs tx
      WHERE tx.shift_id=s.id AND tx.deleted=FALSE
        AND tx.created_at >= ($4::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND tx.created_at < ((($5::date + 1)::timestamp) AT TIME ZONE 'Asia/Ho_Chi_Minh')
    )
  )`;
  if(effectiveBranch){params.push(effectiveBranch);where+=` AND s.branch_id=$${params.length}`}
  if(staffFilter){params.push(staffFilter);where+=` AND EXISTS(SELECT 1 FROM shift_staff sx WHERE sx.shift_id=s.id AND sx.staff_id=$${params.length})`}

  const sr=await db.query(`
    SELECT s.*,
      COUNT(DISTINCT rr.id) resident_count,
      MAX(h.confirmed_at) handover_confirmed_at,
      MAX(h.received_at) handover_received_at,
      COALESCE(json_agg(DISTINCT jsonb_build_object(
        'id',sm.id,'userId',sm.user_id,'username',u.username,
        'employeeCode',sm.employee_code,'fullName',sm.full_name,
        'role',COALESCE(u.role,sm.role_cache,'STAFF'),
        'areaId',sm.area_id_cache,'areaName',sm.area_name_cache,
        'isPrimary',ss.is_primary_recorder
      )) FILTER (WHERE sm.id IS NOT NULL),'[]'::json) assigned_staff
    FROM shifts s
    LEFT JOIN shift_staff ss ON ss.shift_id=s.id
    LEFT JOIN staff_members sm ON sm.id=ss.staff_id
    LEFT JOIN users u ON u.id=sm.user_id
    LEFT JOIN shift_residents rr ON rr.shift_id=s.id
    LEFT JOIN handovers h ON h.shift_id=s.id
    WHERE ${where}
    GROUP BY s.id
    ORDER BY s.shift_date,s.shift_type,s.created_at
  `,params);

  const shifts=sr.rows.map(mapShiftRow).filter(x=>scopeShift(user,x));
  const shiftIds=shifts.map(x=>x.id);
  if(!shiftIds.length)return {date,branchId:effectiveBranch,staffId:staffFilter,summary:{shiftCount:0,staffCount:0,changeCount:0,toiletingCount:0,redCount:0,yellowCount:0,handoverDone:0},shifts:[]};

  const [cr,tr]=await Promise.all([
    db.query(`
      SELECT c.*,v.pulse,v.temperature,v.bp_sys,v.bp_dia,v.spo2,v.respiratory_rate,v.concern,v.alert_level,v.alerts,v.urgent,v.blood_glucose,v.insulin_dose_units,
             (SELECT COUNT(*)::int FROM care_record_images i WHERE i.care_record_id=c.id) image_count
      FROM care_records c
      LEFT JOIN care_record_vitals v ON v.care_record_id=c.id
      WHERE c.shift_id=ANY($1::text[]) AND c.deleted=FALSE
        AND c.occurred_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND c.occurred_at < ((($3::date + 1)::timestamp) AT TIME ZONE 'Asia/Ho_Chi_Minh')
      ORDER BY c.occurred_at DESC
    `,[shiftIds,date,date]),
    db.query(`
      SELECT t.* FROM toileting_logs t
      WHERE t.shift_id=ANY($1::text[]) AND t.deleted=FALSE
        AND t.created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AND t.created_at < ((($3::date + 1)::timestamp) AT TIME ZONE 'Asia/Ho_Chi_Minh')
      ORDER BY t.created_at DESC
    `,[shiftIds,date,date])
  ]);

  const changes=cr.rows.map(x=>({...mapCareRow(x),imageCount:Number(x.image_count||0)}));
  const toilets=tr.rows.map(mapToiletRow);
  const sourceById=new Map(sr.rows.map(x=>[String(x.id),x]));
  const resultShifts=shifts.map(shift=>{
    const source=sourceById.get(String(shift.id))||{};
    const sc=changes.filter(x=>String(x.shiftId)===String(shift.id));
    const st=toilets.filter(x=>String(x.shiftId)===String(shift.id));
    return {
      ...shift,
      staff:shift.assignedStaff||[],
      handover:{confirmedAt:iso(source.handover_confirmed_at),receivedAt:iso(source.handover_received_at)},
      changes:sc,
      toilets:st,
      changeCount:sc.length,
      toiletingCount:st.length,
      redCount:sc.filter(x=>x.attentionLevel==='RED').length,
      yellowCount:sc.filter(x=>x.attentionLevel==='YELLOW').length
    };
  });
  const staffSet=new Set(resultShifts.flatMap(x=>(x.staff||[]).map(p=>String(p.id))));
  return {
    date,branchId:effectiveBranch,staffId:staffFilter,
    summary:{
      shiftCount:resultShifts.length,
      staffCount:staffSet.size,
      changeCount:changes.length,
      toiletingCount:toilets.length,
      redCount:changes.filter(x=>x.attentionLevel==='RED').length,
      yellowCount:changes.filter(x=>x.attentionLevel==='YELLOW').length,
      handoverDone:resultShifts.filter(x=>x.handover?.confirmedAt).length
    },
    shifts:resultShifts
  };
}


export async function getResidentVitalsReportFast(user,{residentId,from,to,branchId=''}){
  if(!await ready())return null;
  const effectiveBranch=user.role==='ADMIN'?String(branchId||''):String(user.branchId||'');
  const db=getPool();

  const params=[String(residentId),from,to];
  let scope=`c.bcare_resident_id=$1 AND c.deleted=FALSE`;
  if(effectiveBranch){params.push(effectiveBranch);scope+=` AND c.branch_id=$${params.length}`}

  const vitalPresent=`(
    v.pulse IS NOT NULL OR v.temperature IS NOT NULL OR v.bp_sys IS NOT NULL OR
    v.bp_dia IS NOT NULL OR v.spo2 IS NOT NULL OR v.respiratory_rate IS NOT NULL OR
    v.blood_glucose IS NOT NULL OR v.insulin_dose_units IS NOT NULL
  )`;

  const rangeSql=`
    SELECT c.*,v.pulse,v.temperature,v.bp_sys,v.bp_dia,v.spo2,v.respiratory_rate,
           v.concern,v.alert_level,v.alerts,v.urgent,v.blood_glucose,v.insulin_dose_units
    FROM care_records c
    JOIN care_record_vitals v ON v.care_record_id=c.id
    WHERE ${scope}
      AND ${vitalPresent}
      AND c.occurred_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AND c.occurred_at < ((($3::date + 1)::timestamp) AT TIME ZONE 'Asia/Ho_Chi_Minh')
    ORDER BY c.occurred_at DESC
  `;

  const latestParams=[String(residentId),to];
  let latestScope=`c.bcare_resident_id=$1 AND c.deleted=FALSE`;
  if(effectiveBranch){latestParams.push(effectiveBranch);latestScope+=` AND c.branch_id=$${latestParams.length}`}

  const latestSql=`
    SELECT c.*,v.pulse,v.temperature,v.bp_sys,v.bp_dia,v.spo2,v.respiratory_rate,
           v.concern,v.alert_level,v.alerts,v.urgent,v.blood_glucose,v.insulin_dose_units
    FROM care_records c
    JOIN care_record_vitals v ON v.care_record_id=c.id
    WHERE ${latestScope}
      AND ${vitalPresent}
      AND c.occurred_at < ((($2::date + 1)::timestamp) AT TIME ZONE 'Asia/Ho_Chi_Minh')
    ORDER BY c.occurred_at DESC
    LIMIT 1
  `;

  const [rr,lr]=await Promise.all([db.query(rangeSql,params),db.query(latestSql,latestParams)]);
  const readings=rr.rows.map(mapCareRow);
  const latest=lr.rows[0]?mapCareRow(lr.rows[0]):null;
  return {readings,latest};
}

export async function createShiftFast(user,body,{branchName='',assignedStaff=[],primaryRecorder}={}){
  if(!await ready())return null;
  const id=uuid();const shiftDate=dateOnly(body.shiftDate)||dateOnly(new Date());
  await withTransaction(async db=>{
    await db.query(`INSERT INTO bcare_branches_ref(bcare_branch_id,name_cache,last_synced_at) VALUES($1,$2,NOW()) ON CONFLICT(bcare_branch_id) DO UPDATE SET name_cache=COALESCE(NULLIF(EXCLUDED.name_cache,''),bcare_branches_ref.name_cache),last_synced_at=NOW()`,[String(body.branchId),String(branchName||'')]);
    await db.query(`INSERT INTO shifts(id,shift_date,shift_type,status,branch_id,branch_name_cache,area_id_cache,area_name_cache,room_id_cache,auto_created,created_by,created_at) VALUES($1,$2,$3,'OPEN',$4,$5,$6,$7,$8,$9,$10,NOW())`,[id,shiftDate,body.shiftType,body.branchId,branchName,body.areaId||null,body.areaName||'',body.roomId||null,!!body.autoCreated,user.sub]);
    for(const p of assignedStaff)await db.query(`INSERT INTO shift_staff(shift_id,staff_id,is_primary_recorder) VALUES($1,$2,$3)`,[id,p.id,p.id===primaryRecorder.id]);
  });
  return {id,shiftDate,shiftType:body.shiftType,status:'OPEN',branchId:body.branchId,branchName,areaId:body.areaId||null,areaName:body.areaName||'',roomId:body.roomId||null,assignedStaffIds:assignedStaff.map(x=>x.id),assignedStaff,assignedStaffNames:assignedStaff.map(x=>x.fullName),assignedStaffId:primaryRecorder.id,assignedStaffName:primaryRecorder.fullName,primaryRecorderId:primaryRecorder.id,primaryRecorderName:primaryRecorder.fullName,primaryRecorderCode:primaryRecorder.employeeCode,autoCreated:!!body.autoCreated,createdBy:user.sub,createdAt:new Date().toISOString()};
}

export async function updateShiftStaffFast(id,user,{assignedStaff,primaryRecorder}){
  if(!await ready())return null;
  await withTransaction(async db=>{await db.query(`DELETE FROM shift_staff WHERE shift_id=$1`,[id]);for(const p of assignedStaff)await db.query(`INSERT INTO shift_staff(shift_id,staff_id,is_primary_recorder) VALUES($1,$2,$3)`,[id,p.id,p.id===primaryRecorder.id]);await db.query(`UPDATE shifts SET staff_updated_by=$2,staff_updated_at=NOW() WHERE id=$1`,[id,user.sub])});
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
    if(counts.changes||counts.toileting||counts.handovers)return {blocked:true,counts};
    await db.query(`DELETE FROM shifts WHERE id=$1`,[id]);
    return {deleted:true,counts,shift:{id,shiftDate:dateOnly(shift.shift_date),shiftType:shift.shift_type,branchId:shift.branch_id}};
  });
}
