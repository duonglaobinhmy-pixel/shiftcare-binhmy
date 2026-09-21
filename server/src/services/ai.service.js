import { getStore } from './store.service.js';
import { getReportBundleFast } from './fast-query.service.js';

const list=value=>Array.isArray(value)?value:[];
const text=value=>String(value??'').trim();
const VN_TZ='Asia/Ho_Chi_Minh';
const todayVN=()=>new Intl.DateTimeFormat('en-CA',{timeZone:VN_TZ}).format(new Date());
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

function normalizeScope(scope={}){
  let from=text(scope.from);
  let to=text(scope.to);
  const today=todayVN();
  if(!DATE_RE.test(from)) from=today;
  if(!DATE_RE.test(to)) to=from;
  if(from>to){const tmp=from;from=to;to=tmp}
  return {
    from,
    to,
    branchId:text(scope.branchId),
    page:text(scope.page),
    residentId:text(scope.residentId)
  };
}

function visible(user,row={}){
  if(user?.role==='ADMIN')return true;
  if(row.branchId&&user?.branchId&&String(row.branchId)!==String(user.branchId))return false;
  if(user?.role==='CAREGIVER'&&user?.areaId&&row.areaId&&String(row.areaId)!==String(user.areaId))return false;
  return true;
}

function hasVital(v={}){
  return [v.pulse,v.temperature,v.bpSys,v.bpDia,v.spo2,v.respiratoryRate,v.bloodGlucose,v.insulinDoseUnits]
    .some(x=>x!==null&&x!==undefined&&x!=='');
}

function normalizeBundle(bundle={}){
  return {
    shifts:list(bundle.shifts),
    changes:list(bundle.changes),
    toilets:list(bundle.toilets),
    handovers:list(bundle.handovers),
    residents:list(bundle.residents),
    outstanding:list(bundle.outstanding)
  };
}

function dateVN(value){
  if(!value)return '';
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return '';
  return new Intl.DateTimeFormat('en-CA',{timeZone:VN_TZ}).format(d);
}

async function loadOperationalData(user,scopeInput={}){
  const scope=normalizeScope(scopeInput);
  try{
    const fast=await getReportBundleFast(user,{from:scope.from,to:scope.to,branchId:scope.branchId});
    if(fast)return normalizeBundle(fast);
  }catch(error){
    console.error('[AI] DB report context unavailable, fallback store:',error?.message||error);
  }

  const store=await getStore().catch(()=>({}));
  const branchId=user?.role==='ADMIN'?scope.branchId:String(user?.branchId||'');
  const inRange=d=>d&&d>=scope.from&&d<=scope.to;
  const shifts=list(store.shifts).filter(x=>visible(user,x)&&inRange(String(x.shiftDate||''))&&(!branchId||String(x.branchId||'')===branchId));
  const ids=new Set(shifts.map(x=>String(x.id)));
  const changes=list(store.changeLogs).filter(x=>!x.deleted&&visible(user,x)&&(!branchId||String(x.branchId||'')===branchId)&&(ids.has(String(x.shiftId))||inRange(dateVN(x.occurredAt||x.createdAt))));
  const toilets=list(store.toiletingLogs).filter(x=>!x.deleted&&visible(user,x)&&(!branchId||String(x.branchId||'')===branchId)&&(ids.has(String(x.shiftId))||inRange(dateVN(x.createdAt))));
  const handovers=list(store.handovers).filter(x=>ids.has(String(x.shiftId))&&visible(user,x));
  const residents=list(store.shiftResidents).filter(x=>ids.has(String(x.shiftId))&&visible(user,x));
  return {shifts,changes,toilets,handovers,residents,outstanding:[]};
}

