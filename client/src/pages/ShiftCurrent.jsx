import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const todayInVietnam=()=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

export default function ShiftCurrent(){
  const {user}=useAuth();
  const navigate=useNavigate();
  const [candidates,setCandidates]=useState(null);
  const [error,setError]=useState('');

  useEffect(()=>{
    let active=true;
    api.shifts().then(response=>{
      if(!active)return;
      const today=todayInVietnam();
      const open=(response.data||[]).filter(shift=>shift.status==='OPEN'&&shift.shiftDate===today);
      const assigned=open.filter(shift=>(shift.assignedStaff||[]).some(person=>
        (person.userId&&String(person.userId)===String(user?.sub||user?.id))||
        (person.employeeCode&&String(person.employeeCode)===String(user?.employeeCode))
      ));
      const list=['ADMIN','BRANCH_DIRECTOR'].includes(user?.role)?open:assigned;
      if(list.length===1)navigate(`/shifts/${encodeURIComponent(list[0].id)}`,{replace:true});
      else setCandidates(list);
    }).catch(e=>{if(active)setError(e.message)});
    return()=>{active=false};
  },[navigate,user?.sub,user?.id,user?.employeeCode,user?.role]);

  if(error)return <section className="card"><h1>Ca chăm sóc</h1><p className="error">{error}</p><Link to="/shifts">Xem danh sách ca</Link></section>;
  if(candidates===null)return <section className="card">Đang tìm ca đang mở…</section>;
  return <section className="card"><h1>Ca chăm sóc</h1>
    {!candidates.length?<p>Hôm nay chưa có ca đang mở phù hợp. <Link to="/shifts">Xem danh sách hoặc tạo ca</Link>.</p>:<>
      <p>Có nhiều ca đang mở; chọn đúng ca để ghi nhận:</p>
      <div className="cards">{candidates.map(shift=><Link key={shift.id} to={`/shifts/${encodeURIComponent(shift.id)}`} className="log-card"><b>{shift.shiftType==='MORNING'?'Ca sáng':'Ca tối'} · {shift.branchName}</b><small>{shift.areaName||'Toàn cơ sở'} · {shift.assignedStaffNames?.join(', ')||''}</small></Link>)}</div>
    </>}
  </section>;
}
