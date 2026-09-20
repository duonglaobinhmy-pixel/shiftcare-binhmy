import { getStore } from './store.service.js';

function list(value){return Array.isArray(value)?value:[]}
function visible(user,row={}){
  if(user?.role==='ADMIN')return true;
  if(row.branchId&&user?.branchId&&row.branchId!==user.branchId)return false;
  return true;
}
function todayVN(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date())}
function sourceRows(context){return context.recentChanges.slice(0,5).map(x=>({type:'CHANGE_LOG',id:x.id,label:x.residentName}))}

function compact(user,store={}){
  const shifts=list(store.shifts).filter(x=>visible(user,x));
  const ids=new Set(shifts.map(x=>x.id));
  const changes=list(store.changeLogs).filter(x=>!x.deleted&&ids.has(x.shiftId)&&visible(user,x));
  const toilets=list(store.toiletingLogs).filter(x=>!x.deleted&&ids.has(x.shiftId)&&visible(user,x));
  const handovers=list(store.handovers).filter(x=>ids.has(x.shiftId)&&visible(user,x));
  const date=todayVN();
  const todayShifts=shifts.filter(x=>x.shiftDate===date);
  const todayIds=new Set(todayShifts.map(x=>x.id));
  const todayChanges=changes.filter(x=>todayIds.has(x.shiftId));
  const todayToilets=toilets.filter(x=>todayIds.has(x.shiftId));
  const byCategory=todayChanges.reduce((acc,x)=>{acc[x.category]=(acc[x.category]||0)+1;return acc},{});
  return {
    date,
    user:{role:user?.role||'',branchName:user?.branchName||'Toàn hệ thống'},
    stats:{
      todayShifts:todayShifts.length,
      todayChanges:todayChanges.length,
      requiresHandover:todayChanges.filter(x=>x.requiresHandover).length,
      abnormalToileting:todayToilets.filter(x=>x.bowelStatus!=='NORMAL'||x.urineStatus!=='NORMAL').length,
      pendingReceive:handovers.filter(x=>x.confirmedAt&&!x.receivedAt).length,
      byCategory
    },
    recentChanges:todayChanges.slice(0,30).map(x=>({id:x.id,residentName:x.residentName,category:x.category,content:x.content,requiresHandover:x.requiresHandover,followUp:x.followUp,createdAt:x.createdAt})),
    abnormalToileting:todayToilets.filter(x=>x.bowelStatus!=='NORMAL'||x.urineStatus!=='NORMAL').slice(0,20).map(x=>({id:x.id,residentName:x.residentName,bowelStatus:x.bowelStatus,urineStatus:x.urineStatus,note:x.note})),
    openHandover:todayChanges.filter(x=>x.requiresHandover).slice(0,30).map(x=>({id:x.id,residentName:x.residentName,followUp:x.followUp}))
  };
}

function fallbackAnswer(question,context){
  const q=String(question||'').toLowerCase();
  const s=context.stats;
  if(q.includes('ngã')||q.includes('nga')||q.includes('trượt')||q.includes('truot')){
    const rows=context.recentChanges.filter(x=>/ngã|nga\b|trượt|truot/i.test(String(x.content||'')));
    return rows.length?`Hôm nay có ${rows.length} ghi nhận có nội dung liên quan ngã/trượt: ${rows.map(x=>`${x.residentName}: ${x.content}`).join(' | ')}`:'Hôm nay chưa có bản ghi nào có nội dung liên quan ngã/trượt trong phạm vi bạn được xem.';
  }
  if(q.includes('bàn giao')||q.includes('ban giao')||q.includes('chưa xong')||q.includes('chua xong')){
    return s.requiresHandover?`Có ${s.requiresHandover} mục cần bàn giao. ${context.openHandover.map(x=>`${x.residentName}: ${x.followUp||'Chưa nhập việc cần làm tiếp'}`).join(' | ')}`:'Hiện chưa có mục nào được đánh dấu cần bàn giao trong dữ liệu hôm nay.';
  }
  if(q.includes('chú ý')||q.includes('chu y')||q.includes('tóm tắt')||q.includes('tom tat')||q.includes('báo cáo')||q.includes('bao cao')){
    const details=context.recentChanges.slice(0,6).map(x=>`${x.residentName}: ${x.content}`).join(' | ');
    return `Hôm nay có ${s.todayShifts} ca, ${s.todayChanges} ghi nhận biến động, ${s.requiresHandover} mục cần bàn giao, ${s.abnormalToileting} ghi nhận tiêu/tiểu bất thường và ${s.pendingReceive} ca đã giao nhưng chưa nhận.${details?` Chi tiết gần nhất: ${details}`:''}`;
  }
  return `Trong dữ liệu hôm nay: ${s.todayChanges} biến động, ${s.requiresHandover} mục cần bàn giao, ${s.abnormalToileting} ghi nhận tiêu/tiểu bất thường. Bạn có thể hỏi cụ thể về NCT cần chú ý, bàn giao hoặc trường hợp ngã.`;
}