function buildContext(user,data,scopeInput={}){
  const scope=normalizeScope(scopeInput);
  let {shifts,changes,toilets,handovers,residents,outstanding}=data;

  if(scope.residentId){
    changes=changes.filter(x=>String(x.residentId||'')===scope.residentId);
    toilets=toilets.filter(x=>String(x.residentId||'')===scope.residentId);
    residents=residents.filter(x=>String(x.residentId||x.bcareResidentId||'')===scope.residentId);
    outstanding=outstanding.filter(x=>String(x.residentId||'')===scope.residentId);
    const shiftIds=new Set([...changes,...toilets].map(x=>String(x.shiftId||'')).filter(Boolean));
    if(shiftIds.size)shifts=shifts.filter(x=>shiftIds.has(String(x.id)));
  }

  const redOpen=changes.filter(x=>x.attentionLevel==='RED'&&x.attentionStatus==='OPEN');
  const yellowOpen=changes.filter(x=>x.attentionLevel==='YELLOW'&&x.attentionStatus==='OPEN');
  const resolved=changes.filter(x=>x.attentionLevel&&x.attentionStatus==='RESOLVED');
  const vitals=changes.filter(x=>hasVital(x.vitals));
  const byCategory=changes.reduce((acc,x)=>{const k=x.category||'OTHER';acc[k]=(acc[k]||0)+1;return acc},{});
  const pendingReceive=handovers.filter(x=>x.confirmedAt&&!x.receivedAt);
  const abnormalToileting=toilets.filter(x=>x.bowelStatus!=='NORMAL'||x.urineStatus!=='NORMAL');
  const handoverItems=changes.filter(x=>x.requiresHandover);

  const latestVitalsByResident=new Map();
  for(const row of [...vitals].sort((a,b)=>String(b.occurredAt||b.createdAt||'').localeCompare(String(a.occurredAt||a.createdAt||'')))){
    const key=String(row.residentId||'');
    if(key&&!latestVitalsByResident.has(key))latestVitalsByResident.set(key,row);
  }

  return {
    scope,
    user:{role:user?.role||'',branchId:user?.branchId||'',branchName:user?.branchName||'Toàn hệ thống'},
    stats:{
      shifts:shifts.length,
      residents:new Set([...residents.map(x=>String(x.residentId||x.bcareResidentId||'')),...changes.map(x=>String(x.residentId||'')),...toilets.map(x=>String(x.residentId||''))].filter(Boolean)).size,
      changes:changes.length,
      redOpen:redOpen.length,
      yellowOpen:yellowOpen.length,
      resolvedAlerts:resolved.length,
      requiresHandover:handoverItems.length,
      abnormalToileting:abnormalToileting.length,
      pendingReceive:pendingReceive.length,
      vitalMeasurements:vitals.length,
      byCategory
    },
    recentChanges:[...changes].sort((a,b)=>String(b.occurredAt||b.createdAt||'').localeCompare(String(a.occurredAt||a.createdAt||''))).slice(0,50).map(x=>({
      id:x.id,residentId:x.residentId,residentName:x.residentName,category:x.category,eventType:x.eventType,priority:x.priority,
      content:x.content,intervention:x.intervention,requiresHandover:!!x.requiresHandover,followUp:x.followUp,
      attentionLevel:x.attentionLevel,attentionStatus:x.attentionStatus,occurredAt:x.occurredAt||x.createdAt,vitals:x.vitals||null
    })),
    openAlerts:[...redOpen,...yellowOpen].slice(0,50).map(x=>({id:x.id,residentId:x.residentId,residentName:x.residentName,level:x.attentionLevel,content:x.content,occurredAt:x.occurredAt||x.createdAt})),
    abnormalToileting:abnormalToileting.slice(0,30).map(x=>({id:x.id,residentId:x.residentId,residentName:x.residentName,bowelStatus:x.bowelStatus,urineStatus:x.urineStatus,note:x.note,createdAt:x.createdAt})),
    handoverItems:handoverItems.slice(0,50).map(x=>({id:x.id,residentId:x.residentId,residentName:x.residentName,followUp:x.followUp||'',attentionLevel:x.attentionLevel||null,occurredAt:x.occurredAt||x.createdAt})),
    latestVitals:[...latestVitalsByResident.values()].slice(0,50).map(x=>({residentId:x.residentId,residentName:x.residentName,occurredAt:x.occurredAt||x.createdAt,vitals:x.vitals})),
    outstanding:list(outstanding).slice(0,50).map(x=>({id:x.id,residentId:x.residentId,residentName:x.residentName,level:x.attentionLevel,content:x.content,occurredAt:x.occurredAt||x.createdAt}))
  };
}

