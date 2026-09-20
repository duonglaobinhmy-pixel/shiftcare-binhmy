import { useEffect,useMemo,useRef,useState } from 'react';
import { useParams,useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const categories=[['HEALTH','Sức khỏe'],['NUTRITION','Dinh dưỡng / ăn uống'],['INCIDENT','Ngã / sự cố'],['PSYCHOLOGY','Tâm lý / hành vi'],['SKIN','Ngoài da'],['OTHER','Khác']];
const eventTypes=[['OBSERVATION','Theo dõi / quan sát'],['FALL','Ngã / trượt'],['PAIN','Đau / khó chịu'],['MEAL','Ăn uống'],['RESPIRATORY','Hô hấp / đờm'],['SKIN','Da / vết thương'],['BEHAVIOR','Hành vi / tâm lý'],['HOSPITAL','Đi viện / tái khám'],['FAMILY','Người nhà'],['OTHER','Khác']];
const levels=[['LOW','Thông tin'],['MEDIUM','Cần theo dõi'],['HIGH','Ưu tiên cao']];
const urineStatuses=[['NORMAL','BT'],['SONDE','Tiểu qua sonde'],['CATHETER','Tiểu qua ống tiểu'],['DIAPER','Tiểu qua tã'],['OTHER','Khác']];
const bowelLabels={NORMAL:'Bình thường',CONSTIPATION:'Táo bón',DIARRHEA:'Tiêu chảy',OTHER:'Khác'};
const urineLabels={...Object.fromEntries(urineStatuses),LOW:'Tiểu ít',NONE:'Không tiểu'};
const vitalRanges={pulse:[20,250,'Mạch'],temperature:[30,45,'Nhiệt độ'],bpSys:[40,300,'Huyết áp tâm thu'],bpDia:[20,200,'Huyết áp tâm trương'],spo2:[1,100,'SpO₂'],respiratoryRate:[1,100,'Nhịp thở']};
const shiftLabel=t=>t==='MORNING'?'Ca sáng':t==='AFTERNOON'?'Ca chiều (cũ)':'Ca tối';
const requestId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
const nowLocal=()=>{const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16)};
const freshForm=()=>({clientRequestId:requestId(),entryMode:'QUICK',category:'HEALTH',eventType:'OBSERVATION',priority:'MEDIUM',occurredAt:new Date().toISOString().slice(0,16),content:'',intervention:'',notifiedTo:'',requiresHandover:false,followUp:'',vitalConcern:false,bpSys:'',bpDia:'',pulse:'',spo2:'',temperature:'',respiratoryRate:'',bloodGlucose:'',insulinGiven:false,insulinOrderId:'',insulinDose:'',urgentRemeasured:false,urgentNotifiedTo:'',urgentAction:'',urgentSymptoms:'',bowelStatus:'NORMAL',urineStatus:'NORMAL',urineDetail:'',note:'',woundImages:[]});

function readBlobAsDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error||new Error('Không đọc được ảnh.'));reader.readAsDataURL(blob)})}
async function compressWoundImage(file){
  if(!/^image\/(jpeg|png|webp)$/i.test(file.type))throw new Error(`${file.name}: chỉ nhận JPG, PNG hoặc WebP.`);
  if(file.size>5*1024*1024)throw new Error(`${file.name}: ảnh gốc vượt quá 5 MB.`);
  const objectUrl=URL.createObjectURL(file);
  try{
    const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error(`${file.name}: không đọc được nội dung ảnh.`));img.src=objectUrl});
    const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
    const width=Math.max(1,Math.round(image.naturalWidth*scale)),height=Math.max(1,Math.round(image.naturalHeight*scale));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(image,0,0,width,height);
    let quality=.82,blob=null;
    do{blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));quality-=.08}while(blob&&blob.size>600*1024&&quality>=.5);
    if(!blob||blob.size>800*1024)throw new Error(`${file.name}: không thể nén xuống dưới 800 KB. Hãy chọn ảnh khác.`);
    return{dataUrl:await readBlobAsDataUrl(blob),mimeType:'image/jpeg',sizeBytes:blob.size,width,height,name:file.name};
  }finally{URL.revokeObjectURL(objectUrl)}
}

function getVitalErrors(form){
  const errors={};
  for(const [field,[min,max,label]] of Object.entries(vitalRanges)){
    const raw=form[field];
    if(raw==='')continue;
    const value=Number(raw);
    if(!Number.isFinite(value)||value<min||value>max)errors[field]=`${label} phải từ ${min} đến ${max}.`;
  }
  if((form.bpSys==='')!==(form.bpDia==='')){errors.bpSys='Cần nhập đủ cả tâm thu và tâm trương.';errors.bpDia='Cần nhập đủ cả tâm thu và tâm trương.'}
  if(form.bpSys!==''&&form.bpDia!==''&&Number(form.bpSys)<=Number(form.bpDia)){errors.bpSys='Tâm thu phải lớn hơn tâm trương.';errors.bpDia='Tâm trương phải nhỏ hơn tâm thu.'}
  if(form.bloodGlucose!==''){const value=Number(form.bloodGlucose);if(!Number.isFinite(value)||value<20||value>600)errors.bloodGlucose='Đường huyết phải từ 20 đến 600 mg/dL.'}
  return errors;
}
function getVitalAlerts(form){
  const rows=[];
  const add=(field,level,message)=>rows.push({field,level,message});
  const n=field=>form[field]===''?null:Number(form[field]);
  const pulse=n('pulse'),temp=n('temperature'),sys=n('bpSys'),dia=n('bpDia'),spo2=n('spo2'),resp=n('respiratoryRate');
  if(pulse!==null){if(pulse<=40||pulse>=131)add('pulse','RED',`Mạch ${pulse} lần/phút`);else if(pulse<=50||pulse>=91)add('pulse','YELLOW',`Mạch ${pulse} lần/phút`)}
  if(temp!==null){if(temp<=35)add('temperature','RED',`Nhiệt độ ${temp}°C`);else if(temp<=36||temp>=38.1)add('temperature',temp>=39.1?'RED':'YELLOW',`Nhiệt độ ${temp}°C`)}
  if(sys!==null){if(sys<=90||sys>=220)add('bpSys','RED',`Huyết áp tâm thu ${sys} mmHg`);else if(sys<=110)add('bpSys','YELLOW',`Huyết áp tâm thu ${sys} mmHg`)}
  if((sys!==null&&sys>180)||(dia!==null&&dia>120))add('bpSys','RED',`Huyết áp ${sys||'—'}/${dia||'—'} mmHg – cần đo lại và kiểm tra triệu chứng`);
  if(spo2!==null){if(spo2<=91)add('spo2','RED',`SpO₂ ${spo2}%`);else if(spo2<=95)add('spo2','YELLOW',`SpO₂ ${spo2}%`)}
  if(resp!==null){if(resp<=8||resp>=25)add('respiratoryRate','RED',`Nhịp thở ${resp} lần/phút`);else if(resp<=11||resp>=21)add('respiratoryRate','YELLOW',`Nhịp thở ${resp} lần/phút`)}
  return rows;
}
function parseVoiceVitals(transcript){
  const text=transcript.toLowerCase().replace(/,/g,'.');
  const pick=regex=>text.match(regex)?.[1]?.replace(',','.')||'';
  const bp=text.match(/huyết\s*áp\s*(\d{2,3})\s*(?:trên|\/|và)\s*(\d{2,3})/i);
  return {pulse:pick(/mạch\s*(\d{2,3})/i),temperature:pick(/nhiệt(?:\s*độ)?\s*(\d{2}(?:\.\d)?)/i),bpSys:bp?.[1]||'',bpDia:bp?.[2]||'',spo2:pick(/(?:spo2|sp[oô])\s*(\d{1,3})/i),respiratoryRate:pick(/nhịp\s*thở\s*(\d{1,2})/i)};
}

