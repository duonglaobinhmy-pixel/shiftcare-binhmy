import { useEffect,useMemo,useRef,useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const catLabel={HEALTH:'Sức khỏe',NUTRITION:'Dinh dưỡng',PSYCHOLOGY:'Tâm lý',SKIN:'Ngoài da',INCIDENT:'Ngã / sự cố',OTHER:'Khác'};
const levelLabel={RED:'Đỏ',YELLOW:'Vàng',NORMAL:'Xanh'};
const vitalColumns=[['pulse','Mạch','lần/phút'],['temperature','Nhiệt độ','°C'],['bp','Huyết áp','mmHg'],['spo2','SpO₂','%'],['respiratoryRate','Nhịp thở','lần/phút'],['bloodGlucose','Đường huyết','mg/dL'],['insulinDoseUnits','Insulin','IU']];
const statusLabel={OPEN:'Đang mở',HANDOVER_CONFIRMED:'Đã giao ca',RECEIVED:'Đã nhận ca',CLOSED:'Đã đóng'};
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date())}
function elapsed(value){const ms=new Date(value).getTime();if(!Number.isFinite(ms))return'—';const minutes=Math.max(0,Math.floor((Date.now()-ms)/60000));if(minutes<60)return`${minutes} phút`;const hours=Math.floor(minutes/60);return hours<24?`${hours} giờ`:`${Math.floor(hours/24)} ngày`}

