import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const catLabel={HEALTH:'Sức khỏe',NUTRITION:'Dinh dưỡng / ăn uống',PSYCHOLOGY:'Tâm lý / hành vi',SKIN:'Ngoài da',INCIDENT:'Ngã / sự cố',OTHER:'Khác'};
const urineLabel={NORMAL:'BT',SONDE:'Qua sonde',CATHETER:'Qua ống tiểu',DIAPER:'Qua tã',OTHER:'Khác',LOW:'Tiểu ít',NONE:'Không tiểu'};
const bowelLabel={NORMAL:'Bình thường',CONSTIPATION:'Táo bón',DIARRHEA:'Tiêu chảy',OTHER:'Khác'};
const today=()=>new Date().toLocaleDateString('en-CA');
function vitalText(v){if(!v)return'';return[v.pulse!=null&&`Mạch ${v.pulse}`,v.temperature!=null&&`Nhiệt ${v.temperature}°C`,v.bpSys!=null&&`HA ${v.bpSys}/${v.bpDia}`,v.spo2!=null&&`SpO₂ ${v.spo2}%`,v.respiratoryRate!=null&&`Thở ${v.respiratoryRate}`].filter(Boolean).join(' • ')}
function formatDate(v){if(!v)return'—';return new Date(`${v}T00:00:00`).toLocaleDateString('vi-VN')}
function formatDateTime(v){if(!v)return'—';return new Date(v).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}
function ImageCell({images,onOpen}){const list=(images||[]).filter(x=>x?.dataUrl||x?.url||x?.image||typeof x==='string');if(!list.length)return <span>—</span>;return <div className="report-image-strip">{list.slice(0,3).map((x,i)=>{const src=typeof x==='string'?x:(x.dataUrl||x.url||x.image);return <button type="button" key={i} onClick={()=>onOpen(src)}><img src={src} alt="Ảnh tổn thương"/></button>})}</div>}

