import { useEffect, useState } from 'react';
import { api } from '../services/api';

const QUICK=[
  'Tóm tắt báo cáo hôm nay',
  'NCT nào đang có cảnh báo đỏ hoặc vàng?',
  'Có việc bàn giao nào chưa xong?',
  'Tóm tắt chỉ số sinh tồn đáng chú ý'
];

export default function AIChat(){
  const [open,setOpen]=useState(false);
  const [text,setText]=useState('');
  const [rows,setRows]=useState([{role:'assistant',content:'Chào bạn. Tôi đọc dữ liệu trong CSDL theo đúng phạm vi tài khoản và không tự sửa hồ sơ.'}]);
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
      warning:data?.warning||''
    }]);
  }

  async function ask(input=text){
    const q=String(input||'').trim();
    if(!q||busy)return;
    setRows(current=>[...current,{role:'user',content:q}]);
    setText('');
    setBusy(true);
    try{
      const res=await api.aiChat(q);
      addAssistant(res?.data||{});
    }catch(error){
      console.error('[AI CHAT] request failed',error);
      setRows(current=>[...current,{role:'assistant',content:`Không đọc được báo cáo: ${error.message}`}]);
    }finally{setBusy(false)}
  }

  async function report(){
    if(busy)return;
    setRows(current=>[...current,{role:'user',content:'Tạo báo cáo hôm nay'}]);
    setBusy(true);
    try{
      const res=await api.aiReport();
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
          <small>{aiLabel}</small>
          {status?.geminiWarning&&<small>{status.geminiWarning}</small>}
        </div>
        <button className="secondary" onClick={()=>setOpen(false)}>×</button>
      </div>

      <div className="ai-quick">
        <button disabled={busy} onClick={report}>📋 Báo cáo hôm nay</button>
        {QUICK.map(q=><button className="secondary" key={q} disabled={busy} onClick={()=>ask(q)}>{q}</button>)}
      </div>

      <div className="ai-messages">
        {rows.map((m,i)=><div key={i} className={`ai-msg ${m.role}`}>
          <div>{m.content}</div>
          {m.sources?.length>0&&<small>Nguồn: {m.sources.slice(0,5).map(s=>s.label||s.type).join(' • ')}</small>}
          {m.mode&&<small>{m.mode==='gemini'?'Gemini trên dữ liệu CSDL':'Báo cáo nội bộ từ CSDL'}</small>}
          {m.warning&&<small>{m.warning}</small>}
        </div>)}
        {busy&&<div className="ai-msg assistant">Đang đọc dữ liệu và tổng hợp…</div>}
      </div>

      <div className="ai-compose">
        <textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask()}}} placeholder="Hỏi về cảnh báo, bàn giao, sinh hiệu, biến động…"/>
        <button onClick={()=>ask()} disabled={busy||!text.trim()}>Gửi</button>
      </div>
    </div>}
  </>;
}