async function contextForUser(user,scope={}){
  const normalized=normalizeScope(scope);
  const data=await loadOperationalData(user,normalized);
  return buildContext(user,data,normalized);
}

function sourceRows(context){
  return context.recentChanges.slice(0,8).map(x=>({type:'CHANGE_LOG',id:x.id,label:x.residentName||'NCT'}));
}

function rangeText(scope){return scope.from===scope.to?scope.from:`${scope.from} → ${scope.to}`}

function vitalsText(v={}){
  const parts=[];
  if(v.pulse!=null)parts.push(`mạch ${v.pulse}`);
  if(v.temperature!=null)parts.push(`nhiệt ${v.temperature}°C`);
  if(v.bpSys!=null||v.bpDia!=null)parts.push(`HA ${v.bpSys??'—'}/${v.bpDia??'—'}`);
  if(v.spo2!=null)parts.push(`SpO₂ ${v.spo2}%`);
  if(v.respiratoryRate!=null)parts.push(`thở ${v.respiratoryRate}`);
  if(v.bloodGlucose!=null)parts.push(`đường huyết ${v.bloodGlucose} mg/dL`);
  if(v.insulinDoseUnits!=null)parts.push(`insulin ${v.insulinDoseUnits} IU`);
  return parts.join(', ');
}

function localDailyReport(context){
  const s=context.stats;
  const scopeLabel=rangeText(context.scope);
  const alerts=context.openAlerts.slice(0,6).map(x=>`${x.level} ${x.residentName}: ${x.content}`).join(' | ');
  const handover=context.handoverItems.slice(0,6).map(x=>`${x.residentName}: ${x.followUp||'chưa ghi nội dung ca sau'}`).join(' | ');
  const vitals=context.latestVitals.slice(0,6).map(x=>`${x.residentName}: ${vitalsText(x.vitals)}`).filter(x=>!x.endsWith(': ')).join(' | ');
  return [
    `Báo cáo ${scopeLabel}: ${s.shifts} ca, ${s.changes} biến động, ${s.vitalMeasurements} lần có chỉ số sinh tồn.`,
    `Cảnh báo đang mở: ${s.redOpen} đỏ, ${s.yellowOpen} vàng; ${s.requiresHandover} mục cần bàn giao; ${s.abnormalToileting} ghi nhận tiêu/tiểu cần lưu ý.`,
    alerts?`Ưu tiên xử lý: ${alerts}.`:'Không có cảnh báo đỏ/vàng đang mở trong phạm vi báo cáo.',
    handover?`Bàn giao cần theo dõi: ${handover}.`:'Không có mục nào được đánh dấu cần bàn giao trong phạm vi báo cáo.',
    vitals?`Chỉ số gần nhất trong phạm vi: ${vitals}.`:''
  ].filter(Boolean).join(' ');
}

