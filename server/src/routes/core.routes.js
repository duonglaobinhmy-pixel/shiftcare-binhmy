import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { authenticate, allowRoles, allowPermission } from '../middleware/auth.js';
import { getStore, updateStore, getUsers } from '../services/store.service.js';
import { getResidents } from '../services/bcare.service.js';
import { branchInfo } from '../config/branches.js';
import { getPool } from '../services/db.service.js';
import { audit } from '../services/audit.service.js';
import { notifyUrgentCreated,notifyUrgentResolved } from '../services/telegram.service.js';
import { sanitizeWoundImages } from '../services/media-retention.service.js';
import { getStaffOptionsFast,getShiftsFast,getShiftDetailFast,getReportBundleFast,getDashboardBundleFast,getStaffReportBundleFast,getStaffCalendarFast,getStaffDayDetailFast,getResidentVitalsReportFast,createShiftFast,updateShiftStaffFast,replaceShiftRosterFast,deleteShiftFast } from '../services/fast-query.service.js';

import { canAccessShift, isCareStaff } from '../config/shift-access.js';

const router = Router();
// Express 4 does not forward rejected async route handlers to the JSON error middleware.
// Wrap handlers once so database errors return a response instead of leaving requests pending.
for(const method of ['get','post','put','patch','delete']){
  const register=router[method].bind(router);
  router[method]=(path,...handlers)=>register(path,...handlers.map(handler=>
    typeof handler==='function'?(req,res,next)=>Promise.resolve().then(()=>handler(req,res,next)).catch(next):handler
  ));
}
router.use(authenticate);
router.use((req,res,next)=>(req.user.role==='CSKH'||(req.user.role!=='ADMIN'&&req.user.userScopes?.length)) ? res.status(403).json({success:false,message:'CSKH dùng màn hình theo dõi và API báo cáo V2 theo phạm vi.'}) : next());
router.use(async (req, res, next) => {
  try {
    const shiftMatch = req.path.match(/^\/shifts\/([^/]+)(?:\/|$)/);
    const recordMatch = req.path.match(/^\/(change-logs|toileting-logs)\/([^/]+)(?:\/|$)/);
    let shiftId = shiftMatch && shiftMatch[1] !== 'staff-options' ? shiftMatch[1] : req.body?.shiftId;
    if (!shiftId && !recordMatch) return next();
    const store = await getStore();
    if (recordMatch) {
      const collection = recordMatch[1] === 'change-logs' ? store.changeLogs : store.toiletingLogs;
      shiftId = collection.find(x => x.id === recordMatch[2])?.shiftId;
    }
    const shift = store.shifts.find(x => x.id === shiftId);
    if (!shift) return res.status(404).json({ success: false, message: 'Không tìm thấy ca.' });
    if (!canAccessShift(req.user, shift)) return res.status(423).json({ success: false, message: 'Ca cũ hoặc ca đã khóa không còn khả dụng cho chăm sóc viên.' });
    const receiving = req.path.endsWith('/handover/receive');
    if (!['GET', 'HEAD'].includes(req.method) && shift.status !== 'OPEN' && req.user.role !== 'ADMIN' && !receiving)
      return res.status(423).json({ success: false, message: 'Ca đã bàn giao và khóa chỉnh sửa.' });
    next();
  } catch (e) { next(e); }
});

function assertOpenShift(store,user,shiftId){
  const shift=store.shifts.find(x=>x.id===shiftId);
  if(!canAccessShift(user,shift)||shift.status!=='OPEN')throw Object.assign(new Error('Ca đã khóa hoặc không còn khả dụng.'),{status:423});
}
function visibleByScope(user,row){
  if(user.role==='ADMIN') return true;
  return !row.branchId || String(row.branchId)===String(user.branchId||'');
}
function todayVN(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date())}
function dateVN(value){if(!value)return'';if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const d=value instanceof Date?value:new Date(value);if(Number.isNaN(d.getTime()))return'';return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(d)}
function inEventRange(value,range){const d=dateVN(value);return!!d&&range.inRange(d)}
function normalizeDateOnly(value){if(!value)return todayVN();const raw=String(value).trim();if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;const d=new Date(value);if(Number.isNaN(d.getTime()))throw new Error(`NgĂ y khĂ´ng há»£p lá»‡: ${raw}`);return d.toISOString().slice(0,10)}
function reportRange(query){const today=todayVN();let from=String(query.from||query.date||today),to=String(query.to||query.date||from);if(to<from)[from,to]=[to,from];return{from,to,inRange:(date)=>String(date||'')>=from&&String(date||'')<=to}}
function currentShiftType(){
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',hour12:false}).format(new Date()));
  return hour>=6&&hour<18?'MORNING':'NIGHT';
}
function attentionLevel(x){
  if(x.vitals?.alertLevel==='RED'||x.eventType==='FALL'||x.categoryCodes?.includes('INCIDENT'))return'RED';
  if(x.priority==='HIGH')return'RED';
  if(x.vitals?.alertLevel==='YELLOW'||x.priority==='MEDIUM')return'YELLOW';
  return null;
}
function attentionStatus(x){return attentionLevel(x)?(x.attentionStatus==='RESOLVED'?'RESOLVED':'OPEN'):null}
function withAttention(x){return{...x,attentionLevel:attentionLevel(x),attentionStatus:attentionStatus(x)}}
function isAttentionChange(x){return attentionLevel(x)!==null}
// One active alert per resident; red outranks yellow, then newest observation wins.
function prioritizeOutstanding(changes){
  const selected=new Map();
  for(const raw of changes){
    const x=withAttention(raw);
    if(!x.attentionLevel||x.attentionStatus!=='OPEN')continue;
    const key=`${x.branchId}:${x.residentId}`,previous=selected.get(key);
    if(!previous|| (x.attentionLevel==='RED'&&previous.attentionLevel!=='RED') || (x.attentionLevel===previous.attentionLevel&&String(x.occurredAt||x.createdAt)>String(previous.occurredAt||previous.createdAt)))selected.set(key,x);
  }
  return [...selected.values()].sort((a,b)=>a.attentionLevel===b.attentionLevel?String(b.occurredAt||b.createdAt).localeCompare(String(a.occurredAt||a.createdAt)):a.attentionLevel==='RED'?-1:1);
}
function shiftResidentCount(store,shiftId){return store.shiftResidents.filter(x=>x.shiftId===shiftId).length}
const bowelStatuses=new Set(['NORMAL','CONSTIPATION','DIARRHEA','OTHER']);
const urineStatuses=new Set(['NORMAL','SONDE','CATHETER','DIAPER','OTHER','LOW','NONE']);
const careCategories=new Set(['HEALTH','NUTRITION','INCIDENT','PSYCHOLOGY','SKIN','OTHER']);
const careEventTypes=new Set(['OBSERVATION','FALL','PAIN','MEAL','RESPIRATORY','SKIN','BEHAVIOR','HOSPITAL','FAMILY','OTHER']);
const carePriorities=new Set(['LOW','MEDIUM','HIGH']);
const vitalRules={
  pulse:[20,250,'Máº¡ch'],
  temperature:[30,45,'Nhiá»‡t Ä‘á»™'],
  bpSys:[40,300,'Huyáº¿t Ă¡p tĂ¢m thu'],
  bpDia:[20,200,'Huyáº¿t Ă¡p tĂ¢m trÆ°Æ¡ng'],
  spo2:[1,100,'SpOâ‚‚'],
  respiratoryRate:[1,50,'Nhá»‹p thá»Ÿ'],
  bloodGlucose:[20,600,'ÄÆ°á»ng huyáº¿t']
};

function vitalAlerts(v){
  const rows=[],add=(field,level,message)=>rows.push({field,level,message});

  if(v.pulse!==null){
    if(v.pulse<50||v.pulse>=120)add('pulse','RED',`Máº¡ch ${v.pulse} láº§n/phĂºt`);
    else if(v.pulse<60||v.pulse>100)add('pulse','YELLOW',`Máº¡ch ${v.pulse} láº§n/phĂºt`);
  }
  if(v.temperature!==null){
    if(v.temperature<36||v.temperature>=39)add('temperature','RED',`Nhiá»‡t Ä‘á»™ ${v.temperature}Â°C`);
    else if(v.temperature<37||v.temperature>=38)add('temperature','YELLOW',`Nhiá»‡t Ä‘á»™ ${v.temperature}Â°C`);
  }
  if(v.bpSys!==null){
    if(v.bpSys<90||v.bpSys>=180)add('bpSys','RED',`Huyáº¿t Ă¡p tĂ¢m thu ${v.bpSys} mmHg`);
    else if(v.bpSys<100||v.bpSys>=140)add('bpSys','YELLOW',`Huyáº¿t Ă¡p tĂ¢m thu ${v.bpSys} mmHg`);
  }
  if(v.bpDia!==null){
    if(v.bpDia<50||v.bpDia>=110)add('bpDia','RED',`Huyáº¿t Ă¡p tĂ¢m trÆ°Æ¡ng ${v.bpDia} mmHg`);
    else if(v.bpDia<60||v.bpDia>=90)add('bpDia','YELLOW',`Huyáº¿t Ă¡p tĂ¢m trÆ°Æ¡ng ${v.bpDia} mmHg`);
  }
  if(v.spo2!==null){
    if(v.spo2<90)add('spo2','RED',`SpOâ‚‚ ${v.spo2}%`);
    else if(v.spo2<95)add('spo2','YELLOW',`SpOâ‚‚ ${v.spo2}%`);
  }
  if(v.respiratoryRate!==null){
    if(v.respiratoryRate<10||v.respiratoryRate>=25)add('respiratoryRate','RED',`Nhá»‹p thá»Ÿ ${v.respiratoryRate} láº§n/phĂºt`);
    else if(v.respiratoryRate<16||v.respiratoryRate>=21)add('respiratoryRate','YELLOW',`Nhá»‹p thá»Ÿ ${v.respiratoryRate} láº§n/phĂºt`);
  }
  if(v.bloodGlucose!==null){
    if(v.bloodGlucose<70||v.bloodGlucose>=200)add('bloodGlucose','RED',`ÄÆ°á»ng huyáº¿t ${v.bloodGlucose} mg/dL`);
    else if(v.bloodGlucose<80||v.bloodGlucose>=127)add('bloodGlucose','YELLOW',`ÄÆ°á»ng huyáº¿t ${v.bloodGlucose} mg/dL`);
  }

  return rows;
}