function measuredAt(value){const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'})}
function vitalValue(v,key){if(key==='bp')return v?.bpSys!=null||v?.bpDia!=null?`${v.bpSys??'—'}/${v.bpDia??'—'}`:'—';return v?.[key]??'—'}
function vitalText(v){return vitalColumns.filter(([key])=>vitalValue(v,key)!=='—').map(([key,label,unit])=>`${label}: ${vitalValue(v,key)} ${unit}`).join(' • ')}
function VitalCells({row}){return vitalColumns.map(([key])=>{const alerts=(row.vitals?.alerts||[]).filter(a=>key==='bp'?['bpSys','bpDia'].includes(a.field):a.field===key);const level=alerts.some(a=>a.level==='RED')?'RED':alerts.length?'YELLOW':'';return <td key={key} className={level?`vital-value-${level}`:''} title={alerts.map(a=>a.message).join(' • ')}>{vitalValue(row.vitals,key)}</td>})}
function csvCell(value){let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text=`'${text}`;return `"${text.replace(/"/g,'""')}"`}
function exportReadings(rows,date){
  const headers=['NCT','Cơ sở','Khu / tầng','Phòng','Giường','Thời điểm đo','Người ghi',...vitalColumns.map(([,label,unit])=>`${label} (${unit})`),'Cảnh báo sinh hiệu','Trạng thái xử lý','Nội dung','Xử lý / hành động','Triệu chứng','Cần bàn giao','Ca sau'];
  const lines=[headers,...rows.map(x=>[x.residentName,x.branchName,x.areaName,x.roomName,x.bedName,measuredAt(x.occurredAt),x.createdByName,...vitalColumns.map(([key])=>vitalValue(x.vitals,key)),levelLabel[x.vitals?.alertLevel]||'Xanh',x.attentionLevel?(x.attentionStatus==='RESOLVED'?'Đã xử lý':'Chưa xử lý'):'—',x.content,x.intervention,x.vitals?.urgent?.symptoms||'',x.requiresHandover?'Có':'Không',x.followUp])];
  const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'}));
  const a=document.createElement('a');a.href=url;a.download=`Sinh-hieu-${date}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export default function Dashboard(){
  const {user,can}=useAuth();
  const [date,setDate]=useState(today()),[d,setD]=useState(null),[err,setErr]=useState(''),[loading,setLoading]=useState(true),[imagePreview,setImagePreview]=useState(null);
  const [search,setSearch]=useState(''),[branch,setBranch]=useState(''),[level,setLevel]=useState(''),[view,setView]=useState('latest'),[refresh,setRefresh]=useState(0),[updatedAt,setUpdatedAt]=useState(null);
  const requestSeq=useRef(0);
  useEffect(()=>{
    const seq=++requestSeq.current;let active=true;setLoading(true);setErr('');setD(null);
    api.dashboard(date).then(r=>{if(active&&seq===requestSeq.current){setD(r.data);setUpdatedAt(new Date().toISOString())}})
      .catch(e=>{if(active&&seq===requestSeq.current)setErr(e.message)})
      .finally(()=>{if(active&&seq===requestSeq.current)setLoading(false)});
    return()=>{active=false};
  },[date,refresh]);
  useEffect(()=>{
    let opened=[];
    const beforePrint=()=>{opened=[...document.querySelectorAll('.dashboard-vital-table details')].filter(x=>!x.open);opened.forEach(x=>{x.open=true})};
    const afterPrint=()=>{opened.forEach(x=>{x.open=false});opened=[]};
    window.addEventListener('beforeprint',beforePrint);window.addEventListener('afterprint',afterPrint);
    return()=>{window.removeEventListener('beforeprint',beforePrint);window.removeEventListener('afterprint',afterPrint);afterPrint()};
  },[]);
  const branches=useMemo(()=>[...new Map((d?.vitalReadings||[]).map(x=>[String(x.branchId||''),x.branchName||String(x.branchId||'Chưa có cơ sở')])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'vi')),[d]);
  const displayRows=useMemo(()=>{
    let rows=d?.vitalReadings||[];
    if(view==='latest'){const seen=new Set();rows=rows.filter(x=>{const key=JSON.stringify([String(x.branchId||''),String(x.residentId)]);if(seen.has(key))return false;seen.add(key);return true})}
    const text=search.trim().toLocaleLowerCase('vi');
    return rows.filter(x=>(!branch||String(x.branchId)===branch)&&(!level||(x.vitals?.alertLevel||'NORMAL')===level)&&(!text||[x.residentName,x.residentId,x.branchName,x.areaName,x.roomName,x.bedName,x.createdByName].join(' ').toLocaleLowerCase('vi').includes(text)));
  },[d,search,branch,level,view]);

  return <section className="care-dashboard">
    <header className="page-head"><div><h1>Điều hành chăm sóc</h1><p>{user.role==='ADMIN'?'Toàn hệ thống':user.branchName} • biến động tính theo thời điểm phát sinh thực tế</p></div><label className="date-filter">Ngày tổng hợp<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label></header>
    {err&&<div className="error">{err}</div>}
    {loading?<div className="page-loading"><div className="page-loading-card"><span className="loading-spinner"/><b>Đang tải dashboard...</b><small>Đang tổng hợp ca, biến động và cảnh báo tồn đọng.</small></div></div>:<>
      <div className="stats stats-6">
        <div className="stat"><b>{d?.todayShifts??0}</b><span>Ca theo lịch ngày</span></div>
        <div className="stat"><b>{d?.uniqueResidents??0}</b><span>NCT có dữ liệu</span></div>
        <div className="stat"><b>{d?.changeLogs??0}</b><span>Biến động phát sinh ngày</span></div>
        <div className="stat danger-stat"><b>{d?.openRed??0}</b><span>Đỏ chưa xử lý</span></div>
        <div className="stat warning-stat"><b>{d?.openYellow??0}</b><span>Vàng chưa xử lý</span></div>
        <div className="stat"><b>{d?.pendingReceive??0}</b><span>Đã giao chưa nhận</span></div>
      </div>
      <div className="panel dashboard-vitals">
        <div className="panel-title"><div><h2>Sinh hiệu trong ngày</h2><p>Mỗi dòng là một lần ghi. Chế độ gần nhất lấy lần có sinh hiệu cuối cùng của từng NCT trong ngày; ô trống hiển thị —.</p><small>Cập nhật: {measuredAt(updatedAt)} • Ngày báo cáo: {date}</small></div><div className="actions dashboard-vital-actions"><button type="button" className="secondary" onClick={()=>setRefresh(x=>x+1)}>Làm mới</button>{can('REPORT.EXPORT')&&<><button type="button" className="secondary" disabled={!displayRows.length} onClick={()=>exportReadings(displayRows,date)}>Xuất CSV ({displayRows.length})</button><button type="button" className="secondary" onClick={()=>window.print()}>In báo cáo</button></>}</div></div>
        <div className="dashboard-vital-summary"><div><b>{d?.vitalSummary?.residents??0}</b><span>NCT có sinh hiệu</span></div><div><b>{d?.vitalSummary?.measurements??0}</b><span>Lần ghi sinh hiệu</span></div><div className="vital-value-RED"><b>{d?.vitalSummary?.red??0}</b><span>Lần ghi có chỉ số Đỏ</span></div><div className="vital-value-YELLOW"><b>{d?.vitalSummary?.yellow??0}</b><span>Lần ghi có chỉ số Vàng</span></div></div>
        <div className="dashboard-vital-filters"><label>Tìm NCT / vị trí / người ghi<input type="search" placeholder="Nhập tên, mã NCT, phòng…" value={search} onChange={e=>setSearch(e.target.value)}/></label>{user.role==='ADMIN'&&<label>Cơ sở<select value={branch} onChange={e=>setBranch(e.target.value)}><option value="">Tất cả cơ sở</option>{branches.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>}<label>Hiển thị<select value={view} onChange={e=>setView(e.target.value)}><option value="latest">Gần nhất theo NCT</option><option value="all">Tất cả lần ghi trong ngày</option></select></label><label>Cảnh báo sinh hiệu<select value={level} onChange={e=>setLevel(e.target.value)}><option value="">Tất cả</option><option value="RED">Đỏ</option><option value="YELLOW">Vàng</option><option value="NORMAL">Xanh</option></select></label></div>
        <p className="dashboard-vital-count">Đang hiển thị {displayRows.length} dòng • Các số tổng hợp phía trên tính toàn bộ ngày trong phạm vi tài khoản. Cảnh báo sinh hiệu và trạng thái xử lý được hiển thị riêng.</p>
        <div className="dashboard-vital-table-wrap"><table className="dashboard-vital-table"><thead><tr><th>NCT / vị trí</th><th>Thời điểm / người ghi</th>{vitalColumns.map(([key,label,unit])=><th key={key}>{label}<small>{unit}</small></th>)}<th>Cảnh báo / xử lý</th><th>Chi tiết</th></tr></thead><tbody>{displayRows.map(x=><tr key={x.id}><td><b>{x.residentName||'NCT'}</b><small>{x.branchName}</small><small>{[x.areaName,x.roomName,x.bedName].filter(Boolean).join(' • ')||'—'}</small></td><td>{measuredAt(x.occurredAt)}<small>{x.createdByName||'—'}</small></td><VitalCells row={x}/><td><span className={`dashboard-vital-level ${x.vitals?.alertLevel||'NORMAL'}`}>{levelLabel[x.vitals?.alertLevel]||'Xanh'}</span><small>{x.attentionLevel?(x.attentionStatus==='RESOLVED'?'Đã xử lý':'Chưa xử lý'):'—'}</small></td><td><details><summary>Nội dung</summary>{(x.vitals?.alerts||[]).length>0&&<p><b>Cảnh báo:</b> {x.vitals.alerts.map(a=>a.message).join(' • ')}</p>}<p><b>Ghi nhận:</b> {x.content||'—'}</p><p><b>Xử lý:</b> {x.intervention||'—'}</p>{x.vitals?.urgent?.symptoms&&<p><b>Triệu chứng:</b> {x.vitals.urgent.symptoms}</p>}{x.requiresHandover&&<p><b>Ca sau:</b> {x.followUp||'Có yêu cầu bàn giao'}</p>}</details><Link to={`/shifts/${encodeURIComponent(x.shiftId)}?residentId=${encodeURIComponent(x.residentId)}`}>Xem ca</Link>{can('REPORT.VIEW')&&['ADMIN','BRANCH_DIRECTOR','CSKH'].includes(user.role)&&<Link to={`/reports/resident/${encodeURIComponent(x.residentId)}?from=${date}&to=${date}&branchId=${encodeURIComponent(x.branchId||'')}`}>Lịch sử NCT</Link>}</td></tr>)}{!displayRows.length&&<tr><td colSpan={11}><div className="empty compact">{d?.vitalReadings?.length?'Không có sinh hiệu phù hợp với bộ lọc.':'Chưa có sinh hiệu được ghi nhận trong ngày đã chọn.'}</div></td></tr>}</tbody></table></div>
      </div>
      <div className="dashboard-grid">
        <div className="panel"><div className="panel-title"><div><h2>Việc cần xử lý</h2><p>Cảnh báo chưa xử lý được giữ lại qua ngày/ca cho đến khi hoàn tất.</p></div>{can('REPORT.VIEW')&&<Link to="/reports">Báo cáo quản trị →</Link>}</div>
          <div className="alert-list">{(d?.alerts||[]).map(x=><div className={`alert-row clinical-${x.level}`} key={x.id}><Link className="alert-row-link" to={`/shifts/${x.shiftId}?focusAlert=${encodeURIComponent(x.id)}&residentId=${encodeURIComponent(x.residentId)}`}><div className={`attention-dot ${x.level}`}>{x.level==='RED'?'ĐỎ':'VÀNG'}</div><div><b>{x.residentName}</b><small>{x.areaName||'—'} • {x.roomName||'—'} • {x.bedName||'—'}</small><p>{x.latestContent}</p>{x.vitals&&<small className="dashboard-alert-vitals">{vitalText(x.vitals)}</small>}</div><div className="alert-meta"><span className={`attention-status ${x.level}`}>CẦN XỬ LÝ</span><small>{elapsed(x.latestAt)}</small></div></Link>{x.image&&<button type="button" className="alert-thumb-button" onClick={()=>setImagePreview({src:x.image,title:`Ảnh tổn thương da — ${x.residentName}`})}><img src={x.image} alt="Ảnh tổn thương"/><small>Xem ảnh</small></button>}</div>)}{!d?.alerts?.length&&<div className="empty compact success-empty">✓ Không còn cảnh báo Đỏ/Vàng chờ xử lý.</div>}</div>
        </div>
        <div className="panel"><h2>Tổng hợp ngày</h2><div className="bar-row"><span>Đã xử lý trong ngày</span><b>{d?.resolvedToday||0}</b></div><div className="bar-row"><span>Cần bàn giao phát sinh ngày</span><b>{d?.requiresHandover||0}</b></div><h2 className="mt">Biến động theo nhóm</h2>{Object.entries(d?.byCategory||{}).map(([k,v])=><div className="bar-row" key={k}><span>{catLabel[k]||k}</span><b>{v}</b></div>)}{!Object.keys(d?.byCategory||{}).length&&<div className="empty compact">Chưa có ghi nhận.</div>}<h2 className="mt">Tình trạng ca theo lịch</h2>{(d?.shiftStatus||[]).map(x=><div className="bar-row" key={x.status}><span>{statusLabel[x.status]||x.status}</span><b>{x.count}</b></div>)}</div>
      </div>
    </>}
    {imagePreview&&<div className="modal" onClick={()=>setImagePreview(null)}><div className="modal-card image-preview-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>{imagePreview.title}</h2><button className="secondary" onClick={()=>setImagePreview(null)}>Đóng</button></div><img src={imagePreview.src} alt={imagePreview.title}/></div></div>}
  </section>;
}