function fallbackAnswer(question,context){
  const q=text(question).toLowerCase();
  const s=context.stats;
  const scopeLabel=rangeText(context.scope);
  if(/báo cáo|bao cao|tóm tắt|tom tat|tổng hợp|tong hop/.test(q))return localDailyReport(context);
  if(/cảnh báo|canh bao|đỏ|do\b|vàng|vang/.test(q)){
    if(!context.openAlerts.length)return `Trong ${scopeLabel}, không có cảnh báo đỏ/vàng đang mở trong phạm vi bạn được xem.`;
    return `Trong ${scopeLabel} có ${s.redOpen} cảnh báo đỏ và ${s.yellowOpen} cảnh báo vàng đang mở. ${context.openAlerts.slice(0,10).map(x=>`${x.level} ${x.residentName}: ${x.content}`).join(' | ')}`;
  }
  if(/bàn giao|ban giao|chưa xong|chua xong/.test(q)){
    return s.requiresHandover
      ?`Trong ${scopeLabel} có ${s.requiresHandover} mục cần bàn giao. ${context.handoverItems.slice(0,10).map(x=>`${x.residentName}: ${x.followUp||'Chưa nhập việc ca sau'}`).join(' | ')}`
      :`Trong ${scopeLabel} không có mục nào được đánh dấu cần bàn giao.`;
  }
  if(/tiêu|tieu|tiểu|tieu tien|nước tiểu|nuoc tieu/.test(q)){
    return s.abnormalToileting
      ?`Trong ${scopeLabel} có ${s.abnormalToileting} ghi nhận tiêu/tiểu cần lưu ý. ${context.abnormalToileting.slice(0,10).map(x=>`${x.residentName}: tiêu ${x.bowelStatus||'—'}, tiểu ${x.urineStatus||'—'}${x.note?` (${x.note})`:''}`).join(' | ')}`
      :`Trong ${scopeLabel} chưa có ghi nhận tiêu/tiểu bất thường trong phạm vi bạn được xem.`;
  }
  if(/sinh tồn|sinh ton|mạch|mach|spo|huyết áp|huyet ap|nhiệt|nhiet|đường huyết|duong huyet|insulin/.test(q)){
    if(!context.latestVitals.length)return `Trong ${scopeLabel} chưa có chỉ số sinh tồn trong phạm vi bạn được xem.`;
    return `Trong ${scopeLabel} có ${s.vitalMeasurements} lần ghi chỉ số sinh tồn. Gần nhất theo từng NCT: ${context.latestVitals.slice(0,10).map(x=>`${x.residentName}: ${vitalsText(x.vitals)}`).join(' | ')}`;
  }
  if(/ngã|nga\b|trượt|truot/.test(q)){
    const rows=context.recentChanges.filter(x=>/ngã|nga\b|trượt|truot/i.test(String(x.content||''))||x.eventType==='FALL');
    return rows.length?`Trong ${scopeLabel} có ${rows.length} ghi nhận liên quan ngã/trượt: ${rows.map(x=>`${x.residentName}: ${x.content}`).join(' | ')}`:`Trong ${scopeLabel} chưa có bản ghi liên quan ngã/trượt trong phạm vi bạn được xem.`;
  }
  return `Dữ liệu ${scopeLabel}: ${s.shifts} ca, ${s.changes} biến động, ${s.redOpen} đỏ đang mở, ${s.yellowOpen} vàng đang mở, ${s.requiresHandover} mục cần bàn giao và ${s.vitalMeasurements} lần có chỉ số sinh tồn. Bạn có thể hỏi về cảnh báo, bàn giao, sinh hiệu, tiêu/tiểu hoặc yêu cầu tóm tắt.`;
}

function geminiModelCandidates(){
  const configured=text(process.env.GEMINI_MODEL);
  return [...new Set([configured,'gemini-2.5-flash','gemini-2.0-flash'].filter(Boolean))];
}
function isAccessDenied(error){return /project has been denied access|permission denied|access denied|api key.*(invalid|blocked)|forbidden|403/i.test(String(error?.message||''))}
let geminiBlockedReason='';
function markGeminiBlocked(error){if(isAccessDenied(error))geminiBlockedReason=String(error?.message||'Gemini access denied')}
function publicGeminiWarning(){return geminiBlockedReason?'Gemini ngoài đang bị Google từ chối quyền truy cập; hệ thống đang dùng báo cáo nội bộ từ CSDL.':''}

export function getAIStatus(){
  const geminiConfigured=Boolean(text(process.env.GEMINI_API_KEY));
  const sttFallbackConfigured=Boolean(text(process.env.STT_API_URL));
  return {
    geminiConfigured,
    geminiAvailable:geminiConfigured&&!geminiBlockedReason,
    geminiBlocked:Boolean(geminiBlockedReason),
    geminiWarning:publicGeminiWarning(),
    browserSpeechPreferred:true,
    voiceMode:'browser-speech',
    sttFallbackConfigured,
    internalReportAvailable:true
  };
}

async function callGeminiText(key,model,body){
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data?.error?.message||`Gemini HTTP ${response.status}`);error.status=response.status;throw error}
  return data;
}

