import { useState } from 'react';
import { api } from '../services/api';

const QUICK=[
  'Hôm nay có NCT nào cần chú ý?',
  'Tóm tắt ca hiện tại',
  'Có việc bàn giao nào chưa xong?',
  'Có trường hợp ngã nào được ghi nhận?'
];

export default function AIChat(){
  const [open,setOpen]=useState(false);
  const [text,setText]=useState('');
  const [rows,setRows]=useState([{role:'assistant',content:'Chào bạn. Tôi chỉ đọc dữ liệu trong phạm vi tài khoản và không tự sửa hồ sơ.'}]);
  const [busy,setBusy]=useState(false);

  async function ask(input=text){
    const q=String(input||'').trim();
    if(!q||busy)return;
    setRows(current=>[...current,{role:'user',content:q}]);
    setText('');
    setBusy(true);
    try{
      // api.aiChat nhận STRING. Bản cũ truyền {message:q} khiến server nhận [object Object].
      const res=await api.aiChat(q);
      const data=res?.data||{};
      setRows(current=>[...current,{
        role:'assistant',
        content:String(data.answer||'Không có phản hồi.'),
        sources:Array.isArray(data.sources)?data.sources:[],
        mode:data.mode,
        warning:data.warning||''
      }]);
    }catch(error){
      console.error('[AI CHAT] request failed',error);
      setRows(current=>[...current,{role:'assistant',content:`Không trả lời được: ${error.message}`}]);
    }finally{
      setBusy(false);
    }
  }

  return <>
    <button className="ai-fab" onClick={()=>setOpen(value=>!value)}>AI</button>
    {open&&<div className="ai-panel">
      <div className="ai-head">
        <div><b>Trợ lý ShiftCare</b><small>Read-only • theo quyền tài khoản</small></div>
        <button className="secondary" onClick={()=>setOpen(false)}>×</button>
      </div>
      <div className="ai-quick">{QUICK.map(q=><button className="secondary" key={q} disabled={busy} onClick={()=>ask(q)}>{q}</button>)}</div>
      <div className="ai-messages">
        {rows.map((m,i)=><div key={i} className={`ai-msg ${m.role}`}>
          <div>{m.content}</div>
          {m.sources?.length>0&&<small>Nguồn: {m.sources.slice(0,5).map(s=>s.label||s.type).join(' • ')}</small>}
          {m.mode&&<small>{m.mode==='gemini'?'Gemini':m.mode==='local-fallback'?'Phân tích nội bộ (AI ngoài đang lỗi)':'Phân tích nội bộ'}</small>}
          {m.warning&&<small>{m.warning}</small>}
        </div>)}
        {busy&&<div className="ai-msg assistant">Đang phân tích dữ liệu…</div>}
      </div>
      <div className="ai-compose">
        <textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask()}}} placeholder="Hỏi về ca, biến động, bàn giao…"/>
        <button onClick={()=>ask()} disabled={busy||!text.trim()}>Gửi</button>
      </div>
    </div>}
  </>;
}
