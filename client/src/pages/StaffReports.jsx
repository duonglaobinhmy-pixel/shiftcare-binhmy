import { useEffect,useMemo,useState } from 'react';
import { Link,useSearchParams } from 'react-router-dom';
import { api } from '../services/api';

const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date());
const shiftLabel=t=>t==='MORNING'?'Ca sáng':t==='NIGHT'?'Ca tối':t||'Ca';
function formatDate(v){if(!v)return'—';return new Date(`${v}T00:00:00`).toLocaleDateString('vi-VN')}

export default function StaffReports(){
  const [searchParams]=useSearchParams();
  const initial=today();
  const [from,setFrom]=useState(searchParams.get('from')||initial),[to,setTo]=useState(searchParams.get('to')||initial);
  const [staffD,setStaffD]=useState(null),[branches,setBranches]=useState([]),[branchId,setBranchId]=useState(searchParams.get('branchId')||'');
  const [staffId,setStaffId]=useState(searchParams.get('staffId')||''),[err,setErr]=useState(''),[loading,setLoading]=useState(true);
  const rangeLabel=from===to?formatDate(from):`${formatDate(from)} → ${formatDate(to)}`;

  async function load(){try{setLoading(true);setErr('');const r=await api.staffReports(from,to,branchId);setStaffD(r.data)}catch(e){setErr(e.message)}finally{setLoading(false)}}
  useEffect(()=>{load()},[from,to,branchId]);
  useEffect(()=>{api.branches().then(r=>setBranches(r.data||[])).catch(e=>setErr(e.message))},[]);

  const selectedStaff=useMemo(()=>(staffD?.staffDetails||[]).filter(x=>!staffId||String(x.id)===String(staffId)),[staffD,staffId]);
  const visibleCalendar=useMemo(()=>(staffD?.calendar||[]).filter(x=>!staffId||(x.staff||[]).some(p=>String(p.id)===String(staffId))),[staffD,staffId]);
  const totalShifts=visibleCalendar.length;
  const handedOver=visibleCalendar.filter(x=>x.handover).length;
  const totalStaff=new Set(visibleCalendar.flatMap(x=>(x.staff||[]).map(p=>p.id))).size;
  const totalChanges=staffId ? selectedStaff.reduce((s,x)=>s+(x.changeCount||0),0) : Number(staffD?.activityChanges||0);

  return <section>
    <header className="page-head report-page-head"><div><h1>Báo cáo ca nhân viên</h1><p>Báo cáo trách nhiệm theo ca chung: 2–3 nhân viên trong ca cùng chịu trách nhiệm các biến động của ca.</p></div><div className="actions report-top-actions"><button className="secondary" onClick={()=>window.print()}>In / PDF</button></div></header>
    <div className="report-period-panel"><div className="report-period-inputs"><label>Từ ngày<input type="date" value={from} onChange={e=>{setFrom(e.target.value);if(to<e.target.value)setTo(e.target.value)}}/></label><label>Đến ngày<input type="date" value={to} min={from} onChange={e=>setTo(e.target.value)}/></label><label>Cơ sở<select value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">Tất cả cơ sở</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Nhân viên<select value={staffId} onChange={e=>setStaffId(e.target.value)}><option value="">Tất cả nhân viên</option>{(staffD?.staffDetails||[]).map(x=><option key={x.id} value={x.id}>{x.employeeCode} — {x.fullName}</option>)}</select></label><div className="report-range-summary"><small>Khoảng báo cáo</small><b>{rangeLabel}</b></div></div></div>
    {err&&<div className="error">{err}</div>}
    {loading?<div className="page-loading"><div className="page-loading-card"><span className="loading-spinner"/><b>Đang tải báo cáo nhân viên...</b><small>Đang đối chiếu lịch ca, nhóm nhân sự và biến động thuộc từng ca.</small></div></div>:<>
      <div className="report-overview-title"><div><h2>Tổng quan</h2><p>{rangeLabel} · {branchId?(branches.find(b=>String(b.id)===String(branchId))?.name||'Cơ sở đã chọn'):'Tất cả cơ sở'}</p></div><Link className="secondary button-link" to={`/reports?branchId=${encodeURIComponent(branchId)}&from=${from}&to=${to}`}>← Báo cáo biến động</Link></div>
      <div className="stats report-kpis"><div className="stat"><b>{totalShifts}</b><span>Ca theo lịch</span></div><div className="stat"><b>{totalStaff}</b><span>Nhân viên có trực</span></div><div className="stat success-stat"><b>{handedOver}</b><span>Đã bàn giao</span></div><div className="stat"><b>{Math.max(totalShifts-handedOver,0)}</b><span>Chưa bàn giao</span></div><div className="stat"><b>{totalChanges}</b><span>Ghi nhận phát sinh</span></div></div>

      <div className="panel staff-report-panel"><div className="panel-title"><div><h2>Bản đồ lịch ca</h2><p>Chỉ dựa vào ngày của ca. Mỗi thẻ ca hiển thị đầy đủ nhóm 2–3 nhân viên và người ghi chính.</p></div><span className="status-summary">{visibleCalendar.length} ca</span></div><div className="shift-calendar"><div className="shift-calendar-grid">{visibleCalendar.map(x=><Link className="shift-calendar-card" to={`/shifts/${x.id}`} key={x.id}><b>{formatDate(x.shiftDate)} · {shiftLabel(x.shiftType)}</b><span>{x.branchName}</span><small>{x.areaName}</small><div className="staff-chip-list">{(x.staff||[]).map(p=><span key={p.id}>{p.fullName} <small>#{p.employeeCode}</small>{p.isPrimary?' · Ghi chính':''}</span>)}</div><em>{x.handover?'Đã bàn giao':'Chưa bàn giao'}</em></Link>)}</div>{!visibleCalendar.length&&<div className="empty compact">Không có ca theo lịch trong bộ lọc này.</div>}</div></div>

      <div className="panel staff-report-panel"><div className="panel-title"><div><h2>Tra cứu theo nhân viên</h2><p>Số ghi nhận của mỗi nhân viên là số biến động thuộc các ca mà nhân viên đó tham gia; không suy đoán ai trực tiếp bấm nút Lưu trên iPad dùng chung.</p></div><span className="status-summary">{selectedStaff.length} nhân viên</span></div>
        <div className="staff-report-list">{selectedStaff.map(x=><div className="staff-report-card" key={x.id}><div className="staff-report-summary"><div><b>{x.fullName}</b><small>Mã nhân viên: {x.employeeCode||'—'} · {x.branchName||'—'}</small></div><div className="staff-summary-chips"><span>{x.shiftCount||0} ca</span><span>{x.primaryCount||0} ca ghi chính</span><span>{x.changeCount||0} ghi nhận</span>{x.redCount>0&&<span className="chip-red">{x.redCount} đỏ</span>}{x.openCount>0&&<span className="chip-yellow">{x.openCount} chưa xử lý</span>}</div></div>
          {(x.shifts||[]).length?<div className="table-wrap flat"><table><thead><tr><th>Ngày</th><th>Ca</th><th>Cơ sở / khu</th><th>Nhóm cùng trực</th><th>Bàn giao</th><th>Chi tiết</th></tr></thead><tbody>{x.shifts.map(s=><tr key={s.id}><td>{formatDate(s.shiftDate)}</td><td>{shiftLabel(s.shiftType)}</td><td>{s.branchName}<small>{s.areaName}</small></td><td><div className="staff-chip-list">{(s.staff||[]).map(p=><span key={p.id}>{p.fullName} <small>#{p.employeeCode}</small></span>)}</div></td><td>{s.handover?'Đã bàn giao':'Chưa bàn giao'}</td><td><Link to={`/shifts/${s.id}`}>Mở ca →</Link></td></tr>)}</tbody></table></div>:<div className="activity-only-note">Nhân viên không có ca mang ngày nằm trong bộ lọc này.</div>}
        </div>)}{!selectedStaff.length&&<div className="empty compact">Không có nhân viên hoặc ghi nhận phù hợp.</div>}</div>
      </div>
    </>}
  </section>;
}
