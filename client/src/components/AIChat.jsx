import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../services/api';

const QUICK=[
  'Tóm tắt phạm vi báo cáo đang xem',
  'NCT nào đang có cảnh báo đỏ hoặc vàng?',
  'Có việc bàn giao nào chưa xong?',
  'Tóm tắt chỉ số sinh tồn đáng chú ý'
];

function todayVN(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date());
}

function scopeFromLocation(location){
  const params=new URLSearchParams(location.search||'');
  const today=todayVN();
  const from=params.get('from')||params.get('date')||today;
  const to=params.get('to')||params.get('date')||from;
  const branchId=params.get('branchId')||'';
  const residentMatch=location.pathname.match(/^\/reports\/resident\/([^/?#]+)/);
  return {
    from,
    to,
    branchId,
    page:location.pathname,
    residentId:residentMatch?decodeURIComponent(residentMatch[1]):''
  };
}

function scopeLabel(scope){
  if(scope.from===scope.to)return scope.from;
  return `${scope.from} → ${scope.to}`;
}

export default function AIChat(){
  const location=useLocation();
  const scope=useMemo(()=>scopeFromLocation(location),[location.pathname,location.search]);
  const [open,setOpen]=useState(false);
  const [text,setText]=useState('');
  const [rows,setRows]=useState([{role:'assistant',content:'Chào bạn. Tôi đọc dữ liệu CSDL theo đúng phạm vi trang báo cáo hiện tại và quyền tài khoản; tôi không tự sửa hồ sơ.'}]);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState(null);

  useEffect(()=>{
    if(!open)return;
    api.aiStatus().then(r=>setStatus(r?.data||null)).catch(()=>setStatus(null));
  },[open]);

  function addAssistant(data){
    setRows(current=>[...current,{
      role:'assistant',
      content:String(data?.answer||'Không có phản hồi.'),
      sources:Array.isArray(data?.sources)?data.sources:[],
      mode:data?.mode||'',
      warning:data?.warning||'',
      scope:data?.scope||null
    }]);
  }

  async function ask(input=text){
    const q=String(input||'').trim();
    if(!q||busy)return;
    setRows(current=>[...current,{role:'user',content:q}]);
    setText('');
    setBusy(true);
    try{
      const res=await api.aiChat(q,scope);
      addAssistant(res?.data||{});
    }catch(error){
      console.error('[AI CHAT] request failed',error);
      setRows(current=>[...current,{role:'assistant',content:`Không đọc được dữ liệu báo cáo: ${error.message}`}]);
    }finally{setBusy(false)}
  }

  async function report(){
    if(busy)return;
    setRows(current=>[...current,{role:'user',content:`Tạo báo cáo ${scopeLabel(scope)}`}]);
    setBusy(true);
    try{
      const res=await api.aiReport(scope);
      addAssistant(res?.data||{});
    }catch(error){
      console.error('[AI REPORT] request failed',error);
      setRows(current=>[...current,{role:'assistant',content:`Không tạo được báo cáo: ${error.message}`}]);
    }finally{setBusy(false)}
  }

  const aiLabel=status?.geminiAvailable?'Gemini + CSDL':'Báo cáo nội bộ từ CSDL';

  return <>
    <button className="ai-fab" onClick={()=>setOpen(value=>!value)}>AI</button>
    {open&&<div className="ai-panel">
      <div className="ai-head">
        <div>
          <b>Trợ lý ShiftCare</b>
          <small>Read-only • theo quyền tài khoản</small>
          <small>Phạm vi: {scopeLabel(scope)}</small>
          <small>{aiLabel}</small>
          {status?.geminiWarning&&<small>{status.geminiWarning}</small>}
        </div>
        <button className="secondary" onClick={()=>setOpen(false)}>×</button>
      </div>

      <div className="ai-quick">
        <button disabled={busy} onClick={report}>📋 Báo cáo phạm vi đang xem</button>
        {QUICK.map(q=><button className="secondary" key={q} disabled={busy} onClick={()=>ask(q)}>{q}</button>)}
      </div>

      <div className="ai-messages">
        {rows.map((m,i)=><div key={i} className={`ai-msg ${m.role}`}>
          <div>{m.content}</div>
          {m.sources?.length>0&&<small>Nguồn: {m.sources.slice(0,5).map(s=>s.label||s.type).join(' • ')}</small>}
          {m.scope?.from&&<small>Phạm vi dữ liệu: {m.scope.from}{m.scope.to&&m.scope.to!==m.scope.from?` → ${m.scope.to}`:''}</small>}
          {m.mode&&<small>{m.mode==='gemini'?'Gemini trên dữ liệu CSDL':'Báo cáo nội bộ từ CSDL'}</small>}
          {m.warning&&<small>{m.warning}</small>}
        </div>)}
        {busy&&<div className="ai-msg assistant">Đang đọc dữ liệu CSDL trong phạm vi đang xem…</div>}
      </div>

      <div className="ai-compose">
        <textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask()}}} placeholder="Hỏi về cảnh báo, bàn giao, sinh hiệu, biến động…"/>
        <button onClick={()=>ask()} disabled={busy||!text.trim()}>Gửi</button>
      </div>
    </div>}
  </>;
}