export default function ShiftDetail(){
  const {id}=useParams(),[searchParams]=useSearchParams(),{user,can}=useAuth();
  const canWrite=can('CARE.CREATE'),canUpdate=can('CARE.UPDATE'),canDelete=can('CARE.DELETE'),canSign=can('HANDOVER.SIGN'),canReceive=can('HANDOVER.RECEIVE'),isAdmin=user.role==='ADMIN';
  const [d,setD]=useState(null),[sel,setSel]=useState(null),[form,setForm]=useState(freshForm()),[preview,setPreview]=useState(null),[review,setReview]=useState(null),[voiceReview,setVoiceReview]=useState(null),[resolveTarget,setResolveTarget]=useState(null),[resolveNote,setResolveNote]=useState(''),[resolveBusy,setResolveBusy]=useState(false),[listening,setListening]=useState(false),[voiceProcessing,setVoiceProcessing]=useState(false),[voiceLiveStatus,setVoiceLiveStatus]=useState(''),[imageBusy,setImageBusy]=useState(false),[err,setErr]=useState(''),[q,setQ]=useState(''),[saveBusy,setSaveBusy]=useState(false),[signature,setSignature]=useState({password:'',note:'',confirm:false,participantIds:[]}),[receiveSig,setReceiveSig]=useState({password:'',confirm:false});

  const recognitionRef=useRef(null),speechTimerRef=useRef(null),speechRestartRef=useRef(null),speechShouldRunRef=useRef(false),voiceBufferRef=useRef(''),voiceFinalRef=useRef(''),voiceInterimRef=useRef(''),voiceBaseRef=useRef(''),voiceConfidenceRef=useRef(0),voiceFailedRef=useRef(false),voiceCompletedRef=useRef(true),mediaRecorderRef=useRef(null),mediaStreamRef=useRef(null),audioChunksRef=useRef([]),mediaActiveRef=useRef(false),voiceSessionRef=useRef(0),voiceModeRef=useRef(''),speechNetworkErrorsRef=useRef(0),speechNoResultEndsRef=useRef(0);
  async function load(){try{setErr('');setD((await api.shift(id)).data)}catch(e){setErr(e.message)}}
  useEffect(()=>{load()},[id]);
  useEffect(()=>()=>{if(speechTimerRef.current)clearTimeout(speechTimerRef.current);if(speechRestartRef.current)clearTimeout(speechRestartRef.current);speechShouldRunRef.current=false;recognitionRef.current?.abort?.();mediaRecorderRef.current&&(mediaRecorderRef.current.onstop=null);try{if(mediaRecorderRef.current?.state!=='inactive')mediaRecorderRef.current?.stop()}catch{}mediaStreamRef.current?.getTracks?.().forEach(track=>track.stop())},[]);
  useEffect(()=>{if(!d)return;const rid=searchParams.get('residentId'),openForm=searchParams.get('quick')==='1'||searchParams.has('mode');if(rid&&openForm){const r=d.residents.find(x=>x.residentId===rid);if(r){setSel(r);setForm({...freshForm(),entryMode:searchParams.get('mode')==='full'?'FULL':'QUICK'})}}},[d,searchParams]);
  useEffect(()=>{if(!d)return;const rid=searchParams.get('residentId'),alertId=searchParams.get('focusAlert')||d.changes.find(x=>x.residentId===rid&&x.attentionStatus==='OPEN')?.id,index=d.changes.findIndex(x=>x.id===alertId);if(index<0)return;const timer=setTimeout(()=>{const el=document.querySelectorAll('.log-card')[index];el?.scrollIntoView({behavior:'smooth',block:'center'});el?.classList.add('focus-pulse');setTimeout(()=>el?.classList.remove('focus-pulse'),2400)},120);return()=>clearTimeout(timer)},[d,searchParams]);
  const residentChanges=useMemo(()=>sel&&d?d.changes.filter(x=>x.residentId===sel.residentId):[],[d,sel]);
  const residentToilets=useMemo(()=>sel&&d?d.toileting.filter(x=>x.residentId===sel.residentId):[],[d,sel]);
  const filteredResidents=useMemo(()=>!d?[]:d.residents.filter(r=>!q||`${r.fullName} ${r.code} ${r.roomName} ${r.bedName}`.toLowerCase().includes(q.toLowerCase())),[d,q]);
  const vitalErrors=getVitalErrors(form),vitalAlerts=getVitalAlerts(form),redAlerts=vitalAlerts.filter(x=>x.level==='RED'),yellowAlerts=vitalAlerts.filter(x=>x.level==='YELLOW');
  const recordedIds=new Set([...(d?.changes||[]).map(x=>x.residentId),...(d?.toileting||[]).map(x=>x.residentId)]),coverage=d?.residents?.length?Math.round(recordedIds.size*100/d.residents.length):0,openRedCount=(d?.changes||[]).filter(x=>x.attentionLevel==='RED'&&x.attentionStatus==='OPEN').length,openYellowCount=(d?.changes||[]).filter(x=>x.attentionLevel==='YELLOW'&&x.attentionStatus==='OPEN').length;
  function clearVoiceTimer(){if(speechTimerRef.current){clearTimeout(speechTimerRef.current);speechTimerRef.current=null}if(speechRestartRef.current){clearTimeout(speechRestartRef.current);speechRestartRef.current=null}}
  function stopMediaTracks(){mediaStreamRef.current?.getTracks?.().forEach(track=>track.stop());mediaStreamRef.current=null}
  function renderVoiceTranscript(finalText=voiceFinalRef.current,interimText=voiceInterimRef.current){
    const transcript=[String(finalText||'').trim(),String(interimText||'').trim()].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    voiceBufferRef.current=transcript;
    if(transcript){
      voiceFailedRef.current=false;
      setForm(current=>({...current,content:[voiceBaseRef.current,transcript].filter(Boolean).join('\n')}));
    }
    return transcript;
  }
  function resetVoiceState(){
    voiceFailedRef.current=false;
    voiceCompletedRef.current=false;
    voiceBufferRef.current='';
    voiceFinalRef.current='';
    voiceInterimRef.current='';
    voiceConfidenceRef.current=0;
    voiceBaseRef.current=form.content.trim();
    speechNetworkErrorsRef.current=0;
    speechNoResultEndsRef.current=0;
  }
  function cancelVoice(){
    clearVoiceTimer();
    voiceSessionRef.current+=1;
    speechShouldRunRef.current=false;
    voiceFailedRef.current=true;
    voiceCompletedRef.current=true;
    mediaActiveRef.current=false;
    voiceModeRef.current='';
    try{recognitionRef.current?.abort?.()}catch{}
    recognitionRef.current=null;
    if(mediaRecorderRef.current){mediaRecorderRef.current.onstop=null;try{if(mediaRecorderRef.current.state!=='inactive')mediaRecorderRef.current.stop()}catch{}}
    mediaRecorderRef.current=null;
    stopMediaTracks();
    setListening(false);
    setVoiceProcessing(false);
    setVoiceLiveStatus('');
  }
  function openVoiceReview(transcript,source='browser',confidence=0){
    const value=String(transcript||'').trim();
    if(!value){setErr('Không thu được nội dung giọng nói. Kiểm tra micro rồi thử lại.');return}
    voiceBufferRef.current=value;
    voiceFailedRef.current=false;
    voiceCompletedRef.current=true;
    setForm(current=>({...current,content:[voiceBaseRef.current,value].filter(Boolean).join('\n')}));
    setVoiceReview({transcript:value,chosenText:value,cleanedText:'',cleaning:true,confidence,source,baseContent:voiceBaseRef.current,parsed:parseVoiceVitals(value)});
    api.cleanTranscript(value)
      .then(result=>setVoiceReview(current=>current?.transcript===value?{...current,cleanedText:result.data.cleaned||value,cleaning:false,cleanMode:result.data.mode,cleanWarning:result.data.warning||''}:current))
      .catch(error=>setVoiceReview(current=>current?.transcript===value?{...current,cleanedText:value,cleaning:false,cleanWarning:error.message}:current));
  }
  function finishVoiceReview(source='browser'){
    if(mediaActiveRef.current||voiceCompletedRef.current)return;
    speechShouldRunRef.current=false;
    clearVoiceTimer();
    recognitionRef.current=null;
    setListening(false);
    const transcript=voiceBufferRef.current.trim();
    if(transcript&&!voiceFailedRef.current)openVoiceReview(transcript,source,voiceConfidenceRef.current);
    else if(!voiceFailedRef.current)setErr('Không thu được nội dung. Hãy kiểm tra quyền micro rồi thử lại.');
  }
  function blobToBase64(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)})}
  function preferredAudioMime(){
    const choices=['audio/webm;codecs=opus','audio/webm','audio/mp4'];
    return choices.find(type=>window.MediaRecorder?.isTypeSupported?.(type))||'';
  }
  async function startRecorderFallback(sessionId){
    if(sessionId!==voiceSessionRef.current)return;
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){
      setListening(false);setErr('Trình duyệt này không hỗ trợ ghi âm dự phòng. Hãy dùng Chrome mới hoặc Safari/iPadOS mới trên HTTPS.');return;
    }
    try{
      speechShouldRunRef.current=false;
      try{recognitionRef.current?.abort?.()}catch{}
      recognitionRef.current=null;
      setVoiceLiveStatus('Đang mở micro để ghi âm dự phòng…');
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(sessionId!==voiceSessionRef.current){stream.getTracks().forEach(t=>t.stop());return}
      mediaStreamRef.current=stream;
      audioChunksRef.current=[];
      const mimeType=preferredAudioMime();
      const recorder=mimeType?new MediaRecorder(stream,{mimeType}):new MediaRecorder(stream);
      mediaRecorderRef.current=recorder;
      voiceModeRef.current='recorder';
      mediaActiveRef.current=true;
      voiceCompletedRef.current=false;
      setListening(true);
      setVoiceLiveStatus('Đang ghi âm dự phòng. Bấm Dừng khi nói xong…');
      recorder.ondataavailable=e=>{if(e.data&&e.data.size>0)audioChunksRef.current.push(e.data)};
      recorder.onerror=e=>{console.error('[VOICE] MediaRecorder error',e);setErr('Không ghi được âm thanh từ micro. Kiểm tra quyền micro của trình duyệt.');};
      recorder.onstop=async()=>{
        mediaActiveRef.current=false;
        stopMediaTracks();
        const chunks=[...audioChunksRef.current];audioChunksRef.current=[];
        if(sessionId!==voiceSessionRef.current||voiceFailedRef.current)return;
        const blob=new Blob(chunks,{type:recorder.mimeType||mimeType||'audio/webm'});
        if(blob.size<100){setVoiceProcessing(false);setErr('Đoạn ghi âm quá ngắn. Hãy thử lại và nói gần micro hơn.');return}
        setVoiceProcessing(true);setVoiceLiveStatus('Đang chép lời đoạn ghi âm…');
        try{
          const audioBase64=await blobToBase64(blob);
          const response=await api.transcribeAudio(audioBase64,blob.type||'audio/webm');
          const transcript=String(response?.data?.transcript||'').trim();
          setVoiceProcessing(false);setVoiceLiveStatus('');setListening(false);
          openVoiceReview(transcript,'audio-fallback',0);
        }catch(error){
          setVoiceProcessing(false);setVoiceLiveStatus('');setListening(false);
          setErr(error.message||'Không thể chép lời đoạn ghi âm. Nếu Gemini đang bị chặn, cấu hình STT_API_URL hoặc dùng Chrome SpeechRecognition.');
        }
      };
      recorder.start(500);
      clearVoiceTimer();
      speechTimerRef.current=setTimeout(stopVoice,30000);
    }catch(error){
      stopMediaTracks();mediaActiveRef.current=false;setListening(false);setVoiceProcessing(false);
      if(error?.name==='NotAllowedError'||error?.name==='SecurityError')setErr('Chưa cấp quyền Microphone. Bấm biểu tượng cạnh địa chỉ → Microphone: Allow, sau đó tải lại trang.');
      else setErr(`Không mở được micro: ${error?.message||error}`);
    }
  }
  function stopVoice(){
    clearVoiceTimer();
    speechShouldRunRef.current=false;
    setListening(false);
    if(voiceModeRef.current==='recorder'){
      setVoiceLiveStatus('Đang hoàn tất đoạn ghi âm…');
      try{if(mediaRecorderRef.current?.state&&mediaRecorderRef.current.state!=='inactive')mediaRecorderRef.current.stop();else{mediaActiveRef.current=false;stopMediaTracks()}}catch{mediaActiveRef.current=false;stopMediaTracks()}
      return;
    }
    mediaActiveRef.current=false;
    setVoiceLiveStatus('Đang hoàn tất bản chép lời…');
    try{recognitionRef.current?.stop?.()}catch{}
    setTimeout(()=>{renderVoiceTranscript();finishVoiceReview('browser-speech');setVoiceLiveStatus('')},500);
  }
  function beginBrowserRecognition(sessionId){
    const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SpeechRecognition){startRecorderFallback(sessionId);return}
    if(!speechShouldRunRef.current||sessionId!==voiceSessionRef.current)return;
    const recognition=new SpeechRecognition();
    recognition.lang='vi-VN';recognition.interimResults=true;recognition.continuous=false;recognition.maxAlternatives=1;
    recognitionRef.current=recognition;voiceModeRef.current='browser';
    recognition.onstart=()=>{setVoiceLiveStatus('Đang nghe. Lời nói sẽ hiện trực tiếp trong ô Nội dung…')};
    recognition.onresult=e=>{
      let finalAdded='',interim='';
      for(let i=e.resultIndex;i<e.results.length;i++){
        const alt=e.results[i]?.[0],part=String(alt?.transcript||'').trim();if(!part)continue;
        if(e.results[i].isFinal)finalAdded+=`${part} `;else interim+=`${part} `;
        if(Number.isFinite(alt?.confidence)&&alt.confidence>0)voiceConfidenceRef.current=Math.max(voiceConfidenceRef.current,alt.confidence);
      }
      if(finalAdded||interim)speechNoResultEndsRef.current=0;
      if(finalAdded)voiceFinalRef.current=`${voiceFinalRef.current} ${finalAdded}`.replace(/\s+/g,' ').trim();
      voiceInterimRef.current=interim.replace(/\s+/g,' ').trim();
      const transcript=renderVoiceTranscript();
      if(transcript)setVoiceLiveStatus('Đã nhận giọng nói. Tiếp tục nói hoặc bấm Dừng…');
    };
    recognition.onerror=e=>{
      if(e.error==='aborted')return;
      if(e.error==='not-allowed'||e.error==='service-not-allowed'){
        speechShouldRunRef.current=false;voiceFailedRef.current=true;mediaActiveRef.current=false;setListening(false);
        setErr('Trình duyệt chưa được quyền nhận giọng nói/micro. Bấm biểu tượng cạnh địa chỉ → Microphone: Allow, rồi tải lại trang.');return;
      }
      if(e.error==='audio-capture'){
        speechShouldRunRef.current=false;voiceFailedRef.current=true;mediaActiveRef.current=false;setListening(false);setErr('Không lấy được âm thanh từ micro. Kiểm tra micro đang chọn trong trình duyệt và macOS/iPadOS.');return;
      }
      if(e.error==='network'){
        speechNetworkErrorsRef.current+=1;
        if(speechNetworkErrorsRef.current>=1&&!voiceBufferRef.current){
          speechShouldRunRef.current=false;mediaActiveRef.current=false;setListening(false);setVoiceLiveStatus('Nhận dạng trực tiếp lỗi mạng; đang kiểm tra STT dự phòng…');
          setTimeout(async()=>{
            try{
              const status=await api.aiStatus();
              if(status?.data?.sttFallbackConfigured||status?.data?.geminiAvailable)startRecorderFallback(sessionId);
              else{setVoiceLiveStatus('');setErr('Dịch vụ nhận dạng giọng nói của trình duyệt đang lỗi mạng và chưa cấu hình STT dự phòng. Hãy cấu hình STT_API_URL hoặc dùng Chrome có Internet.')}
            }catch{setVoiceLiveStatus('');setErr('Không kiểm tra được STT dự phòng.')}
          },150);return;
        }
        setVoiceLiveStatus('Dịch vụ nhận dạng trực tiếp đang lỗi mạng, hệ thống thử lại…');return;
      }
      if(e.error==='no-speech')setVoiceLiveStatus('Chưa nghe rõ. Hãy nói gần micro hơn, hệ thống sẽ tự nghe lại…');
      else setVoiceLiveStatus(`Nhận dạng tạm gián đoạn (${e.error||'unknown'}), đang thử lại…`);
    };
    recognition.onend=()=>{
      if(recognitionRef.current===recognition)recognitionRef.current=null;
      if(!voiceBufferRef.current)speechNoResultEndsRef.current+=1;
      if(speechShouldRunRef.current&&mediaActiveRef.current&&voiceModeRef.current==='browser'&&sessionId===voiceSessionRef.current&&speechNoResultEndsRef.current>=2&&!voiceBufferRef.current){
        speechShouldRunRef.current=false;mediaActiveRef.current=false;setListening(false);
        setVoiceLiveStatus('Trình duyệt không trả bản chép lời; đang kiểm tra ghi âm dự phòng…');
        setTimeout(async()=>{
          try{
            const status=await api.aiStatus();
            if(status?.data?.sttFallbackConfigured||status?.data?.geminiAvailable){
              startRecorderFallback(sessionId);
            }else{
              setVoiceLiveStatus('');
              setErr('Micro có thể đã mở nhưng dịch vụ nhận dạng giọng nói của trình duyệt không trả nội dung. Hiện chưa có STT dự phòng. Hãy dùng Chrome có Internet hoặc cấu hình STT_API_URL.');
            }
          }catch{
            setVoiceLiveStatus('');
            setErr('Không kiểm tra được dịch vụ giọng nói dự phòng.');
          }
        },150);
        return;
      }
      if(speechShouldRunRef.current&&mediaActiveRef.current&&voiceModeRef.current==='browser'&&sessionId===voiceSessionRef.current){
        speechRestartRef.current=setTimeout(()=>beginBrowserRecognition(sessionId),250);
      }
    };
    try{recognition.start()}catch(error){
      recognitionRef.current=null;
      speechNetworkErrorsRef.current+=1;
      if(speechNetworkErrorsRef.current>=2&&!voiceBufferRef.current){speechShouldRunRef.current=false;mediaActiveRef.current=false;setListening(false);setTimeout(()=>startRecorderFallback(sessionId),250)}
      else if(speechShouldRunRef.current&&mediaActiveRef.current)speechRestartRef.current=setTimeout(()=>beginBrowserRecognition(sessionId),500);
    }
  }
  function closeEntry(){cancelVoice();setVoiceReview(null);setReview(null);setSel(null)}
  function openEntry(r,entryMode='QUICK'){if(!canWrite)return;cancelVoice();setSel(r);setForm({...freshForm(),entryMode});setReview(null);setVoiceReview(null);setErr('')}
  async function startVoice(){
    if(listening){stopVoice();return}
    if(!window.isSecureContext&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1'){
      setErr('Micro chỉ hoạt động trên HTTPS hoặc localhost.');return;
    }
    cancelVoice();setErr('');resetVoiceState();
    const sessionId=voiceSessionRef.current+1;voiceSessionRef.current=sessionId;
    const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SpeechRecognition){await startRecorderFallback(sessionId);return}
    try{
      setVoiceLiveStatus('Đang kiểm tra quyền micro…');
      if(navigator.mediaDevices?.getUserMedia){
        const probe=await navigator.mediaDevices.getUserMedia({audio:true});probe.getTracks().forEach(t=>t.stop());
      }
    }catch(error){
      if(error?.name==='NotAllowedError'||error?.name==='SecurityError')setErr('Chưa cấp quyền Microphone. Bấm biểu tượng cạnh địa chỉ → Microphone: Allow, rồi tải lại trang.');
      else setErr(`Không mở được micro: ${error?.message||error}`);
      return;
    }
    if(sessionId!==voiceSessionRef.current)return;
    mediaActiveRef.current=true;speechShouldRunRef.current=true;voiceModeRef.current='browser';setListening(true);
    setVoiceLiveStatus('Đang mở nhận dạng giọng nói…');beginBrowserRecognition(sessionId);
    clearVoiceTimer();speechTimerRef.current=setTimeout(stopVoice,30000);
  }
  function chooseVoiceText(text){if(!voiceReview)return;setVoiceReview({...voiceReview,chosenText:text,parsed:parseVoiceVitals(text)});setForm(current=>({...current,content:[voiceReview.baseContent,text].filter(Boolean).join('\n')}))}
  function applyVoice(){if(!voiceReview)return;const parsed=voiceReview.parsed;setForm(current=>({...current,...Object.fromEntries(Object.entries(parsed).filter(([,v])=>v!=='')),content:[voiceReview.baseContent,voiceReview.chosenText||voiceReview.transcript].filter(Boolean).join('\n')}));setVoiceReview(null)}
  function discardVoice(){if(!voiceReview)return;setForm(current=>({...current,content:voiceReview.baseContent||''}));setVoiceReview(null)}
  async function addWoundImages(event){
    const files=[...(event.target.files||[])];event.target.value='';if(!files.length)return;
    if(form.woundImages.length+files.length>3){setErr('Mỗi lần ghi chỉ được tối đa 3 ảnh vết loét.');return}
    setImageBusy(true);setErr('');
    try{const compressed=[];for(const file of files)compressed.push(await compressWoundImage(file));setForm(current=>({...current,woundImages:[...current.woundImages,...compressed]}))}
    catch(error){setErr(error.message)}finally{setImageBusy(false)}
  }
  function removeWoundImage(index){setForm(current=>({...current,woundImages:current.woundImages.filter((_,i)=>i!==index)}))}
  function prepareSave(closeAfter=false){
    if(!sel)return;setErr('');
    if(!form.content.trim()){setErr('Bắt buộc nhập nội dung biến động.');return}
    if(Object.keys(vitalErrors).length){setErr('Có chỉ số sinh tồn chưa hợp lệ. Vui lòng kiểm tra các ô màu đỏ.');return}
    if(form.occurredAt&&new Date(form.occurredAt).getTime()>Date.now()+5*60*1000){setErr('Thời điểm ghi nhận không được ở tương lai.');return}
    if(form.requiresHandover&&!form.followUp.trim()){setErr('Đã chọn cần bàn giao thì phải nhập việc ca sau cần biết/làm.');return}
    if(redAlerts.length&&(!form.urgentRemeasured||!form.urgentNotifiedTo.trim()||!form.urgentAction.trim())){setErr('Cảnh báo Đỏ: cần xác nhận đo lại, người đã báo và hành động xử lý trước khi kiểm tra lưu.');return}
    if(form.entryMode==='FULL'&&form.insulinGiven){if(!form.bloodGlucose){setErr('Đã tick tiêm insulin thì bắt buộc nhập đường huyết trước tiêm.');return}const dose=Number(form.insulinDose);if(!Number.isFinite(dose)||dose<=0){setErr('Liều insulin phải là số lớn hơn 0.');return}}
    if(form.entryMode==='FULL'&&form.urineStatus==='OTHER'&&!form.urineDetail.trim()){setErr('Vui lòng mô tả tình trạng tiểu khi chọn Khác.');return}
    setReview({closeAfter,alerts:vitalAlerts});
  }
  async function save(){if(!sel||!review)return;const closeAfter=review.closeAfter;setSaveBusy(true);setErr('');try{
    const hasVitals=['bpSys','bpDia','pulse','spo2','temperature','respiratoryRate'].some(field=>form[field]!=='')||(form.entryMode==='FULL'&&form.bloodGlucose!=='')||form.vitalConcern;
    const r=await api.change({clientRequestId:form.clientRequestId,shiftId:id,residentId:sel.residentId,residentName:sel.fullName,areaId:sel.areaId,areaName:sel.areaName,roomName:sel.roomName,bedName:sel.bedName,image:sel.image,category:form.category,eventType:form.eventType,priority:redAlerts.length?'HIGH':form.priority,occurredAt:form.occurredAt?new Date(form.occurredAt).toISOString():new Date().toISOString(),content:form.content.trim(),intervention:form.intervention.trim(),notifiedTo:form.notifiedTo.trim(),requiresHandover:form.requiresHandover,followUp:form.followUp.trim(),vitals:hasVitals?{bpSys:form.bpSys,bpDia:form.bpDia,pulse:form.pulse,spo2:form.spo2,temperature:form.temperature,respiratoryRate:form.respiratoryRate,bloodGlucose:form.entryMode==='FULL'?form.bloodGlucose:'',concern:form.vitalConcern||redAlerts.length>0,alertLevel:redAlerts.length?'RED':yellowAlerts.length?'YELLOW':'NORMAL',alerts:vitalAlerts,urgent:redAlerts.length?{remeasured:form.urgentRemeasured,notifiedTo:form.urgentNotifiedTo.trim(),action:form.urgentAction.trim(),symptoms:form.urgentSymptoms.trim()}:null}:null,insulin:form.entryMode==='FULL'&&form.insulinGiven?{given:true,dose:form.insulinDose,unit:'IU'}:null,woundImages:form.entryMode==='FULL'?form.woundImages.map(({dataUrl,sizeBytes,width,height})=>({dataUrl,sizeBytes,width,height})):[]},form.woundImages.length?{skipQueue:true}:undefined);
    if(form.entryMode==='FULL')await api.toileting({clientRequestId:`${form.clientRequestId}-toileting`,shiftId:id,residentId:sel.residentId,residentName:sel.fullName,areaId:sel.areaId,areaName:sel.areaName,roomName:sel.roomName,bedName:sel.bedName,image:sel.image,bowelStatus:form.bowelStatus,urineStatus:form.urineStatus,urineDetail:form.urineDetail.trim(),note:form.note.trim()});
    if(r?.queued)alert('Đã lưu tạm trên thiết bị. Khi có mạng hệ thống sẽ tự đồng bộ.');
    setReview(null);await load();
    if(closeAfter){closeEntry()}else{const keep={...freshForm(),entryMode:form.entryMode,category:form.category,eventType:form.eventType,priority:form.priority};setForm(keep)}
  }catch(e){setErr(e.message)}finally{setSaveBusy(false)}}
  async function handover(){try{setErr('');setPreview((await api.handoverPreview(id)).data);setSignature({password:'',note:'',confirm:false,participantIds:[]});setReceiveSig({password:'',confirm:false})}catch(e){setErr(e.message)}}
  function toggleParticipant(userId){setSignature(current=>({...current,participantIds:current.participantIds.includes(userId)?current.participantIds.filter(id=>id!==userId):[...current.participantIds,userId]}))}
  async function confirm(){try{if(!signature.confirm)throw new Error('Bạn phải tick xác nhận đã rà soát ca.');const assigned=preview?.assignedStaff||preview?.shift?.assignedStaff||[];if(assigned.length<2)throw new Error('Ca chưa đủ tối thiểu 2 nhân sự.');if(signature.participantIds.length!==assigned.length)throw new Error('Phải tick đủ tất cả nhân sự trực ca trước khi bàn giao.');await api.handoverConfirm(id,signature);await handover();await load()}catch(e){setErr(e.message)}}
  async function receive(){try{if(!receiveSig.confirm)throw new Error('Bạn phải tick xác nhận đã nhận bàn giao.');await api.handoverReceive(id,receiveSig);await handover();await load()}catch(e){setErr(e.message)}}
  async function editChange(x){const content=prompt('Sửa nội dung biến động',x.content);if(content===null||!content.trim())return;const followUp=x.requiresHandover?prompt('Sửa nội dung ca sau cần biết/làm',x.followUp||''):x.followUp;let overrideReason='';if(d.shift.status!=='OPEN'){if(!isAdmin)return setErr('Ca đã ký bàn giao. Chỉ Admin mới được sửa dữ liệu đã khóa.');overrideReason=prompt('Bắt buộc nhập lý do sửa dữ liệu sau khi đã ký bàn giao:')||'';if(!overrideReason.trim())return;}try{await api.updateChange(x.id,{content,requiresHandover:x.requiresHandover,followUp:followUp??x.followUp,overrideReason});await load()}catch(e){setErr(e.message)}}
  async function deleteWoundImage(change,image){if(!isAdmin)return setErr('Chỉ Admin được xóa ảnh đã lưu.');const reason=prompt('Lý do xóa ảnh tổn thương da?');if(!reason?.trim())return;let overrideReason='';if(d.shift.status!=='OPEN'){overrideReason=prompt('Lý do Admin sửa dữ liệu sau bàn giao?')||'';if(!overrideReason.trim())return;}try{await api.updateChange(change.id,{content:change.content,requiresHandover:change.requiresHandover,followUp:change.followUp,woundImages:(change.woundImages||[]).filter(x=>x.id!==image.id),overrideReason});await load()}catch(e){setErr(e.message)}}
  async function resolveChange(){if(!resolveTarget||!resolveNote.trim())return;setResolveBusy(true);setErr('');try{await api.resolveChange(resolveTarget.id,resolveNote.trim());setResolveTarget(null);setResolveNote('');await load()}catch(e){setErr(e.message)}finally{setResolveBusy(false)}}
  async function del(changeId){const reason=prompt('Lý do xóa mềm bản ghi?');if(!reason)return;try{await api.deleteChange(changeId,reason);await load()}catch(e){setErr(e.message)}}
  async function editToileting(x){
    const bowel=prompt('Tiêu: NORMAL = Bình thường; CONSTIPATION = Táo bón; DIARRHEA = Tiêu chảy; OTHER = Khác',x.bowelStatus||'NORMAL');if(bowel===null)return;
    const urine=prompt('Tiểu: NORMAL = BT; SONDE = Qua sonde; CATHETER = Qua ống tiểu; DIAPER = Qua tã; OTHER = Khác',x.urineStatus||'NORMAL');if(urine===null)return;
    const detail=urine==='OTHER'?prompt('Mô tả tình trạng tiểu *',x.urineDetail||''):'';if(urine==='OTHER'&&detail===null)return;
    const note=prompt('Ghi chú tiêu / tiểu',x.note||'');if(note===null)return;let overrideReason='';
    if(d.shift.status!=='OPEN'){if(!isAdmin)return setErr('Ca đã ký bàn giao. Chỉ Admin mới được sửa lịch sử tiêu/tiểu.');overrideReason=prompt('Lý do Admin sửa dữ liệu sau bàn giao:')||'';if(!overrideReason.trim())return}
    try{await api.updateToileting(x.id,{bowelStatus:bowel.trim().toUpperCase(),urineStatus:urine.trim().toUpperCase(),urineDetail:detail||'',note,overrideReason});await load()}catch(e){setErr(e.message)}
  }
  async function delToileting(x){if(!isAdmin)return setErr('Chỉ Admin được xóa lịch sử tiêu/tiểu.');const reason=prompt('Lý do Admin xóa lịch sử tiêu/tiểu?');if(!reason)return;try{await api.deleteToileting(x.id,reason);await load()}catch(e){setErr(e.message)}}
  if(!d)return <section><p>Đang tải...</p>{err&&<div className="error">{err}</div>}</section>;
  const groupedHandover=(preview?.handoverItems||[]).reduce((acc,x)=>{(acc[x.residentId]??=[]).push(x);return acc},{})||{};
  return <section>
    <header className="page-head"><div><h1>{shiftLabel(d.shift.shiftType)} • {d.shift.shiftDate}</h1><p>{d.shift.branchName} • {d.shift.areaName||'Toàn cơ sở'} • <b>{d.shift.status}</b></p><small className="shift-staff-summary"><b>Nhân sự trực:</b> {(d.shift.assignedStaff||[]).length?d.shift.assignedStaff.map(x=>`${x.fullName} (${x.employeeCode||x.username})`).join(', '):(d.shift.assignedStaffNames||[d.shift.assignedStaffName]).filter(Boolean).join(', ')||'Ca cũ chưa phân công'}</small><small className="shift-staff-summary"><b>Người ghi chính:</b> {d.shift.primaryRecorderName||d.shift.assignedStaffName||'Chưa chọn'}{d.shift.primaryRecorderCode?` (${d.shift.primaryRecorderCode})`:''}</small></div><div className="actions"><button className="secondary" onClick={handover}>Bàn giao & ký</button>{canWrite&&d.shift.status==='OPEN'&&<button onClick={()=>document.getElementById('shift-search')?.focus()}>+ Nhập nhanh</button>}</div></header>
    {err&&<div className="error">{err}</div>}
    <div className="stats stats-6"><div className="stat"><b>{d.residents.length}</b><span>NCT roster</span></div><div className="stat"><b>{new Set(d.changes.map(x=>x.residentId)).size}</b><span>NCT có biến động</span></div><div className="stat"><b>{d.changes.length}</b><span>Lượt ghi nhận</span></div><div className="stat danger-stat"><b>{openRedCount}</b><span>Đỏ chưa xử lý</span></div><div className="stat warning-stat"><b>{openYellowCount}</b><span>Vàng chưa xử lý</span></div><div className="stat"><b>{d.changes.filter(x=>x.requiresHandover).length}</b><span>Cần bàn giao</span></div></div>
    <div className="shift-toolbar"><input id="shift-search" autoFocus placeholder="Tìm tên NCT trong ca để nhập nhanh..." value={q} onChange={e=>setQ(e.target.value)}/><div className="shift-progress"><span><b>{recordedIds.size}/{d.residents.length}</b> NCT đã có ghi nhận ({coverage}%)</span><div><i style={{width:`${coverage}%`}}/></div></div><span>Bấm vào tên NCT → có thể bổ sung nhiều lần đo trong cùng ca.</span></div>
    <div className="table-wrap"><table><thead><tr><th>NCT</th><th>Vị trí</th><th>Ghi nhận hôm nay</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{filteredResidents.map(r=>{const count=d.changes.filter(x=>x.residentId===r.residentId).length;return <tr key={r.id} className={canWrite?'clickable-row':''}><td onClick={()=>openEntry(r,'QUICK')}><div className="resident"><div className="avatar">{r.image?<img src={r.image}/>:r.fullName?.slice(0,1)}</div><div><b className="resident-link">{r.fullName}</b><small>{r.code}</small></div></div></td><td>{r.areaName} • {r.roomName} • {r.bedName}</td><td><b>{count}</b> lượt</td><td><span className="badge">{r.derivedStatus}</span></td><td>{canWrite&&d.shift.status==='OPEN'?<button onClick={()=>openEntry(r,'QUICK')}>+ Ghi nhận</button>:<span className="read-only-note">Chỉ xem</span>}</td></tr>})}</tbody></table></div>
    <div className="section-head"><div><h2>Nhật ký biến động</h2><p>Mỗi lần ghi là một record riêng; một NCT có thể có nhiều lần ghi trong cùng ca.</p></div></div>
    <div className="cards">{d.changes.map(x=><div className={`log-card priority-border-${x.priority||'MEDIUM'} ${x.attentionLevel?`attention-card-${x.attentionLevel}`:''}`} key={x.id}><div><div className="log-title"><b>{x.residentName}</b><span className={`priority ${x.priority||'MEDIUM'}`}>{x.priority||'MEDIUM'}</span>{x.attentionLevel&&<span className={`attention-status ${x.attentionStatus==='RESOLVED'?'RESOLVED':x.attentionLevel}`}>{x.attentionStatus==='RESOLVED'?'ĐÃ XỬ LÝ':`${x.attentionLevel} • CẦN XỬ LÝ`}</span>}</div><small>{categories.find(c=>c[0]===x.category)?.[1]||x.category} • {eventTypes.find(e=>e[0]===x.eventType)?.[1]||x.eventType||'Theo dõi'} • {new Date(x.occurredAt||x.createdAt).toLocaleString('vi-VN')}</small><p>{x.content}</p>{x.intervention&&<small><b>Xử lý ban đầu:</b> {x.intervention}</small>}{x.vitals&&<small><b>Dấu hiệu sinh tồn:</b> {x.vitals.pulse?`Mạch ${x.vitals.pulse} lần/phút `:''}{x.vitals.temperature?`• Nhiệt độ ${x.vitals.temperature} °C `:''}{x.vitals.bpSys&&x.vitals.bpDia?`• Huyết áp ${x.vitals.bpSys}/${x.vitals.bpDia} mmHg `:''}{x.vitals.spo2?`• SpO₂ ${x.vitals.spo2}% `:''}{x.vitals.respiratoryRate?`• Nhịp thở ${x.vitals.respiratoryRate} lần/phút `:''}{x.vitals.bloodGlucose!=null?`• Đường huyết ${x.vitals.bloodGlucose} mg/dL`:''}</small>}{x.insulin?.given&&<small className="insulin-log"><b>Insulin:</b> {x.insulin.medicationName||'Insulin'} • {x.insulin.dose} IU</small>}{x.vitals?.urgent&&<small className="urgent-log"><b>Đã xử trí ban đầu cảnh báo Đỏ:</b> đo lại; báo {x.vitals.urgent.notifiedTo}; {x.vitals.urgent.action}{x.vitals.urgent.symptoms?` • Triệu chứng: ${x.vitals.urgent.symptoms}`:''}</small>}{x.resolutionNote&&<small className="resolution-text"><b>Kết quả xử lý:</b> {x.resolutionNote} • {x.resolvedByName} • {new Date(x.resolvedAt).toLocaleString('vi-VN')}</small>}{x.requiresHandover&&<small className="handover-text">→ Ca sau: {x.followUp}</small>}<small>{x.createdByName} • tạo {new Date(x.createdAt).toLocaleString('vi-VN')}</small></div><div className="actions">{x.attentionLevel&&x.attentionStatus==='OPEN'&&canWrite&&(d.shift.status==='OPEN'||isAdmin)&&<button onClick={()=>{setResolveTarget(x);setResolveNote('')}}>✓ Đã xử lý</button>}{canUpdate&&(d.shift.status==='OPEN'||isAdmin)&&<button className="secondary" onClick={()=>editChange(x)}>Sửa</button>}{canDelete&&isAdmin&&<button className="danger" onClick={()=>del(x.id)}>Xóa</button>}</div></div>)}{!d.changes.length&&<div className="empty compact">Chưa có biến động được ghi trong ca.</div>}</div>

    {d.changes.some(x=>x.woundImages?.length)&&<div className="panel wound-history"><h3>Ảnh vết loét / tổn thương da trong ca</h3>{d.changes.filter(x=>x.woundImages?.length).map(x=><div key={x.id}><b>{x.residentName}</b><small>{new Date(x.createdAt).toLocaleString('vi-VN')}</small><div className="wound-image-grid saved">{x.woundImages.map(image=><div className="saved-wound-image" key={image.id}><a href={image.dataUrl} target="_blank" rel="noreferrer"><img src={image.dataUrl} alt={`Ảnh vết loét ${x.residentName}`}/></a><small>Lưu đến {new Date(image.expiresAt).toLocaleDateString('vi-VN')}</small>{isAdmin&&<button type="button" className="danger compact-button" onClick={()=>deleteWoundImage(x,image)}>Xóa ảnh</button>}</div>)}</div></div>)}</div>}

    {sel&&<div className="modal"><div className="modal-card wide entry-modal">
      <div className="modal-head"><div><h2>Ghi nhận chăm sóc — {sel.fullName}</h2><p>{sel.areaName} • {sel.roomName} • {sel.bedName}</p></div><button className="secondary" onClick={closeEntry}>Đóng</button></div>
      <div className="modal-body entry-modal-body">
        <div className="entry-tabs"><button className={form.entryMode==='QUICK'?'active':''} onClick={()=>{cancelVoice();setForm({...form,entryMode:'QUICK'})}}>Nhập nhanh</button><button className={form.entryMode==='FULL'?'active':''} onClick={()=>{cancelVoice();setForm({...form,entryMode:'FULL'})}}>Đầy đủ</button></div>
        <div className="entry-layout"><div className="entry-form">
          <div className="form-grid entry-grid"><label>Nhóm<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{categories.map(x=><option value={x[0]} key={x[0]}>{x[1]}</option>)}</select></label><label>Mức ưu tiên<select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}>{levels.map(x=><option value={x[0]} key={x[0]}>{x[1]}</option>)}</select></label>{form.entryMode==='FULL'&&<><label>Loại sự kiện<select value={form.eventType} onChange={e=>setForm({...form,eventType:e.target.value,category:e.target.value==='FALL'?'INCIDENT':form.category})}>{eventTypes.map(x=><option value={x[0]} key={x[0]}>{x[1]}</option>)}</select></label><label>Thời điểm<input type="datetime-local" value={form.occurredAt} onChange={e=>setForm({...form,occurredAt:e.target.value})}/></label></>}</div>
          <label>Nội dung *<span className="voice-row"><textarea autoFocus placeholder="Ví dụ: hai bàn chân phù, ăn kém; hoặc trượt ngã đau vai phải..." value={form.content} onChange={e=>setForm({...form,content:e.target.value})}/><button type="button" aria-pressed={listening} disabled={voiceProcessing} className={`voice-button ${listening?'listening':''} ${voiceProcessing?'processing':''}`} onClick={startVoice}>{voiceProcessing?'AI đang chép lời…':listening?'■ Dừng & kiểm tra':'🎙 Nhập bằng giọng nói'}</button></span>{listening&&<small className="listening-hint">● {voiceLiveStatus||'Đang nghe…'} Hệ thống cập nhật cuốn chiếu khoảng 3 giây/lần và tự dừng sau 30 giây.</small>}{voiceProcessing&&<small className="listening-hint">Đang chép lại toàn bộ đoạn âm thanh lần cuối để bạn kiểm tra trước khi áp dụng. Chưa có dữ liệu nào được lưu.</small>}</label>
          {form.entryMode==='FULL'&&<><label>Xử lý / hành động đã thực hiện<textarea placeholder="Ghi việc đã làm; không dùng ô này để tạo chỉ định thuốc." value={form.intervention} onChange={e=>setForm({...form,intervention:e.target.value})}/></label><label>Đã báo / cần thông tin tới<input placeholder="Ví dụ: Bác sĩ trực, Trưởng ca..." value={form.notifiedTo} onChange={e=>setForm({...form,notifiedTo:e.target.value})}/></label></>}
          <fieldset className="vitals-fieldset"><legend>Dấu hiệu sinh tồn — nhập số trực tiếp</legend><div className="vitals-grid"><label>Mạch (lần/phút)<input className={vitalErrors.pulse?'invalid':''} type="number" min="20" max="250" placeholder="20–250" value={form.pulse} onChange={e=>setForm({...form,pulse:e.target.value})}/>{vitalErrors.pulse&&<small className="field-error">{vitalErrors.pulse}</small>}</label><label>Nhiệt độ (°C)<input className={vitalErrors.temperature?'invalid':''} type="number" min="30" max="45" step="0.1" placeholder="30–45" value={form.temperature} onChange={e=>setForm({...form,temperature:e.target.value})}/>{vitalErrors.temperature&&<small className="field-error">{vitalErrors.temperature}</small>}</label><label>Huyết áp (mmHg)<span className="bp-inputs"><input className={vitalErrors.bpSys?'invalid':''} type="number" min="40" max="300" placeholder="Tâm thu" value={form.bpSys} onChange={e=>setForm({...form,bpSys:e.target.value})}/><b>/</b><input className={vitalErrors.bpDia?'invalid':''} type="number" min="20" max="200" placeholder="Tâm trương" value={form.bpDia} onChange={e=>setForm({...form,bpDia:e.target.value})}/></span>{(vitalErrors.bpSys||vitalErrors.bpDia)&&<small className="field-error">{vitalErrors.bpSys||vitalErrors.bpDia}</small>}</label><label>SpO₂ (%)<input className={vitalErrors.spo2?'invalid':''} type="number" min="1" max="100" placeholder="1–100" value={form.spo2} onChange={e=>setForm({...form,spo2:e.target.value})}/>{vitalErrors.spo2&&<small className="field-error">{vitalErrors.spo2}</small>}</label><label>Nhịp thở (lần/phút)<input className={vitalErrors.respiratoryRate?'invalid':''} type="number" min="1" max="100" placeholder="1–100" value={form.respiratoryRate} onChange={e=>setForm({...form,respiratoryRate:e.target.value})}/>{vitalErrors.respiratoryRate&&<small className="field-error">{vitalErrors.respiratoryRate}</small>}</label>{form.entryMode==='FULL'&&<label>Đường huyết (mg/dL)<input className={vitalErrors.bloodGlucose?'invalid':''} type="number" min="20" max="600" placeholder="VD: 168" value={form.bloodGlucose} onChange={e=>setForm({...form,bloodGlucose:e.target.value})}/>{vitalErrors.bloodGlucose&&<small className="field-error">{vitalErrors.bloodGlucose}</small>}</label>}<label className="check concern"><input type="checkbox" checked={form.vitalConcern} onChange={e=>setForm({...form,vitalConcern:e.target.checked})}/> Đánh dấu cần chú ý</label></div>{form.entryMode==='FULL'&&<div className={`insulin-vitals-box ${form.insulinGiven?'active':''}`}><label className="check insulin-check"><input type="checkbox" checked={form.insulinGiven} onChange={e=>{const checked=e.target.checked;setErr('');setForm({...form,insulinGiven:checked,insulinOrderId:'',insulinDose:checked?form.insulinDose:''})}}/> Tiêm insulin</label>{form.insulinGiven&&<div className="insulin-inline-grid"><label>Liều insulin đã tiêm (IU) *<input autoFocus type="number" min="0.1" step="0.1" placeholder="VD: 8" value={form.insulinDose} onChange={e=>setForm({...form,insulinDose:e.target.value})}/><small className="field-help">Insulin được ghi độc lập tại đây, không liên kết với phần Y khoa/y lệnh.</small></label></div>}</div>}<small className="field-help">Không đo thì để trống. Đường huyết và tiêm insulin chỉ ghi ở chế độ Đầy đủ.</small></fieldset>
          {vitalAlerts.length>0&&<div className={`clinical-alert ${redAlerts.length?'RED':'YELLOW'}`}><div><b>{redAlerts.length?'CẢNH BÁO ĐỎ – CẦN XỬ LÝ NGAY':'CẢNH BÁO VÀNG – CẦN THEO DÕI'}</b><span>{vitalAlerts.map(x=>x.message).join(' • ')}</span></div>{redAlerts.length>0&&<div className="urgent-fields"><label className="check"><input type="checkbox" checked={form.urgentRemeasured} onChange={e=>setForm({...form,urgentRemeasured:e.target.checked})}/> Đã đo lại và xác nhận chỉ số *</label><label>Triệu chứng kèm theo<textarea value={form.urgentSymptoms} onChange={e=>setForm({...form,urgentSymptoms:e.target.value})}/></label><label>Đã báo cho ai? *<input value={form.urgentNotifiedTo} onChange={e=>setForm({...form,urgentNotifiedTo:e.target.value})}/></label><label>Hành động đã thực hiện *<textarea value={form.urgentAction} onChange={e=>setForm({...form,urgentAction:e.target.value})}/></label></div>}</div>}
          {form.entryMode==='FULL'&&<fieldset className="vitals-fieldset"><legend>Tiêu / tiểu</legend><div className="form-grid entry-grid"><label>Tiêu<select value={form.bowelStatus} onChange={e=>setForm({...form,bowelStatus:e.target.value})}><option value="NORMAL">Bình thường</option><option value="CONSTIPATION">Táo bón</option><option value="DIARRHEA">Tiêu chảy</option><option value="OTHER">Khác</option></select></label><label>Tiểu<select value={form.urineStatus} onChange={e=>setForm({...form,urineStatus:e.target.value,urineDetail:e.target.value==='OTHER'?form.urineDetail:''})}>{urineStatuses.map(x=><option value={x[0]} key={x[0]}>{x[1]}</option>)}</select></label></div>{form.urineStatus==='OTHER'&&<label>Mô tả tình trạng tiểu *<textarea value={form.urineDetail} onChange={e=>setForm({...form,urineDetail:e.target.value})}/></label>}<label>Ghi chú tiêu / tiểu<textarea value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label><div className="resident-timeline"><h3>Lịch sử tiêu/tiểu trong ca ({residentToilets.length})</h3>{residentToilets.slice(0,6).map(x=><div className="timeline-item" key={x.id}><div className="timeline-item-head"><small>{new Date(x.createdAt).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}</small><span className="timeline-actions"><button type="button" className="secondary compact-button" disabled={!canUpdate} onClick={()=>editToileting(x)}>Sửa</button>{isAdmin&&<button type="button" className="danger compact-button" onClick={()=>delToileting(x)}>Xóa</button>}</span></div><p>Tiêu: {bowelLabels[x.bowelStatus]||x.bowelStatus} • Tiểu: {urineLabels[x.urineStatus]||x.urineStatus}</p>{x.urineDetail&&<small>Mô tả tiểu: {x.urineDetail}</small>}{x.note&&<small>{x.note}</small>}</div>)}</div></fieldset>}
          {form.entryMode==='FULL'&&<fieldset className="vitals-fieldset wound-image-fieldset"><legend>Ảnh vết loét / tổn thương da</legend><label className="wound-upload-button">{imageBusy?'Đang nén ảnh…':'Chọn hoặc chụp ảnh'}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple disabled={imageBusy||form.woundImages.length>=3} onChange={addWoundImages}/></label><small className="field-help">Tối đa 3 ảnh. Ảnh gốc tối đa 5 MB/ảnh; hệ thống tự thu nhỏ, nén dưới 800 KB và xóa dữ liệu ảnh sau 90 ngày.</small>{form.woundImages.length>0&&<div className="wound-image-grid">{form.woundImages.map((image,index)=><div className="wound-image-preview" key={`${image.name}-${index}`}><img src={image.dataUrl} alt={`Vết loét ${index+1}`}/><small>{Math.ceil(image.sizeBytes/1024)} KB</small><button type="button" className="danger compact-button" onClick={()=>removeWoundImage(index)}>Xóa ảnh</button></div>)}</div>}</fieldset>}
          <label className="check"><input type="checkbox" checked={form.requiresHandover} onChange={e=>setForm({...form,requiresHandover:e.target.checked})}/> Cần bàn giao ca sau</label>{form.requiresHandover&&<label>Ca sau cần biết/làm *<textarea value={form.followUp} onChange={e=>setForm({...form,followUp:e.target.value})}/></label>}
          <div className="actions sticky-actions"><button disabled={saveBusy} onClick={()=>prepareSave(false)}>Kiểm tra & nhập tiếp</button><button className="secondary" disabled={saveBusy} onClick={()=>prepareSave(true)}>Kiểm tra & đóng</button></div>
        </div><div className="resident-timeline"><h3>Lịch sử trong ca ({residentChanges.length})</h3>{residentChanges.slice(0,12).map(x=><div className="timeline-item" key={x.id}><div><span className={`priority ${x.priority||'MEDIUM'}`}>{x.priority||'MEDIUM'}</span><small>{new Date(x.occurredAt||x.createdAt).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}</small></div><p>{x.content}</p>{x.vitals?.bloodGlucose!=null&&<small>Đường huyết: {x.vitals.bloodGlucose} mg/dL</small>}{x.insulin?.given&&<small className="insulin-log">Đã tiêm {x.insulin.medicationName||'Insulin'} • {x.insulin.dose} IU</small>}{x.requiresHandover&&<small>→ {x.followUp}</small>}</div>)}{!residentChanges.length&&<div className="empty compact">Chưa có ghi nhận trong ca.</div>}</div></div>
      </div>
    </div></div>}

    {resolveTarget&&<div className="modal review-modal"><div className="modal-card resolve-card"><div className="modal-head"><div><h2>Hoàn tất xử lý — {resolveTarget.residentName}</h2><p>Chỉ cần ghi kết quả ngắn. Sau khi xác nhận, cảnh báo sẽ rời danh sách chờ xử lý.</p></div><button className="secondary" onClick={()=>setResolveTarget(null)}>Đóng</button></div><div className={`clinical-alert ${resolveTarget.attentionLevel}`}><b>{resolveTarget.attentionLevel==='RED'?'CẢNH BÁO ĐỎ':'CẢNH BÁO VÀNG'}</b><span>{resolveTarget.content}</span></div><label>Kết quả xử lý *<textarea autoFocus placeholder="Ví dụ: Đã đo lại, chỉ số ổn định; bác sĩ trực đã đánh giá và tiếp tục theo dõi." value={resolveNote} onChange={e=>setResolveNote(e.target.value)}/></label><div className="actions"><button disabled={resolveBusy||!resolveNote.trim()} onClick={resolveChange}>{resolveBusy?'Đang lưu…':'Xác nhận đã xử lý'}</button><button className="secondary" disabled={resolveBusy} onClick={()=>setResolveTarget(null)}>Quay lại</button></div></div></div>}

    {voiceReview&&<div className="modal review-modal"><div className="modal-card"><div className="modal-head"><div><h2>Kiểm tra nội dung giọng nói</h2><p>AI chỉ đề xuất làm sạch, không tự áp dụng và không được đổi con số.</p></div><button className="secondary" onClick={discardVoice}>Xóa phần vừa nghe</button></div>
      <div className="voice-compare"><div className="voice-transcript"><b>Bản nhận dạng gốc</b><p>“{voiceReview.transcript}”</p><small>Độ tin cậy ước tính: {Math.round((voiceReview.confidence||0)*100)}%</small><button className="secondary" onClick={()=>chooseVoiceText(voiceReview.transcript)}>Dùng bản gốc</button></div><div className="voice-transcript cleaned"><b>Bản làm sạch đề xuất</b>{voiceReview.cleaning?<p>Đang kiểm tra câu chữ…</p>:<p>“{voiceReview.cleanedText||voiceReview.transcript}”</p>}{voiceReview.cleanWarning&&<small>{voiceReview.cleanWarning}</small>}<button disabled={voiceReview.cleaning} onClick={()=>chooseVoiceText(voiceReview.cleanedText||voiceReview.transcript)}>Dùng bản làm sạch</button></div></div>
      <label>Nội dung sẽ đưa vào form<textarea className="chosen-transcript" value={voiceReview.chosenText||voiceReview.transcript} onChange={e=>chooseVoiceText(e.target.value)}/><small className="field-help">Bạn có thể sửa lại tại đây. Hệ thống vẫn còn bước kiểm tra toàn bộ trước khi lưu.</small></label>
      <div className="form-grid voice-review-grid"><label>Mạch<input type="number" inputMode="numeric" value={voiceReview.parsed.pulse} onChange={e=>setVoiceReview({...voiceReview,parsed:{...voiceReview.parsed,pulse:e.target.value}})}/></label><label>Nhiệt độ<input type="number" inputMode="decimal" step="0.1" value={voiceReview.parsed.temperature} onChange={e=>setVoiceReview({...voiceReview,parsed:{...voiceReview.parsed,temperature:e.target.value}})}/></label><label>HA tâm thu<input type="number" inputMode="numeric" value={voiceReview.parsed.bpSys} onChange={e=>setVoiceReview({...voiceReview,parsed:{...voiceReview.parsed,bpSys:e.target.value}})}/></label><label>HA tâm trương<input type="number" inputMode="numeric" value={voiceReview.parsed.bpDia} onChange={e=>setVoiceReview({...voiceReview,parsed:{...voiceReview.parsed,bpDia:e.target.value}})}/></label><label>SpO₂<input type="number" inputMode="numeric" value={voiceReview.parsed.spo2} onChange={e=>setVoiceReview({...voiceReview,parsed:{...voiceReview.parsed,spo2:e.target.value}})}/></label><label>Nhịp thở<input type="number" inputMode="numeric" value={voiceReview.parsed.respiratoryRate} onChange={e=>setVoiceReview({...voiceReview,parsed:{...voiceReview.parsed,respiratoryRate:e.target.value}})}/></label></div>
      <div className="actions"><button onClick={applyVoice}>Áp dụng nội dung & chỉ số</button><button className="secondary" onClick={discardVoice}>Xóa phần vừa nghe</button></div>
    </div></div>}

    {review&&<div className="modal review-modal"><div className="modal-card wide"><div className="modal-head"><div><h2>Kiểm tra trước khi lưu</h2><p>Chưa gửi dữ liệu. Đọc lại thông tin của {sel?.fullName} trước khi xác nhận.</p></div><button className="secondary" onClick={()=>setReview(null)}>Quay lại sửa</button></div>
      <div className="review-grid"><div><small>Người cao tuổi</small><b>{sel?.fullName}</b><span>{sel?.areaName} • {sel?.roomName} • {sel?.bedName}</span></div><div><small>Thời điểm</small><b>{new Date(form.occurredAt).toLocaleString('vi-VN')}</b><span>{categories.find(x=>x[0]===form.category)?.[1]} • {levels.find(x=>x[0]===form.priority)?.[1]}</span></div><div className="review-wide"><small>Nội dung</small><p>{form.content}</p></div><div className="review-wide"><small>Dấu hiệu sinh tồn</small><p>{[form.pulse&&`Mạch ${form.pulse} lần/phút`,form.temperature&&`Nhiệt độ ${form.temperature}°C`,form.bpSys&&form.bpDia&&`Huyết áp ${form.bpSys}/${form.bpDia} mmHg`,form.spo2&&`SpO₂ ${form.spo2}%`,form.respiratoryRate&&`Nhịp thở ${form.respiratoryRate} lần/phút`,form.bloodGlucose&&`Đường huyết ${form.bloodGlucose} mg/dL`].filter(Boolean).join(' • ')||'Không nhập chỉ số'}</p>{form.insulinGiven&&<p><b>Insulin:</b> {form.insulinDose} IU</p>}</div>{form.entryMode==='FULL'&&<><div><small>Tiêu</small><b>{bowelLabels[form.bowelStatus]}</b></div><div><small>Tiểu</small><b>{urineLabels[form.urineStatus]}</b><span>{form.urineDetail}</span></div><div className="review-wide"><small>Ghi chú tiêu/tiểu</small><p>{form.note||'Không có'}</p></div><div className="review-wide"><small>Ảnh vết loét</small><p>{form.woundImages.length} ảnh, tự xóa sau 90 ngày.</p></div></>}</div>
      {review.alerts?.length>0&&<div className={`clinical-alert ${review.alerts.some(x=>x.level==='RED')?'RED':'YELLOW'}`}><b>{review.alerts.some(x=>x.level==='RED')?'CẢNH BÁO ĐỎ':'CẢNH BÁO VÀNG'}</b><span>{review.alerts.map(x=>x.message).join(' • ')}</span>{review.alerts.some(x=>x.level==='RED')&&<small>Đã xác nhận đo lại • Đã báo: {form.urgentNotifiedTo} • Xử lý: {form.urgentAction}</small>}</div>}
      <div className="confirm-note">Bấm “Xác nhận lưu” mới ghi dữ liệu vào hệ thống.</div><div className="actions"><button disabled={saveBusy} onClick={save}>{saveBusy?'Đang lưu...':'Xác nhận lưu'}</button><button className="secondary" disabled={saveBusy} onClick={()=>setReview(null)}>Quay lại chỉnh sửa</button></div>
    </div></div>}

    {preview&&<div className="modal"><div className="modal-card wide"><div className="modal-head"><div><h2>Sổ bàn giao ca</h2><p>{shiftLabel(preview.shift.shiftType)} • {preview.shift.shiftDate} • {preview.shift.branchName}</p></div><button className="secondary" onClick={()=>setPreview(null)}>Đóng</button></div>
      <div className="stats"><div className="stat"><b>{preview.summary.totalResidents}</b><span>Tổng NCT</span></div><div className="stat danger-stat"><b>{preview.summary.openRed||0}</b><span>Đỏ chưa xử lý</span></div><div className="stat warning-stat"><b>{preview.summary.openYellow||0}</b><span>Vàng chưa xử lý</span></div><div className="stat"><b>{preview.summary.requiresHandover}</b><span>Cần bàn giao</span></div><div className="stat"><b>{preview.summary.toiletingAbnormal}</b><span>Tiêu/tiểu cần lưu ý</span></div></div>
      <div className="handover-groups">{Object.entries(groupedHandover).map(([rid,rows])=><div className="handover-group" key={rid}><h3>{rows[0].residentName}</h3>{rows.map(x=><div key={x.id}><b>{x.content}</b><span>{x.followUp?`Việc ca sau: ${x.followUp}`:`Cảnh báo ${x.attentionLevel} chưa xử lý — ca sau tiếp tục theo dõi và cập nhật kết quả.`}</span></div>)}</div>)}{!Object.keys(groupedHandover).length&&<div className="empty compact">Không có mục bắt buộc chuyển ca.</div>}</div>
      {(preview.toileting||[]).length>0&&<div className="panel inner"><h3>Tiêu / tiểu cần lưu ý</h3>{preview.toileting.map(x=><div className="bar-row" key={x.id}><span>{x.residentName}: {bowelLabels[x.bowelStatus]||x.bowelStatus} / {urineLabels[x.urineStatus]||x.urineStatus}</span><small>{[x.urineDetail,x.note].filter(Boolean).join(' • ')}</small></div>)}</div>}
      <div className="signature-box"><h3>Xác nhận tập thể nhân sự trực ca</h3><p>Tick đủ các tài khoản đã trực ca. Hệ thống lưu cụ thể họ tên, mã nhân viên và tài khoản xác nhận để truy vết; không yêu cầu từng người ký chi tiết riêng hoặc nhập mật khẩu.</p>{preview.handover?.confirmedAt?<><div className="success-sign">✓ Đã giao bởi <b>{preview.handover.confirmedByName}</b> lúc {new Date(preview.handover.confirmedAt).toLocaleString('vi-VN')}</div><div className="handover-participant-result">{(preview.handover.participants||[]).map(person=><span key={person.userId}>✓ {person.fullName} ({person.employeeCode||person.username})</span>)}</div></>:canSign?<><div className="handover-participants">{(preview.assignedStaff||preview.shift.assignedStaff||[]).map(person=><label className={`staff-option ${signature.participantIds.includes(person.id)?'selected':''}`} key={person.id}><input type="checkbox" checked={signature.participantIds.includes(person.id)} onChange={()=>toggleParticipant(person.id)}/><span><b>{person.fullName}</b><small>Mã NV: {person.employeeCode||person.username}</small></span></label>)}</div><small className="field-help">Đã xác nhận {signature.participantIds.length}/{(preview.assignedStaff||preview.shift.assignedStaff||[]).length} nhân sự.</small><label>Ghi chú bàn giao<textarea value={signature.note} onChange={e=>setSignature({...signature,note:e.target.value})}/></label><label className="check"><input type="checkbox" checked={signature.confirm} onChange={e=>setSignature({...signature,confirm:e.target.checked})}/> Tôi xác nhận danh sách trên là những người trực ca và nội dung bàn giao đã được rà soát.</label><button disabled={signature.participantIds.length!==(preview.assignedStaff||preview.shift.assignedStaff||[]).length} onClick={confirm}>Xác nhận bàn giao & khóa ca</button></>:<div className="read-only-note">Tài khoản này chỉ xem, không được ký bàn giao.</div>}</div>
      {preview.handover?.confirmedAt&&<div className="signature-box"><h3>Ký nhận ca</h3>{preview.handover?.receivedAt?<div className="success-sign">✓ Đã nhận bởi <b>{preview.handover.receivedByName}</b> lúc {new Date(preview.handover.receivedAt).toLocaleString('vi-VN')}</div>:canReceive?<><label>Mật khẩu tài khoản hiện tại<input type="password" value={receiveSig.password} onChange={e=>setReceiveSig({...receiveSig,password:e.target.value})}/></label><label className="check"><input type="checkbox" checked={receiveSig.confirm} onChange={e=>setReceiveSig({...receiveSig,confirm:e.target.checked})}/> Tôi đã xem và nhận nội dung bàn giao của ca trước.</label><button onClick={receive}>Ký nhận</button></>:<div className="read-only-note">Chưa có người nhận ca ký nhận.</div>}</div>}
    </div></div>}
  </section>
}
