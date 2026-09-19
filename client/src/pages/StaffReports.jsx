import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';

const today=()=>new Date().toLocaleDateString('en-CA');
const shiftLabel=t=>t==='MORNING'?'Ca sáng':t==='AFTERNOON'?'Ca chiều':'Ca tối';
const shiftStatus={OPEN:'Đang mở',HANDOVER_CONFIRMED:'Đã giao ca',RECEIVED:'Đã nhận ca',CLOSED:'Đã đóng'};
function formatDate(v){if(!v)return'—';return new Date(`${v}T00:00:00`).toLocaleDateString('vi-VN')}

export default function StaffReports(){
  const [searchParams]=useSearchParams();
  const initial=today();
  const [from,setFrom]=useState(searchParams.get('from')||initial),[to,setTo]=useState(searchParams.get('to')||initial);
  const [staffD,setStaffD]=useState(null),[branches,setBranches]=useState([]),[branchId,setBranchId]=useState(searchParams.get('branchId')||'');
  const [staffId,setStaffId]=useState(searchParams.get('staffId')||''),[err,setErr]=useState('');
  const rangeLabel=from===to?formatDate(from):`${formatDate(from)} → ${formatDate(to)}`;

  async function load(){try{setErr('');const r=await api.staffReports(from,to,branchId);setStaffD(r.data)}catch(e){setErr(e.message)}}
  useEffect(()=>{load()},[from,to,branchId]);
  useEffect(()=>{api.branches().then(r=>setBranches(r.data||[])).catch(e=>setErr(e.message))},[]);

  const selectedStaff=useMemo(()=>(staffD?.staffDetails||[]).filter(x=>!staffId||x.id===staffId),[staffD,staffId]);
  const visibleCalendar=useMemo(()=>(staffD?.calendar||[]).filter(x=>!staffId||x.staff.some(p=>p.id===staffId)),[staffD,staffId]);
  const totalShifts=visibleCalendar.length;
  const handedOver=visibleCalendar.filter(x=>x.handover).length;
  const totalStaff=new Set(visibleCalendar.flatMap(x=>(x.staff||[]).map(p=>p.id))).size;
  const totalChanges=selectedStaff.reduce((s,x)=>s+(x.changeCount||0),0);

  return <section>
    <header className="page-head report-page-head"><div><h1>Báo cáo ca nhân viên</h1><p>Tra cứu độc lập lịch trực, nhóm nhân sự trong ca, người ghi chính và số ghi nhận của từng nhân viên.</p></div><div className="actions report-top-actions"><button className="secondary" onClick={()=>window.print()}>In / PDF</button></div></header>

    <div className="report-period-panel"><div className="report-period-inputs"><label>Từ ngày<input type="date" value={from} onChange={e=>{setFrom(e.target.value);if(to<e.target.value)setTo(e.target.value)}}/></label><label>Đến ngày<input type="date" value={to} min={from} onChange={e=>setTo(e.target.value)}/></label><label>Cơ sở<select value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">Tất cả cơ sở</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Nhân viên<select value={staffId} onChange={e=>setStaffId(e.target.value)}><option value="">Tất cả nhân viên</option>{(staffD?.staffDetails||[]).map(x=><option key={x.id} value={x.id}>{x.employeeCode} — {x.fullName}</option>)}</select></label><div className="report-range-summary"><small>Khoảng báo cáo</small><b>{rangeLabel}</b></div></div></div>

    {err&&<div className="error">{err}</div>}
    <div className="report-overview-title"><div><h2>Tổng quan ca trực</h2><p>{rangeLabel} · {branchId?(branches.find(b=>b.id===branchId)?.name||'Cơ sở đã chọn'):'Tất cả cơ sở'}</p></div><Link className="secondary button-link" to={`/reports?branchId=${encodeURIComponent(branchId)}&from=${from}&to=${to}`}>← Báo cáo biến động</Link></div>

    <div className="stats report-kpis"><div className="stat"><b>{totalShifts}</b><span>Tổng ca</span></div><div className="stat"><b>{totalStaff}</b><span>Nhân viên có trực</span></div><div className="stat success-stat"><b>{handedOver}</b><span>Đã bàn giao</span></div><div className="stat"><b>{Math.max(totalShifts-handedOver,0)}</b><span>Chưa bàn giao</span></div><div className="stat"><b>{totalChanges}</b><span>Ghi nhận chăm sóc</span></div></div>

    <div className="panel staff-report-panel"><div className="panel-title"><div><h2>Bản đồ lịch ca</h2><p>Mỗi card là một ca. Hiển thị đầy đủ 2–3 nhân sự cùng trực để truy cứu trách nhiệm chung.</p></div><span className="status-summary">{visibleCalendar.length} ca</span></div><div className="shift-calendar"><div className="shift-calendar-grid">{visibleCalendar.map(x=><Link className="shift-calendar-card" to={`/shifts/${x.id}`} key={x.id}><b>{formatDate(x.shiftDate)} · {shiftLabel(x.shiftType)}</b><span>{x.branchName}</span><small>{x.areaName}</small><div className="staff-chip-list">{x.staff.map(p=><span key={p.id}>{p.fullName} <small>#{p.employeeCode}</small>{p.isPrimary?' · Ghi chính':''}</span>)}</div><em>{x.handover?'Đã bàn giao':'Chưa bàn giao'}</em></Link>)}</div>{!visibleCalendar.length&&<div className="empty compact">Chưa có ca tại bộ lọc này.</div>}</div></div>

    <div className="panel staff-report-panel"><div className="panel-title"><div><h2>Tra cứu theo nhân viên</h2><p>Biết chính xác nhân viên đã trực những ca nào, với ai, tại cơ sở/khu nào và có bao nhiêu ghi nhận.</p></div><span className="status-summary">{selectedStaff.length} nhân viên</span></div>{selectedStaff.map(x=><div className="staff-report-card" key={x.id}><div className="staff-report-summary"><div><b>{x.fullName}</b><small>Mã nhân viên: {x.employeeCode}</small></div><div className="staff-summary-chips"><span>{x.shiftCount} ca</span><span>{x.primaryCount} ca ghi chính</span><span>{x.changeCount} ghi nhận</span></div></div><div className="table-wrap flat"><table><thead><tr><th>Ngày</th><th>Ca</th><th>Cơ sở / khu</th><th>Nhóm cùng trực</th><th>Vai trò</th><th>Trạng thái</th><th>Chi tiết</th></tr></thead><tbody>{x.shifts.map(s=>{const me=(s.staff||[]).find(p=>p.id===x.id);return <tr key={s.id}><td>{formatDate(s.shiftDate)}</td><td>{shiftLabel(s.shiftType)}</td><td>{s.branchName}<small>{s.areaName}</small></td><td>{(s.staff||[]).map(p=>p.fullName).join(', ')}</td><td>{me?.isPrimary?'Người ghi chính':'Thành viên ca'}</td><td><span className={`badge ${s.status}`}>{shiftStatus[s.status]||s.status}</span></td><td><Link className="shift-open-link" to={`/shifts/${s.id}`}>Xem ca →</Link></td></tr>})}</tbody></table></div></div>)}{!selectedStaff.length&&<div className="empty compact">Không có nhân viên phù hợp.</div>}</div>
  </section>
}
