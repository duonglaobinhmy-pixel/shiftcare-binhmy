import { useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const catLabel={HEALTH:'Sức khỏe',NUTRITION:'Dinh dưỡng',PSYCHOLOGY:'Tâm lý',SKIN:'Ngoài da',INCIDENT:'Ngã / sự cố',OTHER:'Khác'};
const statusLabel={OPEN:'Đang mở',HANDOVER_CONFIRMED:'Đã giao ca',RECEIVED:'Đã nhận ca',CLOSED:'Đã đóng'};
function elapsed(value){const minutes=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/60000));if(minutes<60)return`${minutes} phút`;const hours=Math.floor(minutes/60);return hours<24?`${hours} giờ`:`${Math.floor(hours/24)} ngày`}

export default function Dashboard(){
  const {user}=useAuth(); const [date,setDate]=useState(new Date().toLocaleDateString('en-CA')),[d,setD]=useState(null),[err,setErr]=useState(''),[imagePreview,setImagePreview]=useState(null);
  async function load(){try{setErr('');setD((await api.dashboard(date)).data)}catch(e){setErr(e.message)}}
  useEffect(()=>{load()},[date]);
  return <section>
    <header className="page-head"><div><h1>Điều hành chăm sóc</h1><p>{user.role==='ADMIN'?'Toàn hệ thống':user.branchName} • ưu tiên việc chưa xử lý</p></div><label className="date-filter">Ngày tổng hợp<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label></header>
    {err&&<div className="error">{err}</div>}
    <div className="stats stats-6">
      <div className="stat"><b>{d?.todayShifts??'—'}</b><span>Ca trong ngày</span></div><div className="stat"><b>{d?.uniqueResidents??'—'}</b><span>NCT trong roster</span></div><div className="stat"><b>{d?.changeLogs??'—'}</b><span>Biến động trong ngày</span></div>
      <div className="stat danger-stat"><b>{d?.openRed??'—'}</b><span>Đỏ chưa xử lý</span></div><div className="stat warning-stat"><b>{d?.openYellow??'—'}</b><span>Vàng chưa xử lý</span></div><div className="stat"><b>{d?.pendingReceive??'—'}</b><span>Đã giao chưa nhận</span></div>
    </div>
    <div className="dashboard-grid">
      <div className="panel"><div className="panel-title"><div><h2>Việc cần xử lý</h2><p>Chỉ có hai trạng thái: Cần xử lý → Đã xử lý. Cảnh báo chưa hoàn tất được giữ lại qua các ca.</p></div><Link to="/reports">Báo cáo quản trị →</Link></div>
        <div className="alert-list">{(d?.alerts||[]).map(x=><div className={`alert-row clinical-${x.level}`} key={x.id}><Link className="alert-row-link" to={`/shifts/${x.shiftId}?focusAlert=${encodeURIComponent(x.id)}&residentId=${encodeURIComponent(x.residentId)}`}><div className={`attention-dot ${x.level}`}>{x.level==='RED'?'ĐỎ':'VÀNG'}</div><div><b>{x.residentName}</b><small>{x.areaName||'—'} • {x.roomName||'—'} • {x.bedName||'—'}</small><p>{x.latestContent}</p></div><div className="alert-meta"><span className={`attention-status ${x.level}`}>CẦN XỬ LÝ</span><small>{elapsed(x.latestAt)}</small></div></Link>{x.image&&<button type="button" className="alert-thumb-button" onClick={()=>setImagePreview({src:x.image,title:`Ảnh tổn thương da — ${x.residentName}`})}><img src={x.image} alt="Ảnh vết loét"/><small>Xem ảnh</small></button>}</div>)}{!d?.alerts?.length&&<div className="empty compact success-empty">✓ Không còn cảnh báo Đỏ/Vàng chờ xử lý.</div>}</div>
      </div>
      <div className="panel"><h2>Tổng hợp ngày</h2><div className="bar-row"><span>Đã xử lý trong ngày</span><b>{d?.resolvedToday||0}</b></div><div className="bar-row"><span>Cần bàn giao</span><b>{d?.requiresHandover||0}</b></div>
        <h2 className="mt">Biến động theo nhóm</h2>{Object.entries(d?.byCategory||{}).map(([k,v])=><div className="bar-row" key={k}><span>{catLabel[k]||k}</span><b>{v}</b></div>)}{!Object.keys(d?.byCategory||{}).length&&<div className="empty compact">Chưa có ghi nhận.</div>}
        <h2 className="mt">Tình trạng ca</h2>{(d?.shiftStatus||[]).map(x=><div className="bar-row" key={x.status}><span>{statusLabel[x.status]||x.status}</span><b>{x.count}</b></div>)}</div>
    </div>
    {imagePreview&&<div className="modal" onClick={()=>setImagePreview(null)}><div className="modal-card image-preview-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>{imagePreview.title}</h2><button className="secondary" onClick={()=>setImagePreview(null)}>Đóng</button></div><img src={imagePreview.src} alt={imagePreview.title}/></div></div>}
  </section>
}
