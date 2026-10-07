import {useEffect,useRef,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {api} from '../services/api';
import {newestFirst,downloadDetailCsv} from '../utils/report-export';
import '../styles/operations.css';
import '../styles/shift-report.css';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shiftLabel=t=>({MORNING:'Ca sáng',AFTERNOON:'Ca chiều',NIGHT:'Ca tối'}[t]||t);
const statusLabel=s=>({OPEN:'Đang mở',HANDOVER_CONFIRMED:'Đã ký bàn giao',RECEIVED:'Đã nhận bàn giao',CLOSED:'Đã đóng'}[s]||s);
const time=v=>v&&!Number.isNaN(Date.parse(v))?new Date(v).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'—';
const clock=v=>v&&!Number.isNaN(Date.parse(v))?new Date(v).toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit'}):'—';
const categories={HEALTH:'Sức khỏe',NUTRITION:'Dinh dưỡng',INCIDENT:'Sự cố',PSYCHOLOGY:'Tâm lý',SKIN:'Ngoài da',OTHER:'Khác'};
const bowel={NORMAL:'Bình thường',CONSTIPATION:'Táo bón',DIARRHEA:'Tiêu chảy',OTHER:'Khác'};
const urine={NORMAL:'Bình thường',SONDE:'Qua sonde',CATHETER:'Qua ống tiểu',DIAPER:'Qua tã',OTHER:'Khác',LOW:'Tiểu ít',NONE:'Không tiểu'};
const vitalFields=[['pulse','Mạch','lần/phút'],['temperature','Nhiệt độ','°C'],['bpSys','HA tâm thu','mmHg'],['bpDia','HA tâm trương','mmHg'],['spo2','SpO₂','%'],['respiratoryRate','Nhịp thở','lần/phút'],['bloodGlucose','Đường huyết','mg/dL']];
const pending=r=>r.requiresHandover||r.attentionLevel&&r.attentionStatus==='OPEN';
const tone=r=>r.attentionStatus==='RESOLVED'?'done':r.attentionLevel==='RED'?'red':r.attentionLevel==='YELLOW'?'amber':'neutral';
const attention=r=>r.attentionStatus==='RESOLVED'?'Đã xử lý':r.attentionLevel==='RED'?'Đỏ · chưa xử lý':r.attentionLevel==='YELLOW'?'Vàng · chưa xử lý':r.requiresHandover?'Cần bàn giao':'Ghi nhận';
function Empty({title,children}){return <div className="sr-empty"><span aria-hidden="true">○</span><b>{title}</b><p>{children}</p></div>}
function Record({row:r,onHistory}){return <article className={`sr-record sr-${tone(r)}`}>
 <div className="sr-record-head"><div><span className="sr-time">{clock(r.occurredAt||r.createdAt)}</span><h3>{onHistory?<button className="sr-resident-link" onClick={()=>onHistory(r)}>{r.residentName||'NCT'} · Xem lịch sử →</button>:r.residentName||'NCT'}</h3><small>{[r.areaName,r.roomName,r.bedName].filter(Boolean).join(' · ')||'Chưa ghi vị trí'} · {time(r.occurredAt||r.createdAt)}</small></div><span className={`sr-badge sr-${tone(r)}`}>{attention(r)}</span></div>
 <div className="sr-tags">{(r.categoryCodes||[r.category]).filter(Boolean).map(c=><span key={c}>{categories[c]||c}</span>)}</div>
 <div className="sr-record-flow"><div><span className="sr-step">01 · Ghi nhận</span><p>{r.content||'Chưa ghi nội dung diễn biến.'}</p></div><div><span className="sr-step">02 · Đã xử lý</span><p>{r.intervention||'Chưa ghi hành động xử lý.'}</p>{r.notifiedTo&&<small>Đã báo: {r.notifiedTo}</small>}</div><div><span className="sr-step">03 · Kết quả / theo dõi tiếp</span><p>{r.resolutionNote||'Chưa ghi kết quả xử lý.'}</p>{r.attentionStatus==='RESOLVED'&&<small>Xác nhận: {r.resolvedByName||'—'} · {time(r.resolvedAt||r.attentionResolvedAt)}</small>}{r.requiresHandover&&<div className="sr-next"><b>Ca sau cần theo dõi</b><p>{r.followUp||'Có yêu cầu bàn giao, chưa ghi hướng dẫn cụ thể.'}</p></div>}</div></div>
 {r.vitals&&<div className="sr-vitals">{vitalFields.filter(([k])=>r.vitals[k]!=null&&r.vitals[k]!=='').map(([k,n,u])=><span key={k}><small>{n}</small><b>{r.vitals[k]} <em>{u}</em></b></span>)}</div>}
 {r.insulin?.given&&<p className="sr-insulin">Insulin: {r.insulin.dose} {r.insulin.unit||'IU'}</p>}
 <footer>Người ghi: <b>{r.createdByName||'—'}</b>{r.updatedByName&&<> · Cập nhật: {r.updatedByName} · {time(r.updatedAt)}</>}</footer>
 {r.woundImages?.length>0&&<div className="wound-image-grid saved">{r.woundImages.map((i,index)=>(i.dataUrl||i.url)&&<a key={i.id||index} href={i.dataUrl||i.url} target="_blank" rel="noreferrer"><img src={i.dataUrl||i.url} alt={`Ảnh tổn thương ${r.residentName}`}/></a>)}</div>}
 </article>}
export default function ShiftHistory(){
 const {id}=useParams();
 const [history,setHistory]=useState(null);
 const historyRequest=useRef(0),dialogRef=useRef(null),closeRef=useRef(null);
 function closeHistory(){historyRequest.current++;setHistory(null)}
 async function openHistory(row){
  const request=++historyRequest.current;
  setHistory({name:row.residentName,loading:true});
  try{const r=await api.residentShiftHistory(view?.shift.id||id,row.residentId);if(request===historyRequest.current)setHistory({name:row.residentName,data:r.data,loading:false})}
  catch(e){if(request===historyRequest.current)setHistory({name:row.residentName,error:e.message,loading:false})}
 }
 // The app scrolls inside .app-content-scroll, so locking only body is insufficient.
 const historyOpen=!!history;
 useEffect(()=>{
  if(!historyOpen)return;
  const focused=document.activeElement;
  const surfaces=[document.documentElement,document.body,...document.querySelectorAll('.app-content-scroll')];
  const saved=surfaces.map(el=>({el,value:el.style.getPropertyValue('overflow-y'),priority:el.style.getPropertyPriority('overflow-y')}));
  surfaces.forEach(el=>el.style.setProperty('overflow-y','hidden','important'));
  closeRef.current?.focus({preventScroll:true});
  function keydown(e){
   if(e.key==='Escape'){e.preventDefault();closeHistory();return}
   if(e.key!=='Tab')return;
   const nodes=[...(dialogRef.current?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')||[])].filter(el=>el.getClientRects().length);
   const first=nodes[0],last=nodes[nodes.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
  }
  document.addEventListener('keydown',keydown);
  return()=>{saved.forEach(({el,value,priority})=>value?el.style.setProperty('overflow-y',value,priority):el.style.removeProperty('overflow-y'));document.removeEventListener('keydown',keydown);if(focused?.isConnected)focused.focus({preventScroll:true})};
 },[historyOpen]);
 useEffect(()=>{historyRequest.current++;setHistory(null)},[id]);

 const [draft,setDraft]=useState({from:today(),to:today(),shiftType:''}),[filter,setFilter]=useState({from:today(),to:today(),shiftType:''}),[rows,setRows]=useState([]),[report,setReport]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0),[resident,setResident]=useState(''),[mode,setMode]=useState('all'),[source,setSource]=useState('current');
 useEffect(()=>{let active=true;setLoading(true);setError('');setReport(null);setRows([]);setResident('');setMode('all');setSource('current');(id?api.shiftHistoryDetail(id):api.shiftHistory(filter)).then(r=>{if(active){id?setReport(r.data):setRows(r.data||[]);setLoading(false)}}).catch(e=>{if(active){setError(e.message);setLoading(false)}});return()=>{active=false}},[id,filter,refresh]);
 const previous=report?.previousShift,view=source==='previous'?previous:report;
 const allChanges=view?.changes||[],changes=allChanges.filter(r=>(!resident||String(r.residentId)===resident)&&(mode==='all'||mode==='followup'&&r.requiresHandover||mode==='open'&&r.attentionLevel&&r.attentionStatus==='OPEN'||mode==='red'&&r.attentionLevel==='RED'&&r.attentionStatus==='OPEN'||mode==='yellow'&&r.attentionLevel==='YELLOW'&&r.attentionStatus==='OPEN'||mode==='resolved'&&r.attentionStatus==='RESOLVED')).sort(newestFirst);
 const toilets=(view?.toileting||[]).filter(r=>!resident||String(r.residentId)===resident).sort(newestFirst);
 const residentOptions=[...new Map([...(view?.residents||[]).map(r=>[String(r.residentId),r.fullName]),...allChanges.map(r=>[String(r.residentId),r.residentName]),...(view?.toileting||[]).map(r=>[String(r.residentId),r.residentName])]).entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1]),'vi'));
 const carry=(previous?.changes||[]).filter(pending).sort(newestFirst);
 function dayOffset(n){const d=new Date(`${today()}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+n);const value=d.toISOString().slice(0,10),next={...draft,from:value,to:value};setDraft(next);setFilter(next)}
 function selectSource(next){setSource(next);setResident('');setMode('all')}
 const summary=view?.summary||{},total=summary.rosterResidents||0,recorded=summary.residentsWithActivity||0,coverage=total?Math.min(100,Math.round(recorded*100/total)):0;
 return <section className="op-page sr-page">
 <header className="sr-hero"><div><span className="sr-eyebrow">SỔ BÀN GIAO · BÌNH MỸ CARE</span><h1>{report?`${shiftLabel(report.shift.shiftType)} · ${report.shift.shiftDate}`:'Báo cáo & bàn giao ca'}</h1><p>{report?`${report.shift.branchName} · ${report.shift.areaName||'Toàn cơ sở'}`:'Xem diễn biến, hành động xử lý và việc cần theo dõi của từng ca.'}</p>{report&&<span className="sr-hero-status">{statusLabel(report.shift.status)}{report.shift.status==='OPEN'?' · dữ liệu đang cập nhật':''}</span>}</div><div className="actions">{id&&<Link className="button-link secondary" to="/shift-history">← Chọn ca khác</Link>}<Link className="button-link secondary" to="/shifts/current">Về ca chăm sóc</Link><button className="secondary" disabled={loading} onClick={()=>setRefresh(v=>v+1)}>↻ Tải lại</button></div></header>
 {!id&&<form className="sr-panel op-filter" onSubmit={e=>{e.preventDefault();setFilter({...draft})}}><label>Từ ngày<input type="date" required value={draft.from} onChange={e=>setDraft(v=>({...v,from:e.target.value}))}/></label><label>Đến ngày<input type="date" required value={draft.to} onChange={e=>setDraft(v=>({...v,to:e.target.value}))}/></label><label>Ca<select value={draft.shiftType} onChange={e=>setDraft(v=>({...v,shiftType:e.target.value}))}><option value="">Tất cả ca</option><option value="MORNING">Ca sáng</option><option value="NIGHT">Ca tối</option><option value="AFTERNOON">Ca chiều (cũ)</option></select></label><button>Áp dụng</button><button type="button" className="secondary" onClick={()=>dayOffset(0)}>Hôm nay</button><button type="button" className="secondary" onClick={()=>dayOffset(-1)}>Hôm qua</button></form>}
 {error&&<p className="error" role="alert">{error}</p>}{loading&&<div className="sr-panel" role="status">Đang tải báo cáo ca…</div>}
 {!id&&!loading&&!error&&<><div className="sr-section-head"><h2>Các ca trong khoảng đã chọn</h2><span>{rows.length} ca</span></div><div className="sr-shift-grid">{rows.map(s=><article className="sr-panel sr-shift-card" key={s.id}><div className="sr-section-head"><h2>{shiftLabel(s.shiftType)}</h2><span className="sr-badge sr-neutral">{statusLabel(s.status)}</span></div><b className="sr-shift-date">{s.shiftDate}</b><p>{s.branchName} · {s.areaName||'Toàn cơ sở'}</p><div className="sr-mini-stats"><span><b>{s.summary.records}</b>ghi nhận</span><span className="sr-danger-text"><b>{s.summary.openRed+s.summary.openYellow}</b>chưa xử lý</span><span><b>{s.summary.requiresHandover}</b>cần bàn giao</span></div><Link className="button-link" to={`/shift-history/${encodeURIComponent(s.id)}`}>Xem diễn biến & kết quả →</Link></article>)}</div>{!rows.length&&<Empty title="Chưa có ca phù hợp">Chọn khoảng ngày khác để xem báo cáo.</Empty>}</>}
 {report&&<>
 <div className="sr-section-head sr-source"><div className="sr-tabs" role="group" aria-label="Nguồn dữ liệu ca"><button aria-pressed={source==='current'} className={source==='current'?'selected':''} onClick={()=>selectSource('current')}>Ca đang xem</button><button disabled={!previous} aria-pressed={source==='previous'} className={source==='previous'?'selected':''} onClick={()=>selectSource('previous')}>Ca trước {previous?`· ${shiftLabel(previous.shift.shiftType)} ${previous.shift.shiftDate}`:''}</button></div><div className="sr-export-actions"><button className="secondary" onClick={()=>downloadDetailCsv(`bao-cao-ca-${view.shift.shiftDate}-${view.shift.shiftType}.csv`,allChanges,view.toileting||[],[view.shift])}>CSV toàn bộ ca</button><button className="secondary" onClick={()=>downloadDetailCsv(`bao-cao-ca-da-loc-${view.shift.shiftDate}.csv`,changes,toilets,[view.shift])}>CSV theo bộ lọc</button></div></div>
 {view&&<>
 <div className="sr-section-head"><div><h2>{source==='previous'?'Tổng quan ca trước':'Tổng quan ca đang xem'}</h2><p>{source==='previous'?`${view.shift.branchName} · ${shiftLabel(view.shift.shiftType)} ${view.shift.shiftDate}`:'Nhấn vào chỉ số để lọc diễn biến bên dưới.'}</p></div><span className="sr-badge sr-neutral">{statusLabel(view.shift.status)}</span></div>
 <div className="sr-kpis">{[['NCT trong danh sách',total,'neutral','all','Theo danh sách ca'],['NCT có ghi nhận',recorded,'green','all',`${summary.records||0} lượt ghi nhận`],['Đỏ chưa xử lý',summary.openRed||0,'red','red','Cần kiểm tra ngay'],['Vàng chưa xử lý',summary.openYellow||0,'amber','yellow','Cần theo dõi'],['Đã xử lý cảnh báo',summary.resolvedAlerts||0,'green','resolved','Có xác nhận xử lý'],['Cần bàn giao',summary.requiresHandover||0,'blue','followup','Ghi nhận cần theo dõi tiếp']].map(([name,value,color,tab,help])=><button className={`sr-kpi sr-${color}`} key={name} onClick={()=>{setMode(tab);document.getElementById('sr-records')?.scrollIntoView({behavior:'smooth',block:'start'})}}><span>{name}</span><strong>{value}</strong><small>{help}</small></button>)}</div>
 <div className="sr-panel sr-coverage"><div><b>{recorded}/{total} NCT có ghi nhận diễn biến</b><small>Phản ánh dữ liệu đã nhập; không phải tỷ lệ hoàn tất chăm sóc.</small></div><div className="sr-progress" role="progressbar" aria-label="Tỷ lệ NCT có ghi nhận diễn biến" aria-valuenow={coverage} aria-valuemin={0} aria-valuemax={100}><i style={{width:`${coverage}%`}}/></div><strong>{coverage}%</strong></div>
 </>}
 <div className="sr-overview-grid"><section className="sr-panel"><div className="sr-section-head"><div><span className="sr-eyebrow">TIẾP NỐI GIỮA HAI CA</span><h2>Ca trước để lại việc gì?</h2></div><span className="sr-badge sr-amber">{carry.length} ghi nhận</span></div>
 {previous?<><p className="sr-muted">{shiftLabel(previous.shift.shiftType)} · {previous.shift.shiftDate} · {previous.shift.areaName||'Toàn cơ sở'}</p>{previous.handover?.summaryNote&&<div className="sr-handover-note"><b>Ghi chú bàn giao</b><p>{previous.handover.summaryNote}</p></div>}{carry.length?<div className="sr-carry-list">{carry.map(r=>{const currentRecords=(report.changes||[]).filter(x=>String(x.residentId)===String(r.residentId));return <article key={r.id} className={`sr-carry sr-${tone(r)}`}><div className="sr-section-head"><b>{r.residentName||'NCT'}</b><span className={`sr-badge sr-${tone(r)}`}>{attention(r)}</span></div><p>{r.content||'Chưa ghi diễn biến'}</p><small><b>Đã xử lý:</b> {r.intervention||'Chưa ghi'}</small><div className="sr-next"><b>Theo dõi tiếp:</b> {r.followUp||'Chưa ghi hướng dẫn cụ thể; cần kiểm tra cảnh báo / nội dung bàn giao.'}</div><small>{currentRecords.length?`Ca đang xem có ${currentRecords.length} ghi nhận cho NCT này. Chưa đủ để kết luận việc cũ đã hoàn tất.`:'Ca đang xem chưa có ghi nhận diễn biến cho NCT này.'}</small><button className="secondary" onClick={()=>{selectSource('current');setResident(String(r.residentId));document.getElementById('sr-records')?.scrollIntoView({behavior:'smooth'})}}>Xem ghi nhận ca đang xem →</button></article>})}</div>:<Empty title="Chưa có việc cần tiếp nối trong dữ liệu">Ca trước chưa có ghi nhận yêu cầu bàn giao hoặc cảnh báo đang mở.</Empty>}<Link className="button-link" to={`/shift-history/${encodeURIComponent(previous.shift.id)}`}>Mở toàn bộ báo cáo ca trước →</Link></>:<Empty title="Chưa tìm thấy ca trước cùng phạm vi">Chưa có ca sớm hơn khớp cơ sở: {report.shift.branchName||report.shift.branchId}, khu: {report.shift.areaName||report.shift.areaId||'Toàn cơ sở'}, phòng: {report.shift.roomName||report.shift.roomId||'Tất cả phòng'}. Ca khác khu/phòng không được tự ghép vào báo cáo này.</Empty>}
 </section><section className="sr-panel"><span className="sr-eyebrow">BÀN GIAO & KẾT QUẢ</span><h2>Ca trước → ca đang xem</h2><div className="sr-comparison"><div className="sr-comparison-row sr-comparison-head"><span>Chỉ số (ghi nhận)</span><b>Ca trước</b><b>Ca đang xem</b></div>{[['Lượt ghi nhận','records'],['Đỏ chưa xử lý','openRed'],['Vàng chưa xử lý','openYellow'],['Cảnh báo đã xử lý','resolvedAlerts'],['Cần bàn giao','requiresHandover']].map(([label,key])=><div className="sr-comparison-row" key={key}><span>{label}</span><b>{previous?previous.summary[key]??0:'—'}</b><b>{report.summary[key]??0}</b></div>)}</div><p className="sr-muted">Số liệu thuộc từng ca; không dùng chênh lệch để kết luận cảnh báo của ca trước đã xử lý.</p><h3>Nhân sự & xác nhận · {source==='previous'?'ca trước':'ca đang xem'}</h3><div className="sr-staff">{(view?.shift.assignedStaff||[]).map(s=><span key={s.id}><b>{s.fullName}</b><small>{s.employeeCode||s.username||'Nhân sự trực'}</small></span>)}</div>{!(view?.shift.assignedStaff||[]).length&&<p>{view?.shift.assignedStaffNames?.join(', ')||'Chưa có thông tin nhân sự'}</p>}<p><b>Người ghi chính:</b> {view?.shift.primaryRecorderName||view?.shift.assignedStaffName||'Chưa có thông tin'}</p><div className="sr-signatures"><div><span>Giao ca</span><b>{view?.handover?.confirmedByName||'Chưa ký giao'}</b><small>{time(view?.handover?.confirmedAt)}</small></div><div><span>Nhận ca</span><b>{view?.handover?.receivedByName||'Chưa xác nhận nhận'}</b><small>{time(view?.handover?.receivedAt)}</small></div></div><div className="sr-handover-note"><b>Nội dung bàn giao</b><p>{view?.handover?.summaryNote||'Chưa ghi nội dung bàn giao.'}</p></div></section></div>
 <section id="sr-records"><div className="sr-section-head"><div><span className="sr-eyebrow">DIỄN BIẾN CHI TIẾT</span><h2>NCT có gì → xử lý gì → kết quả ra sao?</h2></div><span>{changes.length}/{allChanges.length} ghi nhận · Mới nhất trước · {source==='previous'?'Ca trước':'Ca đang xem'}</span></div><div className="sr-panel op-filter"><label>NCT<select value={resident} onChange={e=>setResident(e.target.value)}><option value="">Tất cả NCT</option>{residentOptions.map(([key,name])=><option key={key} value={key}>{name||key}</option>)}</select></label><label>Nội dung<select value={mode} onChange={e=>setMode(e.target.value)}><option value="all">Tất cả ghi nhận</option><option value="open">Cảnh báo chưa xử lý</option><option value="red">Đỏ chưa xử lý</option><option value="yellow">Vàng chưa xử lý</option><option value="resolved">Cảnh báo đã xử lý</option><option value="followup">Cần bàn giao / theo dõi tiếp</option></select></label><button className="secondary" onClick={()=>{setResident('');setMode('all')}}>Xóa bộ lọc</button></div><div className="sr-timeline">{changes.map(r=><Record key={r.id} row={r} onHistory={openHistory}/>)}</div>{!changes.length&&<Empty title={allChanges.length?'Không có ghi nhận phù hợp bộ lọc':'Ca chưa có ghi nhận diễn biến'}>Chưa có dữ liệu để hiển thị diễn biến, xử lý và kết quả.</Empty>}</section>
 <section className="sr-panel sr-toilets"><div className="sr-section-head"><h2>Tiêu / tiểu trong ca</h2><span>{toilets.length} ghi nhận</span></div>{toilets.length?<div className="sr-toilet-grid">{toilets.map(r=><article key={r.id}><div className="sr-section-head"><b>{r.residentName}</b><small>{clock(r.createdAt)}</small></div><small>{[r.areaName,r.roomName,r.bedName].filter(Boolean).join(' · ')} · {time(r.createdAt)}</small><p><b>Tiêu:</b> {bowel[r.bowelStatus]||r.bowelStatus||'Chưa ghi'}<br/><b>Tiểu:</b> {urine[r.urineStatus]||r.urineStatus||'Chưa ghi'} {r.urineDetail}</p>{r.note&&<p>{r.note}</p>}<small>Người ghi: {r.createdByName||'—'}</small></article>)}</div>:<p className="sr-muted">Chưa có ghi nhận tiêu / tiểu phù hợp.</p>}</section>
 </>}
 {history&&<div className="modal sr-history-modal">
  <div ref={dialogRef} className="modal-card sr-history-card" role="dialog" aria-modal="true" aria-labelledby="sr-history-title">
   <header className="modal-head sr-history-head">
    <div className="sr-history-heading"><h2 id="sr-history-title">{history.name} · Toàn bộ lịch sử</h2><p>Tất cả ca đã lưu trong cơ sở này · Mới nhất trước</p></div>
    <div className="sr-export-actions">
     {history.data&&<button className="secondary" onClick={()=>downloadDetailCsv('lich-su-nct.csv',history.data.changes,history.data.toileting,history.data.shifts,{name:history.name})}>CSV toàn bộ lịch sử</button>}
     <button ref={closeRef} onClick={closeHistory}>Đóng</button>
    </div>
    {history.data&&<p className="sr-history-count">{history.data.changes.length} diễn biến · {history.data.toileting.length} ghi nhận tiêu / tiểu</p>}
   </header>
   <div className="modal-body sr-history-body" tabIndex={0} aria-label="Danh sách lịch sử ghi nhận" aria-busy={history.loading||false}>
    {history.loading&&<p role="status">Đang đọc lịch sử đã lưu…</p>}
    {history.error&&<p className="error" role="alert">{history.error}</p>}
    {history.data&&<>
     <div className="sr-timeline">
      {[...history.data.changes].sort(newestFirst).map(r=>{
       const shift=history.data.shifts.find(s=>String(s.id)===String(r.shiftId));
       return <div className="sr-history-entry" key={r.id}><div className="sr-history-shift">Ca: {shift?.shiftDate||'—'} · {shiftLabel(shift?.shiftType)||'—'}</div><Record row={r}/></div>
      })}
     </div>
     {!!history.data.toileting.length&&<section className="sr-history-toilets"><h3>Lịch sử tiêu / tiểu</h3>{[...history.data.toileting].sort(newestFirst).map(r=><article className="sr-record sr-history-toilet" key={r.id}><b>Tiêu / tiểu · {time(r.createdAt)}</b><p>Tiêu: {bowel[r.bowelStatus]||r.bowelStatus||'—'} · Tiểu: {urine[r.urineStatus]||r.urineStatus||'—'}</p><p>{[r.urineDetail,r.note].filter(Boolean).join(' · ')}</p><small>Người ghi: {r.createdByName||'—'}</small></article>)}</section>}
     {!history.data.changes.length&&!history.data.toileting.length&&<Empty title="Chưa có lịch sử ghi nhận">Không có dữ liệu đã lưu phù hợp.</Empty>}
    </>}
   </div>
  </div>
 </div>}

 </section>;
}
