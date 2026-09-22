import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../services/api';

export default function ShiftEntryPicker(){
  const {id}=useParams();
  const navigate=useNavigate();
  const [data,setData]=useState(null);
  const [query,setQuery]=useState('');
  const [error,setError]=useState('');

  useEffect(()=>{
    api.shift(id).then(result=>setData(result.data)).catch(err=>setError(err.message));
  },[id]);

  const residents=useMemo(()=>{
    const value=query.trim().toLocaleLowerCase('vi');
    if(!data)return [];
    if(!value)return data.residents||[];
    return (data.residents||[]).filter(row=>`${row.fullName||''} ${row.code||''} ${row.areaName||''} ${row.roomName||''} ${row.bedName||''}`.toLocaleLowerCase('vi').includes(value));
  },[data,query]);

  if(!data)return <section className="entry-picker-page"><Link className="button-link" to={`/shifts/${id}`}>← Quay về ca trực</Link>{error?<div className="error">{error}</div>:<div className="page-loading"><div className="page-loading-card"><span className="loading-spinner"/><b>Đang tải danh sách NCT…</b></div></div>}</section>;

  return <section className="entry-picker-page">
    <header className="page-head entry-picker-head">
      <div><Link className="report-back-link" to={`/shifts/${id}`}>← Quay về ca trực</Link><h1>Chọn NCT để ghi nhận</h1><p>{data.shift.branchName} • {data.shift.areaName||'Toàn cơ sở'} • {data.shift.shiftDate}</p></div>
    </header>
    <div className="entry-picker-search"><input autoFocus type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Tìm tên, mã NCT, phòng hoặc giường…"/><b>{residents.length} NCT</b></div>
    <div className="entry-picker-grid">{residents.map(row=>{
      const count=(data.changes||[]).filter(item=>String(item.residentId)===String(row.residentId)).length;
      return <button type="button" className="entry-picker-card" key={row.id||row.residentId} onClick={()=>navigate(`/shifts/${id}/entry/${encodeURIComponent(row.residentId)}?mode=quick`)}>
        <span className="avatar">{row.image?<img src={row.image} alt=""/>:row.fullName?.slice(0,1)}</span>
        <span><b>{row.fullName}</b><small>{row.code||'Chưa có mã'} • {row.areaName} • {row.roomName} • {row.bedName}</small></span>
        <span className="entry-picker-count">{count} lượt<br/><strong>Ghi nhận →</strong></span>
      </button>;
    })}</div>
    {!residents.length&&<div className="empty compact">Không tìm thấy NCT phù hợp.</div>}
  </section>;
}