function geminiModelCandidates(){
  const configured=String(process.env.GEMINI_MODEL||'').trim();
  // Luôn ưu tiên model do môi trường cấu hình. Các model sau chỉ là fallback tương thích.
  return [...new Set([configured,'gemini-2.5-flash','gemini-2.0-flash'].filter(Boolean))];
}
function isAccessDenied(error){return /project has been denied access|permission denied|access denied|api key.*(invalid|blocked)|forbidden|403/i.test(String(error?.message||''))}

// Nếu Gemini trả 403/project denied, ghi nhớ trong process hiện tại để chatbot không chờ lỗi lặp lại.
let geminiBlockedReason='';
function markGeminiBlocked(error){
  if(isAccessDenied(error))geminiBlockedReason=String(error?.message||'Gemini access denied');
}
function publicGeminiWarning(){
  return geminiBlockedReason
    ? 'Gemini ngoài đang bị Google từ chối quyền truy cập; hệ thống đã tự chuyển sang chế độ nội bộ.'
    : '';
}
export function getAIStatus(){
  const geminiConfigured=Boolean(String(process.env.GEMINI_API_KEY||'').trim());
  const sttFallbackConfigured=Boolean(String(process.env.STT_API_URL||'').trim());
  return {
    geminiConfigured,
    geminiAvailable:geminiConfigured&&!geminiBlockedReason,
    geminiBlocked:Boolean(geminiBlockedReason),
    geminiWarning:publicGeminiWarning(),
    browserSpeechPreferred:true,
    sttFallbackConfigured
  };
}

async function callGeminiText(key,model,body){
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(data?.error?.message||`Gemini HTTP ${response.status}`);
    error.status=response.status;
    throw error;
  }
  return data;
}

export async function answerAI(user,message){
  let context;
  try{context=compact(user,await getStore())}
  catch(error){
    console.error('[AI] Cannot build context:',error);
    context=compact(user,{});
  }

  const key=String(process.env.GEMINI_API_KEY||'').trim();
  if(geminiBlockedReason){
    return {answer:fallbackAnswer(message,context),mode:'local-fallback',model:null,warning:publicGeminiWarning(),sources:sourceRows(context)};
  }
  if(!key){
    return {answer:fallbackAnswer(message,context),mode:'local-demo',model:null,warning:'Chưa cấu hình GEMINI_API_KEY; đang dùng phân tích nội bộ.',sources:sourceRows(context)};
  }

  const system='Bạn là Trợ lý ShiftCare của Bình Mỹ Care. Chỉ dùng CONTEXT được cung cấp. Không chẩn đoán y khoa. Không tự tạo số liệu, không suy đoán dữ liệu thiếu. Không được đề nghị hay thực hiện sửa/xóa/ký dữ liệu. Câu “không có biến động ghi nhận” không đồng nghĩa NCT hoàn toàn bình thường. Trả lời ngắn, rõ, tiếng Việt. Nếu hỏi số lượng, chỉ dùng số trong stats.';
  const body={contents:[{role:'user',parts:[{text:`${system}\n\nCONTEXT JSON:\n${JSON.stringify(context)}\n\nCÂU HỎI:\n${message}`}]}],generationConfig:{temperature:0.2,maxOutputTokens:900}};
  let lastError=null;
  for(const model of geminiModelCandidates()){
    try{
      const data=await callGeminiText(key,model,body);
      const answer=data?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('').trim();
      if(!answer)throw new Error('Gemini không trả nội dung.');
      return {answer,mode:'gemini',model,sources:sourceRows(context)};
    }catch(error){
      lastError=error;
      console.error(`[AI] Gemini ${model} failed:`,error?.message||error);
      if(isAccessDenied(error)){markGeminiBlocked(error);break;}
    }
  }

  // Chatbot luôn còn hoạt động ở chế độ nội bộ nếu Gemini/key/quota/model/mạng lỗi.
  return {answer:fallbackAnswer(message,context),mode:'local-fallback',model:null,warning:isAccessDenied(lastError)?'Gemini ngoài đang bị Google từ chối quyền truy cập; đang dùng phân tích nội bộ.':`Gemini tạm không khả dụng; đang dùng phân tích nội bộ: ${String(lastError?.message||'Unknown error')}`,sources:sourceRows(context)};
}

