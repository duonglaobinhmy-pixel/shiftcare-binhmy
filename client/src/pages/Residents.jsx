import { useEffect,useMemo,useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function Residents(){
  const {user,can}=useAuth(); const navigate=useNavigate();
  const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(20),[branchId,setBranchId]=useState(user.branchId||''),[areaId,setAreaId]=useState(user.areaId||''),[roomId,setRoomId]=useState(''),[q,setQ]=useState('');
  const [branches,setBranches]=useState([]),[locations,setLocations]=useState({areas:[],rooms:[]}),[data,setData]=useState({items:[],totalItem:0,totalPage:1}),[loading,setLoading]=useState(false),[err,setErr]=useState(''),[opening,setOpening]=useState('');
  const canWrite=can('CARE.CREATE');
  async function loadResidents(next=page){setLoading(true);setErr('');try{const r=await api.residents({pageIndex:next,pageSize,branchId,areaId,roomId,query:q,religionId:'',status:1});setData(r.data);setPage(next)}catch(e){setErr(e.message)}finally{setLoading(false)}}
  async function loadLocations(id){if(!id){setLocations({areas:[],rooms:[]});return}try{setLocations((await api.locations(id)).data)}catch(e){setErr(e.message)}}
  useEffect(()=>{api.branches().then(r=>setBranches(r.data||[])).catch(()=>{});loadResidents(1);if(branchId)loadLocations(branchId)},[]);
  useEffect(()=>{if(branchId)loadLocations(branchId)},[branchId]);
  const rooms=useMemo(()=>locations.rooms.filter(r=>!areaId||r.areaId===areaId),[locations,areaId]);
  const items=data.items||[];
  async function openResident(x){setOpening(x.id);setErr('');try{
    if(!canWrite){const r=await api.activeShiftForResident(x.id);if(r.data)navigate(`/shifts/${r.data.id}?residentId=${encodeURIComponent(x.id)}`);else setErr(`${x.fullName} hiện chưa nằm trong ca nào của ShiftCare.`);return}
    const r=await api.ensureShiftForResident(x); navigate(`/shifts/${r.data.id}?residentId=${encodeURIComponent(x.id)}&mode=change&quick=1`)
  }catch(e){setErr(e.message)}finally{setOpening('')}}
  return <section>
    <header className="page-head"><div><h1>{canWrite?'Nhập nhanh theo NCT':'NCT trong phạm vi'}</h1><p>{canWrite?'Tìm tên ông/bà → bấm một lần → hệ thống mở hoặc tạo ca hiện tại và vào ngay màn ghi biến động.':'Chọn cơ sở/khu/phòng để xem NCT thuộc phạm vi quản lý.'}</p></div><button onClick={()=>loadResidents(page)}>Tải lại</button></header>
    <div className="filter-flow">
      <label><span>1. Cơ sở</span><select value={branchId} disabled={user.role!=='ADMIN'} onChange={e=>{setBranchId(e.target.value);setAreaId('');setRoomId('');}}><option value="">Tất cả cơ sở</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label><span>2. Khu</span><select value={areaId} onChange={e=>{setAreaId(e.target.value);setRoomId('')}}><option value="">Tất cả khu</option>{locations.areas.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label><span>3. Phòng</span><select value={roomId} onChange={e=>setRoomId(e.target.value)}><option value="">Tất cả phòng</option>{rooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label><span>4. Hiển thị</span><select value={pageSize} onChange={e=>setPageSize(Number(e.target.value))}><option value={10}>10 NCT</option><option value={20}>20 NCT</option><option value={50}>50 NCT</option><option value={100}>100 NCT</option></select></label>
      <div className="search-action"><input autoFocus placeholder="Gõ tên NCT, mã, phòng hoặc giường..." value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')loadResidents(1)}}/><button onClick={()=>loadResidents(1)}>Tìm toàn bộ NCT</button></div>
    </div>
    {err&&<div className="error">{err}</div>}{data.mockReason&&<div className="warn">Mock fallback: {data.mockReason}</div>}
    <div className="resident-grid">{items.map(x=><button type="button" className="resident-card" key={x.id} onClick={()=>openResident(x)} disabled={opening===x.id}>
      <div className="avatar big">{x.image?<img src={x.image}/>:x.fullName?.slice(0,1)}</div><div className="resident-card-body"><b>{x.fullName}</b><small>{x.code} • {x.yearofBirth||'—'}</small><span>{x.branchName||'—'}</span><span>{x.areaName||'—'} • {x.roomName||'—'} • {x.bedName||'—'}</span></div><strong>{opening===x.id?'Đang mở...':canWrite?'Nhập biến động →':'Xem ca →'}</strong>
    </button>)}</div>
    {!items.length&&!loading&&<div className="empty">Không có NCT phù hợp bộ lọc.</div>}
    <div className="pager"><button disabled={page<=1||loading} onClick={()=>loadResidents(page-1)}>←</button><span>Trang {page} / {data.totalPage||1} • {data.totalItem||0} NCT</span><button disabled={page>=data.totalPage||loading} onClick={()=>loadResidents(page+1)}>→</button></div>
  </section>
}