export default function Reports(){
  const {user}=useAuth();
  const [searchParams]=useSearchParams();
  const initial=today();
  const [from,setFrom]=useState(searchParams.get('from')||initial);
  const [to,setTo]=useState(searchParams.get('to')||initial);
  const [d,setD]=useState(null);
  const [branches,setBranches]=useState([]);
  const [branchId,setBranchId]=useState(searchParams.get('branchId')||user.branchId||'');
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [q,setQ]=useState('');
  const [filter,setFilter]=useState('ALL');
  const [imagePreview,setImagePreview]=useState(null);
  const [residentModal,setResidentModal]=useState(null);
  const [residentLoading,setResidentLoading]=useState(false);
  const rangeLabel=from===to?formatDate(from):`${formatDate(from)} → ${formatDate(to)}`;
  const isAdmin=user.role==='ADMIN';

  async function load(){setLoading(true);try{setErr('');const r=await api.reports(from,to,branchId);setD(r.data)}catch(e){setErr(e.message);setD(null)}finally{setLoading(false)}}
  useEffect(()=>{load()},[from,to,branchId]);
  useEffect(()=>{api.branches().then(r=>setBranches(r.data||[])).catch(e=>setErr(e.message))},[]);

  const branchSummaries=useMemo(()=>{
    if(d?.branchSummaries?.length)return d.branchSummaries;
    const map=new Map();
    for(const s of d?.shiftDetails||[]){const key=String(s.branchId||'');const x=map.get(key)||{branchId:key,branchName:s.branchName||'Chưa xác định',shifts:0,residents:0,changes:0,redOpen:0,yellowOpen:0};x.shifts++;x.residents+=Number(s.residentCount||0);x.changes+=Number(s.changeCount||0);map.set(key,x)}
    return [...map.values()];
  },[d]);

  const details=useMemo(()=>{const query=q.trim().toLowerCase();return(d?.details||[]).filter(x=>(filter==='ALL'||filter==='HANDOVER'&&x.requiresHandover||filter==='OPEN'&&x.attentionLevel&&x.attentionStatus==='OPEN'||filter===x.attentionLevel)&&(!query||`${x.residentName} ${x.content} ${x.areaName} ${x.roomName} ${x.createdByName}`.toLowerCase().includes(query)))},[d,q,filter]);
  const residentSummaries=useMemo(()=>{const query=q.trim().toLowerCase();return(d?.residentSummaries||[]).filter(x=>!query||`${x.residentName} ${x.areaName} ${x.roomName} ${x.branchName}`.toLowerCase().includes(query))},[d,q]);
  const showDetail=!isAdmin||!!branchId||branchSummaries.length<=1;

  async function openResident(row){try{setResidentLoading(true);setResidentModal({resident:{id:row.residentId,name:row.residentName,areaName:row.areaName,roomName:row.roomName,bedName:row.bedName},summary:row,changes:[],toileting:[]});const r=await api.residentMedicalReport(row.residentId,from,to,branchId);setResidentModal(r.data)}catch(e){setErr(e.message)}finally{setResidentLoading(false)}}

  function exportCsv(){if(!d)return;const rows=[['Ngày giờ','Cơ sở','NCT','Khu','Phòng/Giường','Nhóm','Mức','Trạng thái','Nội dung','Sinh hiệu','Xử lý','Người ghi'],...details.map(x=>[formatDateTime(x.occurredAt||x.createdAt),x.branchName||'',x.residentName,x.areaName||'',`${x.roomName||''} ${x.bedName||''}`,catLabel[x.category]||x.category,x.attentionLevel||'',x.attentionStatus==='RESOLVED'?'Đã xử lý':x.attentionLevel?'Cần xử lý':'',x.content,vitalText(x.vitals),x.intervention||'',x.createdByName||''])];const csv='\ufeff'+rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=`bcare-bao-cao-${from}-${to}.csv`;a.click()}

  return <section>
    <header className="page-head report-page-head"><div><h1>Báo cáo biến động NCT</h1><p>Admin xem tổng hợp theo từng cơ sở trước; chọn một cơ sở để đi sâu NCT và biến động.</p></div><div className="report-top-actions"><Link className="button-link" to="/reports/staff">Báo cáo nhân viên</Link><button className="secondary" onClick={exportCsv} disabled={!d}>Xuất CSV</button></div></header>
    {err&&<div className="error">{err}</div>}

    <div className="report-period-panel">
      <div className="report-period-inputs">
        <label>Từ ngày<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label>Đến ngày<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
        <label>Cơ sở<select value={branchId} onChange={e=>setBranchId(e.target.value)} disabled={!isAdmin}><option value="">{isAdmin?'Tất cả cơ sở':'Cơ sở của tôi'}</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <div className="report-range-summary"><b>{rangeLabel}</b><small>{branchId?(branches.find(b=>String(b.id)===String(branchId))?.name||'Cơ sở đã chọn'):'Tổng hợp toàn hệ thống'}</small></div>
      </div>
    </div>

    {loading?<div className="page-loading"><div className="page-loading-card"><span className="loading-spinner"/><b>Đang tải báo cáo...</b><small>Chỉ truy vấn dữ liệu trong khoảng ngày/cơ sở đã chọn.</small></div></div>:<>
      {isAdmin&&branchSummaries.length>1&&<div className="panel branch-overview-panel"><div className="panel-title"><div><h2>Tổng hợp theo cơ sở</h2><p>Chọn một cơ sở để xem danh sách NCT và biến động chi tiết, tránh trộn dữ liệu nhiều cơ sở.</p></div><span>{branchSummaries.length} cơ sở</span></div><div className="branch-report-grid">{branchSummaries.map(x=><button key={x.branchId} className={`branch-report-card ${String(branchId)===String(x.branchId)?'selected':''}`} onClick={()=>setBranchId(String(x.branchId))}><div><b>{x.branchName}</b><small>{x.shifts} ca • {x.residents} NCT</small></div><div className="branch-report-numbers"><span><b>{x.changes}</b> biến động</span><span className="red"><b>{x.redOpen}</b> đỏ mở</span><span className="yellow"><b>{x.yellowOpen}</b> vàng mở</span></div></button>)}</div>{branchId&&<button className="secondary compact-button" onClick={()=>setBranchId('')}>← Xem lại toàn hệ thống</button>}</div>}

      <div className="stats report-kpis"><div className="stat"><b>{d?.shifts||0}</b><span>Ca</span></div><div className="stat"><b>{d?.uniqueResidents||0}</b><span>NCT có dữ liệu</span></div><div className="stat"><b>{d?.changes||0}</b><span>Biến động phát sinh</span></div><div className="stat danger"><b>{d?.openRed||0}</b><span>Đỏ chưa xử lý</span></div><div className="stat warning"><b>{d?.openYellow||0}</b><span>Vàng chưa xử lý</span></div><div className="stat"><b>{d?.resolutionRate??100}%</b><span>Tỷ lệ xử lý</span></div></div>

      {!showDetail&&<div className="empty report-select-branch"><b>Chọn một cơ sở ở trên để xem chi tiết.</b><span>Ở chế độ toàn hệ thống chỉ hiển thị tổng hợp theo cơ sở để tránh danh sách NCT bị trộn và quá dài.</span></div>}

      {showDetail&&<>
        <div className="panel report-control-panel"><div className="panel-title"><div><h2>NCT trong kỳ</h2><p>Ưu tiên NCT có cảnh báo Đỏ/Vàng lên trước.</p></div><span>{residentSummaries.length} NCT</span></div><div className="report-inline-filters"><input placeholder="Tìm NCT / phòng / khu..." value={q} onChange={e=>setQ(e.target.value)}/><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="ALL">Tất cả biến động</option><option value="OPEN">Cần xử lý</option><option value="RED">Đỏ</option><option value="YELLOW">Vàng</option><option value="HANDOVER">Cần bàn giao</option></select></div><div className="resident-report-grid">{residentSummaries.map(x=><button key={x.residentId} className={`resident-report-card ${x.redOpen?'risk-red':x.yellowOpen?'risk-yellow':''}`} onClick={()=>openResident(x)}><div className="resident-report-card-head"><div><b>{x.residentName}</b><small>{x.areaName||'—'} • {x.roomName||'—'} • {x.bedName||'—'}</small></div>{x.redOpen?<span className="attention-status RED">ĐỎ {x.redOpen}</span>:x.yellowOpen?<span className="attention-status YELLOW">VÀNG {x.yellowOpen}</span>:<span className="resident-ok">Ổn</span>}</div><div className="resident-mini-stats"><span><b>{x.changeCount}</b> biến động</span><span><b>{x.handoverCount}</b> bàn giao</span><span><b>{x.toiletingAbnormal}</b> tiêu/tiểu lưu ý</span></div>{x.lastContent&&<div className="resident-last-event"><small>{formatDateTime(x.lastEventAt)}</small><p>{x.lastContent}</p><em>{vitalText(x.latestVitals)}</em></div>}</button>)}</div>{!residentSummaries.length&&<div className="empty compact">Không có NCT phù hợp trong kỳ.</div>}</div>

        <div className="panel"><div className="panel-title"><div><h2>Chi tiết biến động</h2><p>Chỉ dữ liệu của cơ sở đang chọn.</p></div><span>{details.length} dòng</span></div><div className="table-wrap flat"><table><thead><tr><th>Ngày giờ</th><th>NCT</th><th>Mức / trạng thái</th><th>Nội dung và xử lý</th><th>Ảnh</th><th>Người ghi</th></tr></thead><tbody>{details.map(x=><tr key={x.id}><td>{formatDateTime(x.occurredAt||x.createdAt)}</td><td><button className="link-button resident-name-link" onClick={()=>openResident(x)}><b>{x.residentName}</b></button><small>{x.areaName||'—'} • {x.roomName||'—'} • {x.bedName||'—'}</small></td><td>{x.attentionLevel?<><span className={`attention-status ${x.attentionLevel}`}>{x.attentionLevel}</span><small>{x.attentionStatus==='RESOLVED'?'Đã xử lý':'Cần xử lý'}</small></>:<span className="badge">Thông thường</span>}</td><td>{x.content}<small>{vitalText(x.vitals)}</small>{x.intervention&&<small><b>Xử lý:</b> {x.intervention}</small>}</td><td><ImageCell images={x.woundImages} onOpen={setImagePreview}/></td><td>{x.createdByName||'—'}</td></tr>)}</tbody></table></div>{!details.length&&<div className="empty compact">Không có biến động phù hợp.</div>}</div>

        <div className="panel"><h2>Tiêu / tiểu</h2><div className="table-wrap flat"><table><thead><tr><th>Ngày giờ</th><th>NCT</th><th>Tiêu</th><th>Tiểu</th><th>Ghi chú</th><th>Người ghi</th></tr></thead><tbody>{(d?.toiletingDetails||[]).map(x=><tr key={x.id}><td>{formatDateTime(x.createdAt)}</td><td><button className="link-button" onClick={()=>openResident(x)}><b>{x.residentName}</b></button><small>{x.areaName} • {x.roomName} • {x.bedName}</small></td><td>{bowelLabel[x.bowelStatus]||x.bowelStatus}</td><td>{urineLabel[x.urineStatus]||x.urineStatus}</td><td>{[x.urineDetail,x.note].filter(Boolean).join(' • ')||'—'}</td><td>{x.createdByName||'—'}</td></tr>)}</tbody></table></div></div>
      </>}
    </>}

    {residentModal&&<div className="modal" onClick={()=>setResidentModal(null)}><div className="modal-card resident-report-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><h2>{residentModal.resident?.name||'Chi tiết NCT'}</h2><p>{[residentModal.resident?.areaName,residentModal.resident?.roomName,residentModal.resident?.bedName].filter(Boolean).join(' • ')} · {rangeLabel}</p></div><button className="secondary" onClick={()=>setResidentModal(null)}>Đóng</button></div>{residentLoading?<div className="inline-loading"><span className="loading-spinner"/>Đang tải hồ sơ...</div>:<div className="resident-timeline"><h3>Diễn tiến chăm sóc</h3>{(residentModal.changes||[]).map(x=><div className={`timeline-item ${x.attentionLevel||''}`} key={x.id}><div className="timeline-time">{formatDateTime(x.occurredAt||x.createdAt)}</div><div className="timeline-body"><div className="timeline-title"><b>{catLabel[x.category]||x.category||'Biến động phát sinh'}</b>{x.attentionLevel&&<span className={`attention-status ${x.attentionLevel}`}>{x.attentionLevel}</span>}</div><p>{x.content}</p>{vitalText(x.vitals)&&<small>{vitalText(x.vitals)}</small>}<div className="timeline-meta">Người ghi: {x.createdByName||'—'}</div><ImageCell images={x.woundImages} onOpen={setImagePreview}/></div></div>)}{!(residentModal.changes||[]).length&&<div className="empty compact">Không có biến động trong kỳ.</div>}<h3>Tiêu / tiểu</h3>{(residentModal.toileting||[]).map(x=><div className="timeline-item" key={x.id}><div className="timeline-time">{formatDateTime(x.createdAt)}</div><div className="timeline-body"><p><b>Tiêu:</b> {bowelLabel[x.bowelStatus]||x.bowelStatus} · <b>Tiểu:</b> {urineLabel[x.urineStatus]||x.urineStatus}</p><small>{[x.urineDetail,x.note].filter(Boolean).join(' • ')||'Không ghi chú'}</small></div></div>)}</div>}</div></div>}
    {imagePreview&&<div className="modal image-modal-top" onClick={()=>setImagePreview(null)}><div className="modal-card image-preview-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>Ảnh vết loét / tổn thương da</h2><button className="secondary" onClick={()=>setImagePreview(null)}>Đóng</button></div><img src={imagePreview} alt="Ảnh tổn thương"/></div></div>}
  </section>
}