function conservativeTranscript(text){
  let cleaned=String(text||'').trim().replace(/\s+/g,' ').replace(/\s+([,.;:!?])/g,'$1');
  cleaned=cleaned.replace(/\bsp\s*o\s*2\b/gi,'SpO₂').replace(/\bmm\s*hg\b/gi,'mmHg');
  if(cleaned)cleaned=cleaned[0].toUpperCase()+cleaned.slice(1);
  return cleaned;
}
function numberSignature(text){return (String(text).match(/\d+(?:[.,]\d+)?/g)||[]).map(x=>x.replace(',','.'))}
function safeTranscript(original,candidate){
  const source=String(original).trim(),cleaned=String(candidate||'').trim();
  if(!cleaned)return false;
  if(JSON.stringify(numberSignature(source))!==JSON.stringify(numberSignature(cleaned)))return false;
  const ratio=cleaned.length/Math.max(source.length,1);
  return ratio>=0.65&&ratio<=1.35;
}

export async function cleanTranscriptAI(text){
  const original=String(text||'').trim();
  const local=conservativeTranscript(original);
  const key=String(process.env.GEMINI_API_KEY||'').trim();
  if(geminiBlockedReason)return{original,cleaned:local,mode:'local-fallback',warning:publicGeminiWarning()};
  if(!key)return{original,cleaned:local,mode:'local',warning:'Chưa cấu hình GEMINI_API_KEY; chỉ chuẩn hóa khoảng trắng và thuật ngữ kỹ thuật.'};
  const instruction='Bạn chỉ làm sạch bản chép lời tiếng Việt trong phiếu chăm sóc người cao tuổi. ĐƯỢC PHÉP: sửa dấu câu, viết hoa, khoảng trắng, từ nhận dạng sai khi hoàn toàn chắc chắn, chuẩn hóa SpO2/mmHg/độ C. CẤM: thêm hoặc bớt sự kiện, triệu chứng, chẩn đoán, hành động, tên người, thời gian; cấm suy diễn; cấm đổi, thêm hoặc xóa bất kỳ con số nào. Nếu không chắc, giữ nguyên từ gốc. Chỉ trả JSON {"cleaned":"..."}.';
  const body={contents:[{role:'user',parts:[{text:`${instruction}\n\nBẢN GỐC:\n${original}`}]}],generationConfig:{temperature:0,maxOutputTokens:500,responseMimeType:'application/json'}};
  let lastError=null;
  for(const model of geminiModelCandidates()){
    try{
      const data=await callGeminiText(key,model,body);
      const raw=data?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('').trim()||'';
      const parsed=JSON.parse(raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
      const cleaned=conservativeTranscript(parsed.cleaned);
      if(!safeTranscript(original,cleaned))return{original,cleaned:local,mode:'guarded-fallback',warning:'Bản AI bị loại vì có nguy cơ thay đổi con số hoặc thêm/bớt quá nhiều nội dung.'};
      return{original,cleaned,mode:'gemini',model};
    }catch(error){lastError=error;if(isAccessDenied(error)){markGeminiBlocked(error);break}}
  }
  return{original,cleaned:local,mode:'local-fallback',warning:`AI không khả dụng; đang dùng làm sạch cục bộ: ${String(lastError?.message||'Unknown error')}`};
}

function normalizedAudioMime(mimeType){
  const raw=String(mimeType||'audio/webm').toLowerCase().trim();
  // Gemini thường chấp nhận mime base tốt hơn chuỗi có codecs.
  if(raw.startsWith('audio/webm'))return 'audio/webm';
  if(raw.startsWith('audio/ogg'))return 'audio/ogg';
  if(raw.startsWith('audio/mp4'))return 'audio/mp4';
  if(raw==='audio/x-wav')return 'audio/wav';
  if(raw==='audio/mp3')return 'audio/mpeg';
  return raw;
}

function audioExtension(mimeType){
  if(mimeType==='audio/mp4')return 'm4a';
  if(mimeType==='audio/ogg')return 'ogg';
  if(mimeType==='audio/wav')return 'wav';
  if(mimeType==='audio/mpeg')return 'mp3';
  return 'webm';
}

async function transcribeExternalSTT(data,mimeType,size){
  const url=String(process.env.STT_API_URL||'').trim();
  if(!url)return null;
  const key=String(process.env.STT_API_KEY||'').trim();
  const model=String(process.env.STT_MODEL||'whisper-1').trim();
  const bytes=Buffer.from(data,'base64');
  const form=new FormData();
  form.append('file',new Blob([bytes],{type:mimeType}),`shiftcare-voice.${audioExtension(mimeType)}`);
  if(model)form.append('model',model);
  form.append('language','vi');
  const headers={};
  if(key)headers.Authorization=`Bearer ${key}`;
  const response=await fetch(url,{method:'POST',headers,body:form});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(payload?.error?.message||payload?.message||`STT HTTP ${response.status}`);
    error.status=response.status;
    throw error;
  }
  const transcript=String(payload?.text||payload?.transcript||payload?.data?.text||payload?.data?.transcript||'').trim();
  if(!transcript)throw new Error('Dịch vụ STT không trả nội dung chép lời.');
  return {transcript:conservativeTranscript(transcript),mode:'external-stt',model:model||null,mimeType,sizeBytes:size};
}