function normalizeVitals(vitals,insulin){
  if(!vitals&&!insulin?.given)return null;

  const normalized={concern:!!vitals?.concern};

  for(const [field,[min,max,label]] of Object.entries(vitalRules)){
    const raw=vitals?.[field];

    if(raw===''||raw===null||raw===undefined){
      normalized[field]=null;
      continue;
    }

    if(typeof raw==='boolean'||typeof raw==='object'){
      throw new Error(`${label} pháº£i lĂ  giĂ¡ trá»‹ sá»‘.`);
    }

    const text=String(raw).trim();

    // KhĂ´ng nháº­n chá»¯, e/E, dáº¥u +/-, hoáº·c kĂ½ tá»± láº¡.
    if(!/^\d+(?:\.\d+)?$/.test(text)){
      throw new Error(`${label} chá»‰ Ä‘Æ°á»£c nháº­p sá»‘.`);
    }

    const value=Number(text);

    if(!Number.isFinite(value)||value<min||value>max){
      throw new Error(`${label} pháº£i tá»« ${min} Ä‘áº¿n ${max}.`);
    }

    normalized[field]=value;
  }

  if((normalized.bpSys===null)!==(normalized.bpDia===null)){
    throw new Error('Cáº§n nháº­p Ä‘á»§ cáº£ huyáº¿t Ă¡p tĂ¢m thu vĂ  tĂ¢m trÆ°Æ¡ng.');
  }

  if(normalized.bpSys!==null&&normalized.bpSys<=normalized.bpDia){
    throw new Error('Huyáº¿t Ă¡p tĂ¢m thu pháº£i lá»›n hÆ¡n huyáº¿t Ă¡p tĂ¢m trÆ°Æ¡ng.');
  }

  normalized.insulinDoseUnits=null;

  if(insulin?.given){
    if(normalized.bloodGlucose===null)throw new Error('ÄĂ£ chá»n tiĂªm insulin thĂ¬ pháº£i nháº­p Ä‘Æ°á»ng huyáº¿t trÆ°á»›c tiĂªm.');
    const rawDose=insulin.dose;

    if(rawDose===''||rawDose===null||rawDose===undefined){
      throw new Error('ÄĂ£ chá»n tiĂªm insulin thĂ¬ pháº£i nháº­p liá»u insulin.');
    }

    const doseText=String(rawDose).trim();

    if(!/^\d+(?:\.\d+)?$/.test(doseText)){
      throw new Error('Liá»u insulin chá»‰ Ä‘Æ°á»£c nháº­p sá»‘.');
    }

    const dose=Number(doseText);

    if(!Number.isFinite(dose)||dose<=0){
      throw new Error('Liá»u insulin pháº£i lá»›n hÆ¡n 0 IU.');
    }

    normalized.insulinDoseUnits=dose;
  }

  normalized.alerts=vitalAlerts(normalized);
  normalized.alertLevel=normalized.alerts.some(x=>x.level==='RED')
    ?'RED'
    :normalized.alerts.some(x=>x.level==='YELLOW')
      ?'YELLOW'
      :'NORMAL';

  normalized.concern=normalized.concern||normalized.alertLevel==='RED';

  if(normalized.alertLevel==='RED'){
    const urgent=vitals?.urgent||{};
    const confirmed=urgent.confirmed===true||urgent.remeasured===true;
    const action=String(urgent.action||'').trim();

    if(!action){
      throw new Error('Cáº£nh bĂ¡o Äá»: cáº§n nháº­p xá»­ lĂ½ / hĂ nh Ä‘á»™ng Ä‘Ă£ thá»±c hiá»‡n.');
    }

    normalized.urgent={
      confirmed,
      action,
      symptoms:String(urgent.symptoms||'').trim()
    };
  }else{
    normalized.urgent=null;
  }

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
  if(!branchId)throw new Error('Báº¯t buá»™c xĂ¡c Ä‘á»‹nh cÆ¡ sá»Ÿ.');
  const branchName=body.branchName||branchInfo(branchId)?.name||user.branchName||'';
  const requestedIds=[...new Set((Array.isArray(body.assignedStaffIds)?body.assignedStaffIds:[]).map(String).filter(Boolean))];
  const users=await getUsers();
  const shiftType=String(body.shiftType||currentShiftType());
  if(!['MORNING','NIGHT'].includes(shiftType))throw new Error('Chá»‰ Ä‘Æ°á»£c chá»n Ca sĂ¡ng hoáº·c Ca tá»‘i.');
  const fastStaff=await getStaffOptionsFast(branchId);
  const store=fastStaff===null?await getStore():null;
  const sourceStaff=fastStaff===null?(store.staffMembers||[]).filter(x=>x.active!==false&&!x.deleted&&String(x.branchId)===branchId):fastStaff;
  const assignedStaff=sourceStaff.filter(x=>requestedIds.includes(String(x.id))).map(x=>{const linked=users.find(u=>u.active!==false&&String(u.branchId||'')===branchId&&String(u.employeeCode||'').toLowerCase()===String(x.employeeCode||'').toLowerCase());return{id:String(x.id),userId:linked?.id||x.userId||null,username:linked?.username||x.username||'',employeeCode:x.employeeCode||'',fullName:x.fullName||'',role:linked?.role||x.role||'STAFF',areaId:linked?.areaId||x.areaId||null,areaName:linked?.areaName||x.areaName||''}});
  if(assignedStaff.length<2||assignedStaff.length!==requestedIds.length)throw new Error('Má»—i ca pháº£i chá»n tá»‘i thiá»ƒu 2 nhĂ¢n sá»± Ä‘ang hoáº¡t Ä‘á»™ng thuá»™c Ä‘Ăºng cÆ¡ sá»Ÿ.');
  const primaryRecorder=assignedStaff.find(x=>x.id===String(body.primaryRecorderId||''));
  if(!primaryRecorder)throw new Error('Pháº£i chá»n má»™t ngÆ°á»i ghi chĂ­nh trong danh sĂ¡ch nhĂ¢n sá»± trá»±c ca.');
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
  if(!resident.id||resident.id!==req.params.residentId)return res.status(400).json({success:false,message:'Thiáº¿u thĂ´ng tin NCT.'});
  if(!visibleByScope(req.user,resident))return res.status(403).json({success:false,message:'NCT ngoĂ i pháº¡m vi Ä‘Æ°á»£c giao.'});
  const s=await getStore();
  const existingRoster=s.shiftResidents.filter(x=>x.residentId===resident.id);const ids=new Set(existingRoster.map(x=>x.shiftId));
  let shift=s.shifts.filter(x=>ids.has(x.id)&&x.status==='OPEN'&&visibleByScope(req.user,x)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if(!shift){
    shift=s.shifts.find(x=>x.status==='OPEN'&&x.shiftDate===todayVN()&&x.shiftType===currentShiftType()&&x.branchId===resident.branchId&&(!resident.areaId||x.areaId===resident.areaId));
  }
  if(!shift)return res.status(422).json({success:false,message:'ChÆ°a cĂ³ ca trá»±c Ä‘Æ°á»£c GiĂ¡m Ä‘á»‘c cÆ¡ sá»Ÿ/Admin táº¡o, phĂ¢n cĂ´ng tá»‘i thiá»ƒu 2 nhĂ¢n sá»± vĂ  chá»n ngÆ°á»i ghi chĂ­nh.'});
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
  const outstanding=prioritizeOutstanding(allVisibleChanges);
  const byCategory=changes.reduce((a,x)=>{for(const code of new Set(x.categoryCodes?.length?x.categoryCodes:[x.category]))a[code]=(a[code]||0)+1;return a},{});
  const shiftStatus=Object.entries(shifts.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{})).map(([status,count])=>({status,count}));
  const alerts=outstanding.slice(0,50).map(x=>({id:x.id,residentId:x.residentId,residentName:x.residentName,shiftId:x.shiftId,areaName:x.areaName||'',roomName:x.roomName||'',bedName:x.bedName||'',image:x.image||x.woundImages?.[0]?.dataUrl||'',level:x.attentionLevel,latestContent:x.content,latestAt:x.occurredAt||x.createdAt,vitals:x.vitals||null,branchName:x.branchName||'',requiresHandover:x.requiresHandover}));
  // Only actual values count as measurements; empty vital objects are excluded.
  const vitalFields=['pulse','temperature','bpSys','bpDia','spo2','respiratoryRate','bloodGlucose','insulinDoseUnits'];
  const vitalReadings=changes.filter(x=>vitalFields.some(field=>x.vitals?.[field]!=null&&x.vitals[field]!==''))
    .sort((a,b)=>String(b.occurredAt||b.createdAt).localeCompare(String(a.occurredAt||a.createdAt))||String(b.createdAt||'').localeCompare(String(a.createdAt||''))||String(b.id).localeCompare(String(a.id)))
    .map(x=>({id:x.id,shiftId:x.shiftId,residentId:x.residentId,residentName:x.residentName,
      branchId:x.branchId,branchName:x.branchName||'',areaName:x.areaName||'',roomName:x.roomName||'',bedName:x.bedName||'',
      occurredAt:x.occurredAt||x.createdAt,createdByName:x.createdByName||'',vitals:x.vitals,
      attentionLevel:x.attentionLevel,attentionStatus:x.attentionStatus,content:x.content||'',intervention:x.intervention||'',
      requiresHandover:!!x.requiresHandover,followUp:x.followUp||''}));
  const latestByResident=new Map();
  for(const row of vitalReadings){const key=JSON.stringify([String(row.branchId||''),String(row.residentId)]);if(!latestByResident.has(key))latestByResident.set(key,row)}
  const vitalSummary={measurements:vitalReadings.length,residents:latestByResident.size,
    red:vitalReadings.filter(x=>x.vitals.alertLevel==='RED').length,
    yellow:vitalReadings.filter(x=>x.vitals.alertLevel==='YELLOW').length,
    normal:vitalReadings.filter(x=>!x.vitals.alertLevel||x.vitals.alertLevel==='NORMAL').length};
  const activityResidents=new Set(changes.map(x=>x.residentId).filter(Boolean));
  res.json({success:true,data:{date,todayShifts:shifts.length,uniqueResidents:new Set([...residents.map(x=>x.residentId),...activityResidents]).size,changeLogs:changes.length,openRed:outstanding.filter(x=>x.attentionLevel==='RED').length,openYellow:outstanding.filter(x=>x.attentionLevel==='YELLOW').length,resolvedToday:changes.filter(x=>x.attentionLevel&&x.attentionStatus==='RESOLVED').length,requiresHandover:changes.filter(x=>x.requiresHandover).length,pendingReceive:handovers.filter(x=>x.confirmedAt&&!x.receivedAt).length,byCategory,shiftStatus,alerts,vitalSummary,vitalReadings}});
});
router.get('/shifts/:id/glucose-schedule',allowPermission('SHIFT.VIEW'),async(req,res)=>{
  const store=await getStore(),shift=store.shifts.find(x=>x.id===req.params.id);
  if(!shift||!canAccessShift(req.user,shift))return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y ca'});
  const residents=store.shiftResidents.filter(x=>x.shiftId===shift.id),ids=residents.map(x=>String(x.residentId));
  if(!ids.length)return res.json({success:true,data:[]});
  const db=getPool();if(!db)return res.status(503).json({success:false,message:'Lá»‹ch Ä‘o Ä‘Æ°á»ng huyáº¿t cáº§n PostgreSQL.'});
  const result=await db.query(`SELECT resident_id,enabled,interval_days,next_due_date FROM care_glucose_schedules WHERE branch_id=$1 AND resident_id=ANY($2::text[])`,[shift.branchId,ids]);
  const schedule=new Map(result.rows.map(x=>[String(x.resident_id),x]));
  res.json({success:true,data:residents.map(r=>{const x=schedule.get(String(r.residentId));return {residentId:r.residentId,fullName:r.fullName,enabled:!!x?.enabled,intervalDays:x?.interval_days||7,nextDueDate:x?.next_due_date?dateVN(x.next_due_date):null,overdue:!!x?.enabled&&dateVN(x.next_due_date)<=todayVN()}})});
});
router.put('/shifts/:id/glucose-schedule/:residentId',allowPermission('CARE.UPDATE'),async(req,res)=>{
  const store=await getStore(),shift=store.shifts.find(x=>x.id===req.params.id),resident=store.shiftResidents.find(x=>x.shiftId===req.params.id&&String(x.residentId)===req.params.residentId);
  if(!shift||!canAccessShift(req.user,shift)||!resident)return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y NCT trong ca'});
  if(shift.status!=='OPEN')return res.status(423).json({success:false,message:'Ca Ä‘Ă£ bĂ n giao, khĂ´ng thá»ƒ sá»­a lá»‹ch.'});
  if(typeof req.body?.enabled!=='boolean')return res.status(422).json({success:false,message:'Thiáº¿u tráº¡ng thĂ¡i lá»‹ch theo dĂµi.'});
  const intervalDays=Number(req.body.intervalDays||7);
  if(!Number.isInteger(intervalDays)||intervalDays<1||intervalDays>365)return res.status(422).json({success:false,message:'Chu ká»³ pháº£i tá»« 1 Ä‘áº¿n 365 ngĂ y.'});
  const db=getPool();if(!db)return res.status(503).json({success:false,message:'Lá»‹ch Ä‘o Ä‘Æ°á»ng huyáº¿t cáº§n PostgreSQL.'});
  await db.query(`INSERT INTO care_glucose_schedules(resident_id,branch_id,enabled,interval_days,next_due_date,updated_by) VALUES($1,$2,$3,$4,COALESCE((SELECT MAX(c.occurred_at::date)+$4 FROM care_records c JOIN care_record_vitals v ON v.care_record_id=c.id WHERE c.bcare_resident_id=$1 AND c.branch_id=$2 AND c.deleted=FALSE AND v.blood_glucose IS NOT NULL),CURRENT_DATE),$5) ON CONFLICT(resident_id) DO UPDATE SET enabled=$3,interval_days=$4,branch_id=$2,updated_by=$5,updated_at=NOW()`,[resident.residentId,shift.branchId,req.body.enabled,intervalDays,req.user.sub]);
  await audit(req.user,'GLUCOSE_SCHEDULE_UPDATE','resident',resident.residentId,{enabled:req.body.enabled,intervalDays});
  res.json({success:true});
});
router.get('/shifts',allowPermission('SHIFT.VIEW'),async(req,res)=>{const fast=await getShiftsFast(req.user);if(fast)return res.json({success:true,data:fast.filter(x=>canAccessShift(req.user,x))});const s=await getStore();let rows=s.shifts.filter(x=>canAccessShift(req.user,x));rows=rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(x=>({...x,residentCount:shiftResidentCount(s,x.id)}));res.json({success:true,data:rows})});
router.get('/shifts/staff-options',allowPermission('SHIFT.CREATE','SHIFT.UPDATE'),async(req,res)=>{const requestedBranchId=String(req.query.branchId||''),branchId=req.user.role==='ADMIN'?requestedBranchId:String(req.user.branchId||'');if(!branchId)return res.status(400).json({success:false,message:'Thiáº¿u cÆ¡ sá»Ÿ.'});const fast=await getStaffOptionsFast(branchId);if(fast!==null)return res.json({success:true,data:fast});const store=await getStore();const staff=(store.staffMembers||[]).filter(x=>x.active!==false&&!x.deleted&&String(x.branchId)===String(branchId)).map(x=>({id:x.id,userId:x.userId||null,username:x.username||'',employeeCode:x.employeeCode,fullName:x.fullName,role:x.role||'STAFF',areaId:x.areaId||null,areaName:x.areaName||''}));res.json({success:true,data:staff})});
router.post('/shifts',allowPermission('SHIFT.CREATE'),async(req,res)=>{try{if(isCareStaff(req.user)&&req.body?.shiftDate!==todayVN())return res.status(422).json({success:false,message:'Chăm sóc viên chỉ được tạo ca hôm nay.'});res.status(201).json({success:true,data:await createShift(req.user,req.body||{})})}catch(e){res.status(400).json({success:false,message:e.message})}});
router.patch('/shifts/:id/staff',allowPermission('SHIFT.UPDATE'),async(req,res)=>{const s=await getStore(),shift=s.shifts.find(x=>x.id===req.params.id);if(!shift||!visibleByScope(req.user,shift))return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y ca'});if(shift.status!=='OPEN')return res.status(422).json({success:false,message:'Ca Ä‘Ă£ kĂ½ bĂ n giao; khĂ´ng Ä‘Æ°á»£c Ä‘á»•i danh sĂ¡ch ngÆ°á»i trá»±c Ä‘Ă£ dĂ¹ng Ä‘á»ƒ Ä‘á»‘i cháº¥t.'});const requestedIds=[...new Set((Array.isArray(req.body?.assignedStaffIds)?req.body.assignedStaffIds:[]).map(String).filter(Boolean))];const users=await getUsers();const assignedStaff=(s.staffMembers||[]).filter(x=>requestedIds.includes(x.id)&&x.active!==false&&!x.deleted&&String(x.branchId)===String(shift.branchId)).map(x=>{const linked=users.find(u=>u.active&&u.branchId===shift.branchId&&String(u.employeeCode||'').toLowerCase()===String(x.employeeCode).toLowerCase());return{id:x.id,userId:linked?.id||x.userId||null,username:linked?.username||x.username||'',employeeCode:x.employeeCode,fullName:x.fullName,role:linked?.role||x.role||'STAFF',areaId:linked?.areaId||x.areaId||null,areaName:linked?.areaName||x.areaName||''}});if(assignedStaff.length<2||assignedStaff.length!==requestedIds.length)return res.status(422).json({success:false,message:'Má»—i ca pháº£i chá»n tá»‘i thiá»ƒu 2 nhĂ¢n viĂªn Ä‘ang hoáº¡t Ä‘á»™ng trong danh sĂ¡ch cÆ¡ sá»Ÿ.'});const primaryRecorder=assignedStaff.find(x=>x.id===String(req.body?.primaryRecorderId||''));if(!primaryRecorder)return res.status(422).json({success:false,message:'Pháº£i chá»n má»™t ngÆ°á»i ghi chĂ­nh trong danh sĂ¡ch nhĂ¢n sá»± trá»±c ca.'});let updated={...shift,assignedStaffIds:assignedStaff.map(x=>x.id),assignedStaff,assignedStaffNames:assignedStaff.map(x=>x.fullName),assignedStaffId:primaryRecorder.id,assignedStaffName:primaryRecorder.fullName,primaryRecorderId:primaryRecorder.id,primaryRecorderName:primaryRecorder.fullName,primaryRecorderCode:primaryRecorder.employeeCode,staffUpdatedAt:new Date().toISOString(),staffUpdatedBy:req.user.sub};const fastUpdated=await updateShiftStaffFast(shift.id,req.user,{assignedStaff,primaryRecorder});if(!fastUpdated)await updateStore(store=>{const row=store.shifts.find(x=>x.id===shift.id);Object.assign(row,updated)});await audit(req.user,'SHIFT_STAFF_UPDATE','shift',shift.id,{assignedStaffIds:updated.assignedStaffIds,assignedStaffNames:updated.assignedStaffNames,primaryRecorderId:updated.primaryRecorderId});res.json({success:true,data:updated})});
router.post('/shifts/:id/refresh-roster',allowPermission('SHIFT.UPDATE'),async(req,res)=>{
  const fastRows=await getShiftsFast(req.user);let shift=fastRows?.find(x=>x.id===req.params.id);if(!fastRows){const s=await getStore();shift=s.shifts.find(x=>x.id===req.params.id&&visibleByScope(req.user,x));}
  if(!shift)return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y ca'});if(shift.status!=='OPEN')return res.status(422).json({success:false,message:'Ca Ä‘Ă£ khĂ³a/bĂ n giao nĂªn khĂ´ng thá»ƒ náº¡p láº¡i roster.'});
  try{const residentCount=await loadRosterForShift(shift,{replace:true});await audit(req.user,'SHIFT_ROSTER_REFRESH','shift',shift.id,{residentCount});res.json({success:true,data:{residentCount}})}catch(e){res.status(502).json({success:false,message:`KhĂ´ng náº¡p Ä‘Æ°á»£c NCT tá»« BCARE: ${e.message}`})}
});
router.delete('/shifts/:id',allowPermission('SHIFT.DELETE'),async(req,res)=>{
  const fast=await deleteShiftFast(req.user,req.params.id);if(fast){if(fast.notFound)return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y ca'});if(fast.blocked)return res.status(422).json({success:false,message:`KhĂ´ng thá»ƒ xĂ³a ca Ä‘Ă£ cĂ³ dá»¯ liá»‡u (${fast.counts.changes} biáº¿n Ä‘á»™ng, ${fast.counts.toileting} tiĂªu/tiá»ƒu, ${fast.counts.handovers} bĂ n giao). Chá»‰ Admin má»›i Ä‘Æ°á»£c xĂ³a ca cĂ³ dá»¯ liá»‡u.`});await audit(req.user,'SHIFT_DELETE','shift',req.params.id,{shiftDate:fast.shift.shiftDate,shiftType:fast.shift.shiftType,deletedByAdmin:req.user.role==='ADMIN',deletedRecords:fast.counts});return res.json({success:true,deletedRecords:fast.counts});}
  const s=await getStore(),shift=s.shifts.find(x=>x.id===req.params.id);if(!shift||!visibleByScope(req.user,shift))return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y ca'});const changeCount=s.changeLogs.filter(x=>x.shiftId===shift.id).length,toiletCount=s.toiletingLogs.filter(x=>x.shiftId===shift.id).length,handoverCount=s.handovers.filter(x=>x.shiftId===shift.id).length;if((changeCount||toiletCount||handoverCount)&&req.user.role!=='ADMIN')return res.status(422).json({success:false,message:`KhĂ´ng thá»ƒ xĂ³a ca Ä‘Ă£ cĂ³ dá»¯ liá»‡u (${changeCount} biáº¿n Ä‘á»™ng, ${toiletCount} tiĂªu/tiá»ƒu, ${handoverCount} bĂ n giao). Chá»‰ Admin má»›i Ä‘Æ°á»£c xĂ³a ca cĂ³ dá»¯ liá»‡u.`});await updateStore(store=>{store.shifts=store.shifts.filter(x=>x.id!==shift.id);store.shiftResidents=store.shiftResidents.filter(x=>x.shiftId!==shift.id);if(req.user.role==='ADMIN'){store.changeLogs=store.changeLogs.filter(x=>x.shiftId!==shift.id);store.toiletingLogs=store.toiletingLogs.filter(x=>x.shiftId!==shift.id);store.handovers=store.handovers.filter(x=>x.shiftId!==shift.id)}});await audit(req.user,'SHIFT_DELETE','shift',shift.id,{shiftDate:shift.shiftDate,shiftType:shift.shiftType,deletedByAdmin:req.user.role==='ADMIN',deletedRecords:{changes:changeCount,toileting:toiletCount,handovers:handoverCount}});res.json({success:true,deletedRecords:{changes:changeCount,toileting:toiletCount,handovers:handoverCount}})});
router.get('/shifts/:id',allowPermission('SHIFT.VIEW'),async(req,res)=>{
  const fast=await getShiftDetailFast(req.user,req.params.id);if(fast){if(fast.notFound)return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y ca hoáº·c báº¡n khĂ´ng thuá»™c ca trá»±c nĂ y'});return res.json({success:true,data:fast});}
  const s=await getStore(),shift=s.shifts.find(x=>x.id===req.params.id);if(!shift||!canAccessShift(req.user,shift))return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y ca hoáº·c báº¡n khĂ´ng thuá»™c ca trá»±c nĂ y'});const residents=s.shiftResidents.filter(x=>x.shiftId===shift.id&&visibleByScope(req.user,x));const changes=s.changeLogs.filter(x=>x.shiftId===shift.id&&!x.deleted).map(withAttention);const toileting=s.toiletingLogs.filter(x=>x.shiftId===shift.id&&!x.deleted);const alertIds=new Set(changes.filter(x=>x.attentionLevel&&x.attentionStatus==='OPEN').map(x=>x.residentId));const alerts=residents.filter(x=>alertIds.has(x.residentId));res.json({success:true,data:{shift,residents,changes,toileting,alerts}});
});
router.post('/change-logs',allowPermission('CARE.CREATE'),async(req,res)=>{
  const b=req.body||{},s=await getStore(),shift=s.shifts.find(x=>x.id===b.shiftId);if(!shift||!canAccessShift(req.user,shift))return res.status(404).json({success:false,message:'Ca khĂ´ng há»£p lá»‡ hoáº·c báº¡n khĂ´ng thuá»™c ca trá»±c'});const duplicate=b.clientRequestId&&s.changeLogs.find(x=>x.clientRequestId===b.clientRequestId&&x.createdBy===req.user.sub);if(duplicate)return res.json({success:true,data:withAttention(duplicate),duplicate:true});if(shift.status!=='OPEN')return res.status(422).json({success:false,message:'Ca Ä‘Ă£ kĂ½ bĂ n giao nĂªn bá»‹ khĂ³a. Chá»‰ Admin má»›i Ä‘Æ°á»£c sá»­a hoáº·c xĂ³a báº£n ghi Ä‘Ă£ cĂ³; khĂ´ng Ä‘Æ°á»£c thĂªm má»›i.'});
  const allowedEvents=new Set(['OBSERVATION','FALL','PAIN','MEAL','RESPIRATORY','SKIN','BEHAVIOR','FAMILY','OTHER']);
  const eventCodes=Array.isArray(b.eventCodes)?[...new Set(b.eventCodes)]:[b.eventType==='HOSPITAL'?'OBSERVATION':(b.eventType||'OBSERVATION')];
  if(eventCodes.includes('FALL'))eventCodes.splice(eventCodes.indexOf('FALL'),1),eventCodes.unshift('FALL');
  const residentStatus=b.residentStatus||(b.eventType==='HOSPITAL'?'HOSPITAL':'IN_FACILITY');
  const categoryCodes=Array.isArray(b.categoryCodes)?[...new Set(b.categoryCodes)]:[b.category];
  if(!categoryCodes.length||categoryCodes.some(code=>typeof code!=='string'||!careCategories.has(code)))return res.status(422).json({success:false,message:'Pháº£i chá»n Ă­t nháº¥t má»™t nhĂ³m ghi nháº­n há»£p lá»‡.'});
  if(!eventCodes.length||eventCodes.some(code=>typeof code!=='string'||!allowedEvents.has(code))||!['IN_FACILITY','HOME_LEAVE','HOSPITAL'].includes(residentStatus))return res.status(422).json({success:false,message:'Tráº¡ng thĂ¡i NCT hoáº·c ná»™i dung ghi nháº­n khĂ´ng há»£p lá»‡.'});
  const inRoster=s.shiftResidents.some(x=>x.shiftId===shift.id&&x.residentId===b.residentId&&visibleByScope(req.user,x));if(!inRoster)return res.status(422).json({success:false,message:'NCT khĂ´ng thuá»™c roster ca nĂ y.'});
  if(!b.residentId||!b.category)return res.status(400).json({success:false,message:'Thiáº¿u NCT hoáº·c nhĂ³m ghi nháº­n'});
  const occurredAt=b.occurredAt?new Date(b.occurredAt):new Date();if(Number.isNaN(occurredAt.getTime())||occurredAt.getTime()>Date.now()+5*60*1000)return res.status(422).json({success:false,message:'Thá»i Ä‘iá»ƒm ghi nháº­n khĂ´ng há»£p lá»‡ hoáº·c Ä‘ang á»Ÿ tÆ°Æ¡ng lai.'});
  let vitals,woundImages;try{vitals=normalizeVitals(b.vitals,b.insulin);woundImages=sanitizeWoundImages(b.woundImages)}catch(e){return res.status(422).json({success:false,message:e.message})}
  const row={id:uuid(),clientRequestId:String(b.clientRequestId||''),shiftId:b.shiftId,residentId:b.residentId,residentName:b.residentName||'',category:categoryCodes[0],categoryCodes,eventType:eventCodes[0],eventCodes,residentStatus,priority:['LOW','MEDIUM','HIGH'].includes(b.priority)?b.priority:'LOW',occurredAt:occurredAt.toISOString(),content:String(b.content).trim(),intervention:b.intervention||'',notifiedTo:b.notifiedTo||'',vitals,woundImages,requiresHandover:!!b.requiresHandover,followUp:b.followUp||'',branchId:shift.branchId,branchName:shift.branchName||'',areaId:b.areaId||shift.areaId||null,areaName:b.areaName||'',roomName:b.roomName||'',bedName:b.bedName||'',image:b.image||'',createdBy:req.user.sub,createdByName:req.user.fullName,createdAt:new Date().toISOString(),deleted:false};row.attentionLevel=attentionLevel(row);row.attentionStatus=row.attentionLevel?'OPEN':null;
  await updateStore(store=>{assertOpenShift(store,req.user,row.shiftId);store.changeLogs.unshift(row);const sr=store.shiftResidents.find(x=>x.shiftId===row.shiftId&&x.residentId===row.residentId);if(sr)sr.derivedStatus=row.requiresHandover?'REQUIRES_HANDOVER':'RECORDED_CHANGE'});if(vitals?.bloodGlucose!=null&&getPool())await getPool().query(`UPDATE care_glucose_schedules SET next_due_date=($2::date+interval_days),updated_at=NOW() WHERE resident_id=$1 AND enabled`,[row.residentId,dateVN(row.occurredAt)]);await audit(req.user,'CHANGE_CREATE','change_log',row.id,{residentId:row.residentId,category:row.category,priority:row.priority});if(row.attentionLevel==='RED')void notifyUrgentCreated(row).then(result=>result.sent&&audit(req.user,'TELEGRAM_URGENT_SENT','change_log',row.id,{messageId:result.messageId})).catch(error=>console.error('Telegram urgent alert failed:',error.message));res.status(201).json({success:true,data:row});
});
router.patch('/change-logs/:id',allowPermission('CARE.UPDATE'),async(req,res)=>{
  const b=req.body||{},s=await getStore(),old=s.changeLogs.find(x=>x.id===req.params.id&&!x.deleted);
  if(!old)return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y báº£n ghi'});
  const shift=s.shifts.find(x=>x.id===old.shiftId);
  if(!shift||!canAccessShift(req.user,shift)||!visibleByScope(req.user,old))return res.status(403).json({success:false,message:'KhĂ´ng cĂ³ quyá»n sá»­a báº£n ghi nĂ y'});
  if(shift.status!=='OPEN')return res.status(423).json({success:false,message:'Ca Ä‘Ă£ bĂ n giao, khĂ´ng thá»ƒ sá»­a ghi nháº­n.'});
  if(req.user.role==='CAREGIVER'&&old.createdBy!==req.user.sub)return res.status(403).json({success:false,message:'KhĂ´ng cĂ³ quyá»n sá»­a báº£n ghi nĂ y'});
  const categoryCodes=b.categoryCodes===undefined?old.categoryCodes:(Array.isArray(b.categoryCodes)?[...new Set(b.categoryCodes)]:[]);
  if(!categoryCodes.length||categoryCodes.some(code=>!careCategories.has(code)))return res.status(422).json({success:false,message:'Chá»n Ă­t nháº¥t má»™t nhĂ³m ghi nháº­n há»£p lá»‡.'});
  const residentStatus=b.residentStatus??old.residentStatus,priority=b.priority??old.priority;
  if(!['IN_FACILITY','HOME_LEAVE','HOSPITAL'].includes(residentStatus)||!['LOW','MEDIUM','HIGH'].includes(priority))return res.status(422).json({success:false,message:'Tráº¡ng thĂ¡i hoáº·c má»©c Æ°u tiĂªn khĂ´ng há»£p lá»‡.'});
  const occurredAt=b.occurredAt?new Date(b.occurredAt):new Date(old.occurredAt);
  if(Number.isNaN(occurredAt.getTime())||occurredAt.getTime()>Date.now()+5*60*1000)return res.status(422).json({success:false,message:'Thá»i Ä‘iá»ƒm khĂ´ng há»£p lá»‡.'});
  if(String(b.content??old.content).length>2000||String(b.intervention??old.intervention).length>2000)return res.status(422).json({success:false,message:'Ná»™i dung vÆ°á»£t quĂ¡ 2000 kĂ½ tá»±.'});
  let vitals=old.vitals,woundImages=old.woundImages;
  try{if(b.vitals!==undefined||b.insulin!==undefined)vitals=normalizeVitals(b.vitals,b.insulin);if(b.woundImages!==undefined)woundImages=sanitizeWoundImages(b.woundImages)}catch(e){return res.status(422).json({success:false,message:e.message})}
  const next={...old,category:categoryCodes[0],categoryCodes,residentStatus,priority,occurredAt:occurredAt.toISOString(),content:String(b.content??old.content).trim(),intervention:String(b.intervention??old.intervention).trim(),requiresHandover:typeof b.requiresHandover==='boolean'?b.requiresHandover:old.requiresHandover,followUp:String(b.followUp??old.followUp).trim(),vitals,woundImages,updatedBy:req.user.sub,updatedByName:req.user.fullName,updatedAt:new Date().toISOString()};
  if(b.insulin!==undefined)next.insulin=b.insulin;
  next.attentionLevel=attentionLevel(next);
  next.attentionStatus=next.attentionLevel?(old.attentionStatus==='RESOLVED'&&old.attentionLevel===next.attentionLevel?'RESOLVED':'OPEN'):null;
  await updateStore(store=>{assertOpenShift(store,req.user,old.shiftId);const row=store.changeLogs.find(x=>x.id===old.id);if(!row)throw new Error('Báº£n ghi khĂ´ng cĂ²n tá»“n táº¡i.');Object.assign(row,next)});
  await audit(req.user,'CHANGE_UPDATE','change_log',old.id,{residentId:old.residentId,priority:next.priority});
  res.json({success:true,data:next});
});
router.post('/change-logs/:id/resolve',allowPermission('CARE.UPDATE'),async(req,res)=>{
  const note=String(req.body?.note||'').trim();if(!note)return res.status(422).json({success:false,message:'Vui lĂ²ng ghi ngáº¯n káº¿t quáº£ xá»­ lĂ½ trÆ°á»›c khi hoĂ n táº¥t.'});
  let found=null,shift=null,forbidden=false,locked=false,alreadyResolved=false;await updateStore(store=>{found=store.changeLogs.find(x=>x.id===req.params.id&&!x.deleted);if(!found)return;shift=store.shifts.find(x=>x.id===found.shiftId);locked=shift?.status!=='OPEN';if(!shift||!canAccessShift(req.user,shift)||!visibleByScope(req.user,found)||locked){forbidden=true;return}const level=attentionLevel(found);if(!level)return;if(found.attentionStatus==='RESOLVED'){alreadyResolved=true;return}found.attentionLevel=level;found.attentionStatus='RESOLVED';found.resolutionNote=note;found.resolvedBy=req.user.sub;found.resolvedByName=req.user.fullName;found.resolvedAt=new Date().toISOString();if(locked){found.adminOverrideReason=`HoĂ n táº¥t xá»­ lĂ½ sau bĂ n giao: ${note}`;found.adminOverriddenAt=found.resolvedAt;found.adminOverriddenBy=req.user.sub}});
  if(!found)return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y biáº¿n Ä‘á»™ng'});if(forbidden)return res.status(403).json({success:false,message:locked?'Ca Ä‘Ă£ bĂ n giao, khĂ´ng thá»ƒ cáº­p nháº­t káº¿t quáº£ xá»­ lĂ½.':'Biáº¿n Ä‘á»™ng ngoĂ i pháº¡m vi Ä‘Æ°á»£c giao.'});if(!attentionLevel(found))return res.status(422).json({success:false,message:'Biáº¿n Ä‘á»™ng nĂ y khĂ´ng thuá»™c danh sĂ¡ch cáº§n xá»­ lĂ½.'});if(alreadyResolved)return res.json({success:true,data:withAttention(found),duplicate:true});await audit(req.user,locked?'CHANGE_ADMIN_OVERRIDE_RESOLVE':'CHANGE_RESOLVE','change_log',found.id,{residentId:found.residentId,note});if(found.attentionLevel==='RED')void notifyUrgentResolved(found).then(result=>result.sent&&audit(req.user,'TELEGRAM_URGENT_RESOLVED','change_log',found.id,{messageId:result.messageId})).catch(error=>console.error('Telegram resolved alert failed:',error.message));res.json({success:true,data:withAttention(found)});
});
router.post('/change-logs/:id/restore',allowPermission('CARE.DELETE'),async(req,res)=>{if(req.user.role!=='ADMIN')return res.status(403).json({success:false,message:'Chá»‰ Admin Ä‘Æ°á»£c khĂ´i phá»¥c báº£n ghi.'});let found=null;await updateStore(store=>{found=store.changeLogs.find(x=>x.id===req.params.id);if(found){found.deleted=false;found.restoredBy=req.user.sub;found.restoredAt=new Date().toISOString()}});if(!found)return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y báº£n ghi'});await audit(req.user,'CHANGE_RESTORE','change_log',found.id);res.json({success:true,data:found})});
router.delete('/change-logs/:id',allowPermission('CARE.DELETE'),async(req,res)=>{if(req.user.role!=='ADMIN')return res.status(403).json({success:false,message:'Chá»‰ Admin Ä‘Æ°á»£c xĂ³a báº£n ghi chÄƒm sĂ³c.'});const reason=String(req.body?.reason||'').trim();if(!reason)return res.status(422).json({success:false,message:'Admin pháº£i nháº­p lĂ½ do xĂ³a Ä‘á»ƒ lÆ°u audit.'});let found=null;await updateStore(store=>{found=store.changeLogs.find(x=>x.id===req.params.id);if(found){found.deleted=true;found.deletedAt=new Date().toISOString();found.deletedBy=req.user.sub;found.deleteReason=reason}});if(!found)return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y báº£n ghi'});await audit(req.user,'CHANGE_SOFT_DELETE','change_log',found.id,{reason});res.json({success:true})});

router.post('/toileting-logs',allowPermission('CARE.CREATE'),async(req,res)=>{
  const b=req.body||{},s=await getStore(),shift=s.shifts.find(x=>x.id===b.shiftId);if(!shift||!canAccessShift(req.user,shift))return res.status(404).json({success:false,message:'Ca khĂ´ng há»£p lá»‡ hoáº·c báº¡n khĂ´ng thuá»™c ca trá»±c'});const duplicate=b.clientRequestId&&s.toiletingLogs.find(x=>x.clientRequestId===b.clientRequestId&&x.createdBy===req.user.sub);if(duplicate)return res.json({success:true,data:duplicate,duplicate:true});if(shift.status!=='OPEN')return res.status(422).json({success:false,message:'Ca Ä‘Ă£ kĂ½ bĂ n giao nĂªn bá»‹ khĂ³a, khĂ´ng thá»ƒ thĂªm ghi nháº­n.'});if(!b.residentId)return res.status(400).json({success:false,message:'Thiáº¿u NCT'});if(!bowelStatuses.has(b.bowelStatus||'NORMAL'))return res.status(422).json({success:false,message:'Tráº¡ng thĂ¡i tiĂªu khĂ´ng há»£p lá»‡.'});if(!urineStatuses.has(b.urineStatus||'NORMAL'))return res.status(422).json({success:false,message:'Tráº¡ng thĂ¡i tiá»ƒu khĂ´ng há»£p lá»‡.'});if(b.urineStatus==='OTHER'&&!String(b.urineDetail||'').trim())return res.status(422).json({success:false,message:'Vui lĂ²ng mĂ´ táº£ tĂ¬nh tráº¡ng tiá»ƒu khi chá»n KhĂ¡c.'});const row={id:uuid(),clientRequestId:String(b.clientRequestId||''),shiftId:b.shiftId,residentId:b.residentId,residentName:b.residentName||'',bowelStatus:b.bowelStatus||'NORMAL',urineStatus:b.urineStatus||'NORMAL',urineDetail:b.urineStatus==='OTHER'?String(b.urineDetail||'').trim():'',note:String(b.note||'').trim(),branchId:shift.branchId,areaId:b.areaId||shift.areaId||null,areaName:b.areaName||'',roomName:b.roomName||'',bedName:b.bedName||'',image:b.image||'',createdBy:req.user.sub,createdByName:req.user.fullName,createdAt:new Date().toISOString(),deleted:false};await updateStore(store=>{assertOpenShift(store,req.user,row.shiftId);store.toiletingLogs.unshift(row)});await audit(req.user,'TOILETING_CREATE','toileting_log',row.id,{residentId:row.residentId,urineStatus:row.urineStatus});res.status(201).json({success:true,data:row});
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
  if(!found)return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y lá»‹ch sá»­ tiĂªu/tiá»ƒu'});
  if(forbidden)return res.status(403).json({success:false,message:locked?'Ca Ä‘Ă£ kĂ½ bĂ n giao; chá»‰ Admin Ä‘Æ°á»£c sá»­a lá»‹ch sá»­ tiĂªu/tiá»ƒu.':'Báº¡n khĂ´ng cĂ³ quyá»n sá»­a báº£n ghi nĂ y.'});
  if(missingOverride)return res.status(422).json({success:false,message:'Admin pháº£i nháº­p lĂ½ do khi sá»­a dá»¯ liá»‡u sau bĂ n giao.'});
  const bowelStatus=b.bowelStatus||found.bowelStatus,urineStatus=b.urineStatus||found.urineStatus;
  if(!bowelStatuses.has(bowelStatus)||!urineStatuses.has(urineStatus))return res.status(422).json({success:false,message:'Tráº¡ng thĂ¡i tiĂªu/tiá»ƒu khĂ´ng há»£p lá»‡.'});
  if(urineStatus==='OTHER'&&!String(b.urineDetail||'').trim())return res.status(422).json({success:false,message:'Vui lĂ²ng mĂ´ táº£ tĂ¬nh tráº¡ng tiá»ƒu khi chá»n KhĂ¡c.'});
  await audit(req.user,locked?'TOILETING_ADMIN_OVERRIDE_UPDATE':'TOILETING_UPDATE','toileting_log',found.id,{residentId:found.residentId,overrideReason:locked?String(b.overrideReason).trim():undefined});res.json({success:true,data:found});
});

router.delete('/toileting-logs/:id',allowPermission('CARE.DELETE'),async(req,res)=>{
  if(req.user.role!=='ADMIN')return res.status(403).json({success:false,message:'Chá»‰ Admin Ä‘Æ°á»£c xĂ³a lá»‹ch sá»­ tiĂªu/tiá»ƒu Ä‘á»ƒ giá»¯ audit.'});
  const reason=String(req.body?.reason||'').trim();if(!reason)return res.status(422).json({success:false,message:'Admin pháº£i nháº­p lĂ½ do xĂ³a Ä‘á»ƒ lÆ°u audit.'});
  let found=null;await updateStore(store=>{found=store.toiletingLogs.find(x=>x.id===req.params.id&&!x.deleted);if(found){found.deleted=true;found.deletedAt=new Date().toISOString();found.deletedBy=req.user.sub;found.deleteReason=reason}});
  if(!found)return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y lá»‹ch sá»­ tiĂªu/tiá»ƒu'});await audit(req.user,'TOILETING_SOFT_DELETE','toileting_log',found.id,{reason,residentId:found.residentId});res.json({success:true});
});

router.get('/shifts/:id/handover-preview',allowPermission('HANDOVER.VIEW','HANDOVER.SIGN','HANDOVER.RECEIVE'),async(req,res)=>{
  const s=await getStore(),shift=s.shifts.find(x=>x.id===req.params.id);if(!shift||!canAccessShift(req.user,shift))return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y ca hoáº·c báº¡n khĂ´ng thuá»™c ca trá»±c'});const residents=s.shiftResidents.filter(x=>x.shiftId===shift.id),changes=s.changeLogs.filter(x=>x.shiftId===shift.id&&!x.deleted).map(withAttention),toilets=s.toiletingLogs.filter(x=>x.shiftId===shift.id&&!x.deleted),changed=new Set(changes.map(x=>x.residentId)),handover=s.handovers.find(x=>x.shiftId===shift.id)||null,openAttention=prioritizeOutstanding(changes);res.json({success:true,data:{shift,handover,assignedStaff:shift.assignedStaff||[],summary:{totalResidents:residents.length,noRecordedChange:residents.length-changed.size,changed:changed.size,requiresHandover:changes.filter(x=>x.requiresHandover).length,openRed:openAttention.filter(x=>x.attentionLevel==='RED').length,openYellow:openAttention.filter(x=>x.attentionLevel==='YELLOW').length,toiletingAbnormal:toilets.filter(x=>x.bowelStatus!=='NORMAL'||x.urineStatus!=='NORMAL').length},changes,handoverItems:changes.filter(x=>x.requiresHandover||(x.attentionLevel&&x.attentionStatus==='OPEN')),toileting:toilets.filter(x=>x.bowelStatus!=='NORMAL'||x.urineStatus!=='NORMAL')}});
});
router.post('/shifts/:id/handover/confirm',allowPermission('HANDOVER.SIGN'),async(req,res)=>{
  const s=await getStore(),shift=s.shifts.find(x=>x.id===req.params.id);if(!shift||!canAccessShift(req.user,shift))return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y ca hoáº·c báº¡n khĂ´ng thuá»™c ca trá»±c'});if(shift.status!=='OPEN')return res.status(422).json({success:false,message:'Ca khĂ´ng á»Ÿ tráº¡ng thĂ¡i OPEN Ä‘á»ƒ kĂ½ bĂ n giao.'});if(!req.body?.confirm)return res.status(422).json({success:false,message:'ChÆ°a xĂ¡c nháº­n Ä‘Ă£ rĂ  soĂ¡t ca.'});const assigned=Array.isArray(shift.assignedStaff)?shift.assignedStaff:[];if(assigned.length<2)return res.status(422).json({success:false,message:'Ca chÆ°a Ä‘á»§ tá»‘i thiá»ƒu 2 nhĂ¢n sá»± nĂªn khĂ´ng Ä‘Æ°á»£c kĂ½ bĂ n giao.'});const selectedIds=[...new Set((Array.isArray(req.body?.participantIds)?req.body.participantIds:[]).map(String))];const assignedIds=assigned.map(x=>x.id);if(selectedIds.length!==assignedIds.length||assignedIds.some(id=>!selectedIds.includes(id)))return res.status(422).json({success:false,message:'Pháº£i tick xĂ¡c nháº­n Ä‘áº§y Ä‘á»§ táº¥t cáº£ nhĂ¢n sá»± Ä‘Ă£ Ä‘Æ°á»£c phĂ¢n cĂ´ng trong ca.'});let handover;const confirmedAt=new Date().toISOString();await updateStore(store=>{const storedShift=store.shifts.find(x=>x.id===shift.id);if(!storedShift)throw new Error('Ca khĂ´ng cĂ²n tá»“n táº¡i.');if(storedShift.status!=='OPEN'||!canAccessShift(req.user,storedShift))throw new Error('Ca đã khóa hoặc không còn khả dụng.');const liveIds=(storedShift.assignedStaff||[]).map(x=>x.id);if(liveIds.length!==selectedIds.length||liveIds.some(id=>!selectedIds.includes(id)))throw new Error('Phân công ca đã thay đổi. Hãy mở lại bàn giao.');handover=store.handovers.find(x=>x.shiftId===shift.id);if(!handover){handover={id:uuid(),shiftId:shift.id,branchId:shift.branchId,version:1};store.handovers.push(handover)}handover.summaryNote=req.body?.note||'';handover.confirmedBy=req.user.sub;handover.confirmedByName=req.user.fullName;handover.confirmedAt=confirmedAt;handover.participants=assigned.map(x=>({userId:x.id,username:x.username,employeeCode:x.employeeCode||x.username,fullName:x.fullName,acknowledged:true,acknowledgedAt:confirmedAt,recordedBy:req.user.sub}));storedShift.status='HANDOVER_CONFIRMED';storedShift.lockedAt=confirmedAt;storedShift.lockedBy=req.user.sub});await audit(req.user,'HANDOVER_CONFIRM','handover',handover.id,{participantIds:selectedIds,participantNames:assigned.map(x=>x.fullName)});res.json({success:true,data:handover});
});
router.post('/shifts/:id/handover/receive',allowPermission('HANDOVER.RECEIVE'),async(req,res)=>{
  const s=await getStore(),shift=s.shifts.find(x=>x.id===req.params.id);if(!shift||!canAccessShift(req.user,shift))return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y ca hoáº·c báº¡n khĂ´ng thuá»™c ca trá»±c'});const existing=s.handovers.find(x=>x.shiftId===shift.id);if(!existing?.confirmedAt)return res.status(422).json({success:false,message:'Ca chÆ°a Ä‘Æ°á»£c kĂ½ bĂ n giao'});if(!req.body?.confirm)return res.status(422).json({success:false,message:'ChÆ°a xĂ¡c nháº­n Ä‘Ă£ nháº­n bĂ n giao.'});let handover;await updateStore(store=>{const storedShift=store.shifts.find(x=>x.id===shift.id);if(!storedShift)throw new Error('Ca khĂ´ng cĂ²n tá»“n táº¡i.');handover=store.handovers.find(x=>x.shiftId===shift.id);handover.receivedBy=req.user.sub;handover.receivedByName=req.user.fullName;handover.receivedAt=new Date().toISOString();storedShift.status='RECEIVED'});await audit(req.user,'HANDOVER_RECEIVE','handover',handover.id);res.json({success:true,data:handover});
});
router.post('/shifts/:id/close',allowPermission('SHIFT.UPDATE'),async(req,res)=>{let shift;await updateStore(store=>{shift=store.shifts.find(x=>x.id===req.params.id);if(shift&&visibleByScope(req.user,shift))shift.status='CLOSED'});if(!shift)return res.status(404).json({success:false,message:'KhĂ´ng tĂ¬m tháº¥y ca'});await audit(req.user,'SHIFT_CLOSE','shift',shift.id);res.json({success:true,data:shift})});

router.get('/reports',allowPermission('REPORT.VIEW'),async(req,res)=>{
  const range=reportRange(req.query),branchId=req.user.role==='ADMIN'?String(req.query.branchId||''):String(req.user.branchId||'');
  const fast=await getReportBundleFast(req.user,{from:range.from,to:range.to,branchId});
  const base=fast?{shifts:fast.shifts,shiftResidents:fast.residents,changeLogs:fast.changes,toiletingLogs:fast.toilets,outstanding:fast.outstanding}:await getStore();
  const shifts=fast?base.shifts:base.shifts.filter(x=>range.inRange(x.shiftDate)&&(!branchId||String(x.branchId)===branchId)&&visibleByScope(req.user,x));
  const ids=new Set(shifts.map(x=>x.id));
  const residents=base.shiftResidents.filter(x=>ids.has(x.shiftId)&&visibleByScope(req.user,x));
  const changes=(fast?base.changeLogs:base.changeLogs.filter(x=>!x.deleted&&inEventRange(x.occurredAt||x.createdAt,range)&&(!branchId||String(x.branchId)===branchId)&&visibleByScope(req.user,x))).map(withAttention);
  const toilets=fast?base.toiletingLogs:base.toiletingLogs.filter(x=>!x.deleted&&inEventRange(x.createdAt,range)&&(!branchId||String(x.branchId)===branchId)&&visibleByScope(req.user,x));
  const outstanding=prioritizeOutstanding(fast?base.outstanding:(await getStore()).changeLogs.filter(x=>!x.deleted&&(!branchId||String(x.branchId)===branchId)&&visibleByScope(req.user,x)));
  const byCategory=changes.reduce((a,x)=>{for(const code of new Set(x.categoryCodes?.length?x.categoryCodes:[x.category]))a[code]=(a[code]||0)+1;return a},{}),byArea=changes.reduce((a,x)=>(a[x.areaName||'ChÆ°a xĂ¡c Ä‘á»‹nh']=(a[x.areaName||'ChÆ°a xĂ¡c Ä‘á»‹nh']||0)+1,a),{});
  const attentionInRange=changes.filter(isAttentionChange),resolvedInRange=attentionInRange.filter(x=>x.attentionStatus==='RESOLVED');
  const shiftDetails=shifts.map(x=>({id:x.id,shiftDate:x.shiftDate,shiftType:x.shiftType,status:x.status,branchId:x.branchId,branchName:x.branchName,areaName:x.areaName,residentCount:residents.filter(r=>r.shiftId===x.id).length,changeCount:changes.filter(c=>c.shiftId===x.id).length,handoverCount:changes.filter(c=>c.shiftId===x.id&&c.requiresHandover).length,assignedStaff:(x.assignedStaff||[]).map(p=>({id:p.id,employeeCode:p.employeeCode,fullName:p.fullName})),primaryRecorderName:x.primaryRecorderName||x.assignedStaffName||''}));
  const residentMap=new Map();
  // BĂ¡o cĂ¡o biáº¿n Ä‘á»™ng chá»‰ táº¡o NCT khi NCT cĂ³ phĂ¡t sinh biáº¿n Ä‘á»™ng hoáº·c tiĂªu/tiá»ƒu trong ká»³; khĂ´ng Ä‘á»• toĂ n bá»™ roster vĂ o bĂ¡o cĂ¡o.
  for(const c of changes){const key=String(c.residentId);const row=residentMap.get(key)||{residentId:key,residentName:c.residentName||'NCT',branchId:c.branchId||'',branchName:c.branchName||'',areaName:c.areaName||'',roomName:c.roomName||'',bedName:c.bedName||'',changeCount:0,redOpen:0,yellowOpen:0,resolvedCount:0,handoverCount:0,toiletingAbnormal:0,lastEventAt:null,lastContent:'',latestVitals:null,images:[]};row.changeCount++;if(c.attentionLevel==='RED'&&c.attentionStatus==='OPEN')row.redOpen++;if(c.attentionLevel==='YELLOW'&&c.attentionStatus==='OPEN')row.yellowOpen++;if(c.attentionStatus==='RESOLVED')row.resolvedCount++;if(c.requiresHandover)row.handoverCount++;const at=c.occurredAt||c.createdAt;if(!row.lastEventAt||String(at)>String(row.lastEventAt)){row.lastEventAt=at;row.lastContent=c.content||'';row.latestVitals=c.vitals||null}const imgs=(c.woundImages||[]).map(x=>x?.dataUrl||x?.image||x).filter(Boolean);row.images.push(...imgs.slice(0,2));residentMap.set(key,row)}
  for(const t of toilets){const key=String(t.residentId);const row=residentMap.get(key)||{residentId:key,residentName:t.residentName||'NCT',branchId:t.branchId||'',branchName:t.branchName||'',areaName:t.areaName||'',roomName:t.roomName||'',bedName:t.bedName||'',changeCount:0,redOpen:0,yellowOpen:0,resolvedCount:0,handoverCount:0,toiletingAbnormal:0,lastEventAt:null,lastContent:'',latestVitals:null,images:[]};if(t.bowelStatus!=='NORMAL'||t.urineStatus!=='NORMAL')row.toiletingAbnormal++;residentMap.set(key,row)}
  const branchMap=new Map();
  const ensureBranch=(id,name)=>{const key=String(id||'UNKNOWN');if(!branchMap.has(key))branchMap.set(key,{branchId:key,branchName:name||'ChÆ°a xĂ¡c Ä‘á»‹nh',shifts:0,residentIds:new Set(),changes:0,redOpen:0,yellowOpen:0});return branchMap.get(key)};
  for(const sh of shifts){const row=ensureBranch(sh.branchId,sh.branchName);row.shifts++}
  for(const c of changes){const row=ensureBranch(c.branchId,c.branchName);row.changes++;row.residentIds.add(String(c.residentId));if(c.attentionLevel==='RED'&&c.attentionStatus==='OPEN')row.redOpen++;if(c.attentionLevel==='YELLOW'&&c.attentionStatus==='OPEN')row.yellowOpen++}
  for(const t of toilets){const row=ensureBranch(t.branchId,t.branchName);row.residentIds.add(String(t.residentId))}
  const branchSummaries=[...branchMap.values()].map(x=>({branchId:x.branchId,branchName:x.branchName,shifts:x.shifts,residents:x.residentIds.size,changes:x.changes,redOpen:x.redOpen,yellowOpen:x.yellowOpen})).sort((a,b)=>String(a.branchName).localeCompare(String(b.branchName),'vi'));
  const activePriority=new Map(prioritizeOutstanding((fast?base.outstanding:base.changeLogs).filter(x=>!x.deleted&&(!branchId||String(x.branchId)===branchId)&&visibleByScope(req.user,x))).map(x=>[String(x.residentId),x.attentionLevel]));
  for(const row of residentMap.values()){row.redOpen=activePriority.get(String(row.residentId))==='RED'?1:0;row.yellowOpen=activePriority.get(String(row.residentId))==='YELLOW'?1:0}
  const residentSummaries=[...residentMap.values()].sort((a,b)=>(b.redOpen-a.redOpen)||(b.yellowOpen-a.yellowOpen)||(b.changeCount-a.changeCount)||String(a.residentName).localeCompare(String(b.residentName),'vi'));
  res.json({success:true,data:{from:range.from,to:range.to,branchId,shifts:shifts.length,uniqueResidents:residentSummaries.length,changes:changes.length,openRed:outstanding.filter(x=>x.attentionLevel==='RED').length,openYellow:outstanding.filter(x=>x.attentionLevel==='YELLOW').length,resolvedToday:resolvedInRange.length,resolutionRate:attentionInRange.length?Math.round(resolvedInRange.length*100/attentionInRange.length):100,requiresHandover:changes.filter(x=>x.requiresHandover).length,toiletingLogs:toilets.length,toiletingAbnormal:toilets.filter(x=>x.bowelStatus!=='NORMAL'||x.urineStatus!=='NORMAL').length,byCategory,byArea,branchSummaries,shiftDetails,residentSummaries,outstanding,details:[...changes].sort((a,b)=>String(b.occurredAt||b.createdAt).localeCompare(String(a.occurredAt||a.createdAt))),toiletingDetails:[...toilets].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))}});
});

router.get('/reports/staff/calendar',allowPermission('REPORT.VIEW'),async(req,res)=>{
  const range=reportRange(req.query);
  const branchId=req.user.role==='ADMIN'?String(req.query.branchId||''):String(req.user.branchId||'');
  const staffId=String(req.query.staffId||'');
  const data=await getStaffCalendarFast(req.user,{from:range.from,to:range.to,branchId,staffId});
  if(!data)return res.status(503).json({success:false,message:'CSDL bĂ¡o cĂ¡o chÆ°a sáºµn sĂ ng.'});
  res.json({success:true,data});
});

router.get('/reports/staff/day',allowPermission('REPORT.VIEW'),async(req,res)=>{
  const date=normalizeDateOnly(req.query.date||req.query.from||todayVN());
  const branchId=req.user.role==='ADMIN'?String(req.query.branchId||''):String(req.user.branchId||'');
  const staffId=String(req.query.staffId||'');
  const data=await getStaffDayDetailFast(req.user,{date,branchId,staffId});
  if(!data)return res.status(503).json({success:false,message:'CSDL bĂ¡o cĂ¡o chÆ°a sáºµn sĂ ng.'});
  res.json({success:true,data});
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
  const ensurePerson=(person,branchName='')=>{const key=String(person.id||person.userId||person.employeeCode||person.fullName);if(!byId.has(key))byId.set(key,{id:key,userId:person.userId||null,employeeCode:person.employeeCode||'',fullName:person.fullName||person.username||'NhĂ¢n viĂªn',branchName:branchName||person.branchName||'',shiftCount:0,primaryCount:0,changeCount:0,redCount:0,openCount:0,shiftIds:[],shifts:[]});return byId.get(key)};
  const calendar=shifts.map(shift=>({id:shift.id,shiftDate:shift.shiftDate,shiftType:shift.shiftType,status:shift.status,branchId:shift.branchId,branchName:shift.branchName||'',areaName:shift.areaName||'ToĂ n cÆ¡ sá»Ÿ',handover:!!handovers.find(h=>h.shiftId===shift.id&&h.confirmedAt),primaryRecorderId:shift.primaryRecorderId||shift.assignedStaffId||'',primaryRecorderName:shift.primaryRecorderName||shift.assignedStaffName||'',staff:(shift.assignedStaff||[]).map(p=>({id:p.id,userId:p.userId||null,employeeCode:p.employeeCode||'',fullName:p.fullName||'',isPrimary:String(p.id)===String(shift.primaryRecorderId||shift.assignedStaffId||'')}))}));
  for(const shift of shifts){for(const person of (shift.assignedStaff||[])){const row=ensurePerson(person,shift.branchName||'');row.shiftCount++;if(String(person.id)===String(shift.primaryRecorderId))row.primaryCount++;row.shiftIds.push(shift.id);row.shifts.push({id:shift.id,shiftDate:shift.shiftDate,shiftType:shift.shiftType,status:shift.status,areaName:shift.areaName||'ToĂ n cÆ¡ sá»Ÿ',branchName:shift.branchName||'',handover:!!handovers.find(h=>h.shiftId===shift.id&&h.confirmedAt),staff:(shift.assignedStaff||[]).map(p=>({id:p.id,employeeCode:p.employeeCode||'',fullName:p.fullName||''}))})}}
  // A shift participant is not necessarily the performer of each activity.
  // Legacy records without explicit attribution stay unassigned.
  for(const c of changes){
    if(!c.performedByStaffId)continue;
    const shift=shifts.find(s=>String(s.id)===String(c.shiftId));
    const person=directory.find(p=>String(p.id)===String(c.performedByStaffId))||(shift?.assignedStaff||[]).find(p=>String(p.id)===String(c.performedByStaffId))||{id:c.performedByStaffId,fullName:c.performedByStaffName||'Chưa xác định'};
    const row=ensurePerson(person,shift?.branchName||'');row.changeCount++;
    if(attentionLevel(c)==='RED')row.redCount++;if(attentionStatus(c)==='OPEN')row.openCount++;
  }
  const staffDetails=[...byId.values()].filter(x=>x.shiftCount||x.changeCount).sort((a,b)=>String(a.fullName).localeCompare(String(b.fullName),'vi'));
  res.json({success:true,data:{from:range.from,to:range.to,branchId,calendar,staffDetails,activityChanges:changes.length,unattributedChanges:changes.filter(x=>!x.performedByStaffId).length,activityBasis:'performedByStaffId'}});
});
router.get('/reports/resident/:residentId',allowPermission('REPORT.VIEW'),async(req,res)=>{
  const range=reportRange(req.query),residentId=String(req.params.residentId),branchId=req.user.role==='ADMIN'?String(req.query.branchId||''):String(req.user.branchId||'');
  const [fast,vitalReport]=await Promise.all([
    getReportBundleFast(req.user,{from:range.from,to:range.to,branchId}),
    getResidentVitalsReportFast(req.user,{residentId,from:range.from,to:range.to,branchId})
  ]);
  const s=fast?{shiftResidents:fast.residents,changeLogs:fast.changes,toiletingLogs:fast.toilets}:await getStore();
  const changes=(fast?s.changeLogs:s.changeLogs.filter(x=>!x.deleted&&inEventRange(x.occurredAt||x.createdAt,range)&&(!branchId||String(x.branchId)===branchId)&&visibleByScope(req.user,x))).filter(x=>String(x.residentId)===residentId).map(withAttention).sort((a,b)=>String(b.occurredAt||b.createdAt).localeCompare(String(a.occurredAt||a.createdAt)));
  const toileting=(fast?s.toiletingLogs:s.toiletingLogs.filter(x=>!x.deleted&&inEventRange(x.createdAt,range)&&(!branchId||String(x.branchId)===branchId)&&visibleByScope(req.user,x))).filter(x=>String(x.residentId)===residentId).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const roster=(s.shiftResidents||[]).filter(x=>String(x.residentId)===residentId);
  const base=changes[0]||toileting[0]||roster[0];
  if(!base)return res.status(404).json({success:false,message:'KhĂ´ng cĂ³ dá»¯ liá»‡u NCT trong khoáº£ng Ä‘Ă£ chá»n'});
  // Sinh hiá»‡u pháº£i láº¥y cĂ¹ng nguá»“n vá»›i timeline. Náº¿u timeline Ä‘Ă£ cĂ³ vitals thĂ¬
  // tuyá»‡t Ä‘á»‘i khĂ´ng Ä‘á»ƒ má»™t query phá»¥ lĂ m khá»‘i "Chá»‰ sá»‘ sinh tá»“n" thĂ nh rá»—ng.
  const hasVitalValue=(row)=>{
    const v=row?.vitals;
    if(!v)return false;
    return [v.pulse,v.temperature,v.bpSys,v.bpDia,v.spo2,v.respiratoryRate,v.bloodGlucose,v.insulinDoseUnits]
      .some(value=>value!==null&&value!==undefined&&value!=='');
  };
  const fallbackVitals=changes
    .filter(hasVitalValue)
    .sort((a,b)=>String(b.occurredAt||b.createdAt).localeCompare(String(a.occurredAt||a.createdAt)));

  // Æ¯u tiĂªn dá»¯ liá»‡u ngay trong changes vĂ¬ Ä‘Ă¢y chĂ­nh lĂ  nguá»“n Ä‘ang render timeline.
  // Query riĂªng chá»‰ lĂ  fallback Ä‘á»ƒ tĂ¬m láº§n Ä‘o gáº§n nháº¥t trÆ°á»›c/cuá»‘i ká»³ khi trong ká»³ khĂ´ng cĂ³ láº§n Ä‘o.
  const vitalHistory=fallbackVitals.length?fallbackVitals:(vitalReport?.readings||[]);
  const latestVitalRecord=vitalHistory[0]||vitalReport?.latest||null;
  res.json({success:true,data:{from:range.from,to:range.to,resident:{id:residentId,name:base.residentName||base.fullName||'NCT',areaName:base.areaName||'',roomName:base.roomName||'',bedName:base.bedName||''},summary:{changes:changes.length,openRed:changes.filter(x=>x.attentionLevel==='RED'&&x.attentionStatus==='OPEN').length,openYellow:changes.filter(x=>x.attentionLevel==='YELLOW'&&x.attentionStatus==='OPEN').length,resolved:changes.filter(x=>x.attentionStatus==='RESOLVED').length,handover:changes.filter(x=>x.requiresHandover).length,toiletingAbnormal:toileting.filter(x=>x.bowelStatus!=='NORMAL'||x.urineStatus!=='NORMAL').length,vitalMeasurements:vitalHistory.length},latestVitalRecord,vitalHistory,changes,toileting}});
});
router.get('/audit-logs',allowPermission('AUDIT.VIEW'),async(req,res)=>{const s=await getStore();let rows=s.auditLogs;if(req.user.role!=='ADMIN')rows=rows.filter(x=>!x.branchId||x.branchId===req.user.branchId);res.json({success:true,data:rows.slice(0,300)})});

export default router;