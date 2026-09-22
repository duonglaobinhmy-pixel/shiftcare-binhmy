import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const labels={roster:'NCT trong ca',residents:'NCT có biến động',entries:'Lượt ghi nhận',red:'Đỏ chưa xử lý',yellow:'Vàng chưa xử lý',handover:'Cần bàn giao'};
export default function ShiftRecords(){
  const {id,filter}=useParams();
  const {can}=useAuth();
  const [data,setData]=useState(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;api.shift(id).then(r=>active&&setData(r.data)).catch(e=>active&&setError(e.message));return()=>{active=false}},[id]);
  const rows=useMemo(()=>{
    const changes=data?.changes||[];
    if(filter==='red'||filter==='yellow')return changes.filter(x=>x.attentionLevel===(filter==='red'?'RED':'YELLOW')&&x.attentionStatus==='OPEN');
    if(filter==='handover')return changes.filter(x=>x.requiresHandover);
    return changes;
  },[data,filter]);
  const residents=useMemo(()=>{
    const all=data?.residents||[];
    if(filter==='residents')return all.filter(r=>(data?.changes||[]).some(x=>String(x.residentId)===String(r.residentId)));
    return all;
  },[data,filter]);
  return <section className="shift-records-page">
    <header className="page-head"><div><Link className="report-back-link" to={`/shifts/${id}`}>← Quay về ca trực</Link><h1>{labels[filter]||'Ghi nhận trong ca'}</h1><p>{data?.shift?.branchName||''} · {data?.shift?.shiftDate||''}</p></div></header>
    {error&&<div className="error">{error}</div>}
    {!data&&!error&&<div className="page-loading">Đang tải ghi nhận…</div>}
    {data&&(['roster','residents'].includes(filter)?<div className="cards">{residents.map(r=>{
      const count=(data.changes||[]).filter(x=>String(x.residentId)===String(r.residentId)).length;
      return <div key={r.id||r.residentId} className="log-card"><div><b>{r.fullName}</b><p>{r.areaName} · {r.roomName} · {r.bedName}</p><small>{count} lượt ghi nhận</small></div><Link to={`/shifts/${id}/entry/${encodeURIComponent(r.residentId)}?mode=quick`}>Xem / ghi nhận →</Link></div>})}</div>:<div className="cards">{rows.map(x=><article className="log-card" key={x.id}><div><b>{x.residentName}</b><small> · {new Date(x.occurredAt||x.createdAt).toLocaleString('vi-VN')}</small><p>{x.content||'Chưa nhập nội dung'}</p><small>{(x.categoryCodes||[x.category]).join(', ')} · {x.residentStatus||'IN_FACILITY'}</small>{x.requiresHandover&&<p>Ca sau: {x.followUp}</p>}</div><div className="shift-record-actions"><Link to={`/shifts/${id}/entry/${encodeURIComponent(x.residentId)}?mode=quick`}>Xem NCT →</Link>{can('CARE.UPDATE')&&data.shift?.status==='OPEN'&&<Link className="button-link secondary" to={`/shifts/${id}/entry/${encodeURIComponent(x.residentId)}?mode=full&edit=${encodeURIComponent(x.id)}&returnTo=${encodeURIComponent(filter)}`}>Sửa ghi nhận</Link>}</div></article>)}</div>)}
    {data&&(['roster','residents'].includes(filter)?!residents.length:!rows.length)&&<div className="empty compact">Không có ghi nhận phù hợp.</div>}
  </section>;
}