export async function transcribeAudioAI(audioBase64,mimeType='audio/webm'){
  const key=String(process.env.GEMINI_API_KEY||'').trim();
  const normalizedMime=normalizedAudioMime(mimeType);
  const allowed=new Set(['audio/webm','audio/mp4','audio/ogg','audio/wav','audio/mpeg']);
  if(!allowed.has(normalizedMime))throw new Error(`Định dạng âm thanh chưa hỗ trợ: ${normalizedMime}`);
  const data=String(audioBase64||'').replace(/^data:[^;]+;base64,/,''),size=Buffer.byteLength(data,'base64');
  if(!data||size<100)throw new Error('Đoạn âm thanh trống hoặc quá ngắn.');
  if(size>6*1024*1024)throw new Error('Đoạn âm thanh vượt quá giới hạn 6 MB.');

  try{
    const external=await transcribeExternalSTT(data,normalizedMime,size);
    if(external)return external;
  }catch(error){
    console.error('[STT] External provider failed:',error?.message||error);
    if(!key||geminiBlockedReason){error.status=503;throw error;}
  }

  if(geminiBlockedReason){
    const error=new Error('Không có dịch vụ chép lời dự phòng: Gemini đang bị Google từ chối quyền truy cập. Trên Chrome, hãy dùng nhận dạng giọng nói trực tiếp hoặc cấu hình STT_API_URL.');
    error.status=503;
    throw error;
  }
  if(!key){
    const error=new Error('Chưa cấu hình dịch vụ chép lời dự phòng. Trên Chrome hệ thống vẫn dùng nhận dạng giọng nói trực tiếp; để chép file âm thanh hãy cấu hình STT_API_URL hoặc GEMINI_API_KEY.');
    error.status=503;
    throw error;
  }

  const prompt='Chép nguyên văn lời nói tiếng Việt trong đoạn âm thanh thành một đoạn văn ngắn dùng cho nhật ký chăm sóc người cao tuổi. Giữ nguyên mọi con số, tên riêng, phủ định và mức độ. Không thêm triệu chứng, chẩn đoán, hành động hay thông tin không nghe thấy. Không suy đoán từ bị mất; chỗ không nghe rõ ghi [không nghe rõ]. Chỉ trả lại nội dung chép lời, không markdown, không giải thích. Nếu hoàn toàn không có lời nói, trả EMPTY_AUDIO.';
  let lastError=null;
  for(const model of geminiModelCandidates()){
    try{
      const body={contents:[{role:'user',parts:[{text:prompt},{inlineData:{mimeType:normalizedMime,data}}]}],generationConfig:{temperature:0,maxOutputTokens:700}};
      const json=await callGeminiText(key,model,body);
      const transcript=json?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('').trim()||'';
      if(!transcript||transcript==='EMPTY_AUDIO')throw new Error('Không phát hiện lời nói trong đoạn âm thanh.');
      return{transcript:conservativeTranscript(transcript.replace(/^```(?:text)?\s*/i,'').replace(/\s*```$/,'')),mode:'gemini-audio',model,mimeType:normalizedMime,sizeBytes:size};
    }catch(error){
      lastError=error;
      console.error(`[AI AUDIO] Gemini ${model} failed:`,error?.message||error);
      if(isAccessDenied(error)){markGeminiBlocked(error);break;}
    }
  }
  throw new Error(`Không thể chép lời bằng Gemini: ${String(lastError?.message||'Unknown error')}`);
}