async function askGemini(context,message){
  const key=text(process.env.GEMINI_API_KEY);
  if(!key||geminiBlockedReason)return null;
  const system='Bạn là trợ lý báo cáo ShiftCare Bình Mỹ. CHỈ dùng CONTEXT JSON. Không chẩn đoán, không bịa số, không suy diễn dữ liệu thiếu, không sửa hồ sơ. Phải tôn trọng đúng khoảng ngày/cơ sở/resident trong context. Ưu tiên cảnh báo đỏ/vàng, bàn giao, sinh hiệu bất thường và biến động gần nhất. Trả lời tiếng Việt rõ, ngắn, có số liệu đúng như context.';
  const body={contents:[{role:'user',parts:[{text:`${system}\n\nCONTEXT JSON:\n${JSON.stringify(context)}\n\nYÊU CẦU:\n${message}`}]}],generationConfig:{temperature:0.1,maxOutputTokens:900}};
  let lastError=null;
  for(const model of geminiModelCandidates()){
    try{
      const data=await callGeminiText(key,model,body);
      const answer=data?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('').trim();
      if(answer)return {answer,mode:'gemini',model};
      throw new Error('Gemini không trả nội dung.');
    }catch(error){
      lastError=error;
      console.error(`[AI] Gemini ${model} failed:`,error?.message||error);
      if(isAccessDenied(error)){markGeminiBlocked(error);break}
    }
  }
  return {error:lastError};
}

export async function answerAI(user,message,scope={}){
  const context=await contextForUser(user,scope);
  const gemini=await askGemini(context,message);
  if(gemini?.answer)return {...gemini,sources:sourceRows(context),scope:context.scope};
  return {
    answer:fallbackAnswer(message,context),
    mode:'local-report',
    model:null,
    warning:geminiBlockedReason?publicGeminiWarning():(gemini?.error?`AI ngoài tạm không khả dụng; đã dùng báo cáo nội bộ: ${String(gemini.error?.message||'')}`:'Đang dùng báo cáo nội bộ từ CSDL.'),
    sources:sourceRows(context),
    scope:context.scope,
    stats:context.stats
  };
}

export async function generateDailyReport(user,scope={}){
  const context=await contextForUser(user,scope);
  const prompt=`Tạo báo cáo vận hành trong phạm vi ${rangeText(context.scope)}. Nêu tổng số ca, biến động, cảnh báo đỏ/vàng đang mở, bàn giao, tiêu/tiểu cần lưu ý, chỉ số sinh tồn và các NCT cần ưu tiên. Không chẩn đoán.`;
  const gemini=await askGemini(context,prompt);
  return {
    answer:gemini?.answer||localDailyReport(context),
    mode:gemini?.answer?'gemini':'local-report',
    model:gemini?.model||null,
    warning:gemini?.answer?'':(geminiBlockedReason?publicGeminiWarning():'Báo cáo được tạo nội bộ trực tiếp từ CSDL.'),
    stats:context.stats,
    sources:sourceRows(context),
    scope:context.scope
  };
}

function conservativeTranscript(value){
  let cleaned=text(value).replace(/\s+/g,' ').replace(/\s+([,.;:!?])/g,'$1');
  cleaned=cleaned.replace(/\bsp\s*o\s*2\b/gi,'SpO₂').replace(/\bmm\s*hg\b/gi,'mmHg');
  if(cleaned)cleaned=cleaned[0].toUpperCase()+cleaned.slice(1);
  return cleaned;
}
function numberSignature(value){return (String(value).match(/\d+(?:[.,]\d+)?/g)||[]).map(x=>x.replace(',','.'))}
function safeTranscript(original,candidate){
  const source=text(original),cleaned=text(candidate);
  if(!cleaned)return false;
  if(JSON.stringify(numberSignature(source))!==JSON.stringify(numberSignature(cleaned)))return false;
  const ratio=cleaned.length/Math.max(source.length,1);
  return ratio>=0.65&&ratio<=1.35;
}

export async function cleanTranscriptAI(value){
  const original=text(value),local=conservativeTranscript(original),key=text(process.env.GEMINI_API_KEY);
  if(!original)return{original:'',cleaned:'',mode:'local'};
  if(geminiBlockedReason)return{original,cleaned:local,mode:'local-fallback',warning:publicGeminiWarning()};
  if(!key)return{original,cleaned:local,mode:'local',warning:'Đã làm sạch cục bộ; không cần AI ngoài.'};
  const instruction='Chỉ sửa dấu câu, viết hoa, khoảng trắng và chuẩn hóa SpO2/mmHg/độ C. CẤM đổi, thêm hoặc xóa con số; cấm thêm triệu chứng, chẩn đoán, hành động, tên người hoặc thời gian. Chỉ trả JSON {"cleaned":"..."}.';
  const body={contents:[{role:'user',parts:[{text:`${instruction}\n\nBẢN GỐC:\n${original}`}]}],generationConfig:{temperature:0,maxOutputTokens:500,responseMimeType:'application/json'}};
  for(const model of geminiModelCandidates()){
    try{
      const data=await callGeminiText(key,model,body);
      const raw=data?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('').trim()||'';
      const parsed=JSON.parse(raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
      const cleaned=conservativeTranscript(parsed.cleaned);
      if(!safeTranscript(original,cleaned))return{original,cleaned:local,mode:'guarded-fallback',warning:'Bản AI bị loại vì có nguy cơ thay đổi số liệu.'};
      return{original,cleaned,mode:'gemini',model};
    }catch(error){if(isAccessDenied(error)){markGeminiBlocked(error);break}}
  }
  return{original,cleaned:local,mode:'local-fallback',warning:'AI ngoài không khả dụng; đã làm sạch cục bộ.'};
}

function normalizedAudioMime(mimeType){
  const raw=String(mimeType||'audio/webm').toLowerCase().trim();
  if(raw.startsWith('audio/webm'))return'audio/webm';
  if(raw.startsWith('audio/ogg'))return'audio/ogg';
  if(raw.startsWith('audio/mp4'))return'audio/mp4';
  if(raw==='audio/x-wav')return'audio/wav';
  if(raw==='audio/mp3')return'audio/mpeg';
  return raw;
}
function audioExtension(mimeType){if(mimeType==='audio/mp4')return'm4a';if(mimeType==='audio/ogg')return'ogg';if(mimeType==='audio/wav')return'wav';if(mimeType==='audio/mpeg')return'mp3';return'webm'}

async function transcribeExternalSTT(data,mimeType,size){
  const url=text(process.env.STT_API_URL);
  if(!url)return null;
  const key=text(process.env.STT_API_KEY),model=text(process.env.STT_MODEL)||'whisper-1';
  const bytes=Buffer.from(data,'base64');
  const form=new FormData();
  form.append('file',new Blob([bytes],{type:mimeType}),`shiftcare-voice.${audioExtension(mimeType)}`);
  if(model)form.append('model',model);
  form.append('language','vi');
  const headers={};if(key)headers.Authorization=`Bearer ${key}`;
  const response=await fetch(url,{method:'POST',headers,body:form});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(payload?.error?.message||payload?.message||`STT HTTP ${response.status}`);error.status=response.status;throw error}
  const transcript=text(payload?.text||payload?.transcript||payload?.data?.text||payload?.data?.transcript);
  if(!transcript)throw new Error('Dịch vụ STT không trả nội dung chép lời.');
  return{transcript:conservativeTranscript(transcript),mode:'external-stt',model,mimeType,sizeBytes:size};
}

export async function transcribeAudioAI(audioBase64,mimeType='audio/webm'){
  const normalizedMime=normalizedAudioMime(mimeType);
  const allowed=new Set(['audio/webm','audio/mp4','audio/ogg','audio/wav','audio/mpeg']);
  if(!allowed.has(normalizedMime))throw new Error(`Định dạng âm thanh chưa hỗ trợ: ${normalizedMime}`);
  const data=String(audioBase64||'').replace(/^data:[^;]+;base64,/,'');
  const size=Buffer.byteLength(data,'base64');
  if(!data||size<100)throw new Error('Đoạn âm thanh trống hoặc quá ngắn.');
  if(size>6*1024*1024)throw new Error('Đoạn âm thanh vượt quá giới hạn 6 MB.');
  const external=await transcribeExternalSTT(data,normalizedMime,size);
  if(external)return external;
  const error=new Error('Server không dùng Gemini để chép lời nữa. Hãy dùng nhận dạng giọng nói trực tiếp trên Chrome/Safari hoặc cấu hình STT_API_URL.');
  error.status=503;
  throw error;
}
