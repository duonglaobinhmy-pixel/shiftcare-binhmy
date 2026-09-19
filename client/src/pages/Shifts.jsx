import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const label = type => type === 'MORNING' ? 'Ca sáng' : type === 'AFTERNOON' ? 'Ca chiều (cũ)' : 'Ca tối';
const freshForm = user => ({
  shiftDate: new Date().toLocaleDateString('en-CA'), shiftType: 'MORNING',
  branchId: user.branchId || '', branchName: user.branchName || '',
  areaId: user.areaId || '', areaName: '', roomId: '', assignedStaffIds: [], primaryRecorderId: '',
});

export default function Shifts() {
  const { user, can } = useAuth();
  const [rows, setRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [locations, setLocations] = useState({ areas: [], rooms: [] });
  const [staffOptions, setStaffOptions] = useState([]);
  const [show, setShow] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(() => freshForm(user));
  const [busy, setBusy] = useState(false);
  const canCreate = can('SHIFT.CREATE');
  const canUpdate = can('SHIFT.UPDATE');
  const canDelete = can('SHIFT.DELETE');

  async function load() {
    try { setErr(''); setRows((await api.shifts()).data || []); }
    catch (e) { setErr(e.message); }
  }
  async function loadBranchData(branchId) {
    if (!branchId) { setLocations({ areas: [], rooms: [] }); setStaffOptions([]); return; }
    try {
      const [locationResult, staffResult] = await Promise.all([api.locations(branchId), api.shiftStaffOptions(branchId)]);
      setLocations(locationResult.data || { areas: [], rooms: [] });
      setStaffOptions(staffResult.data || []);
    } catch (e) { setErr(e.message); }
  }

  useEffect(() => {
    load();
    api.branches().then(r => setBranches(r.data || [])).catch(e => setErr(e.message));
    if (form.branchId && canCreate) loadBranchData(form.branchId);
  }, []);

  const rooms = useMemo(() => locations.rooms.filter(r => !form.areaId || r.areaId === form.areaId), [locations, form.areaId]);

  function changeBranch(branchId) {
    setForm(f => ({ ...f, branchId, areaId: '', roomId: '', assignedStaffIds: [], primaryRecorderId: '' }));
    loadBranchData(branchId);
  }
  function toggleStaff(id) {
    setForm(f => {const removing=f.assignedStaffIds.includes(id);if(!removing&&f.assignedStaffIds.length>=3)return f;return { ...f, assignedStaffIds: removing ? f.assignedStaffIds.filter(x => x !== id) : [...f.assignedStaffIds, id], primaryRecorderId: removing&&f.primaryRecorderId===id?'':f.primaryRecorderId }});
  }

  async function submit(e) {
    e.preventDefault(); setErr('');
    if (!form.branchId) return setErr('Phải chọn cơ sở.');
    if (form.assignedStaffIds.length < 2 || form.assignedStaffIds.length > 3) return setErr('Mỗi ca phải chọn từ 2 đến 3 nhân sự.');
    if (!form.primaryRecorderId || !form.assignedStaffIds.includes(form.primaryRecorderId)) return setErr('Phải chọn một người ghi chính trong số nhân sự trực ca.');
    setBusy(true);
    try {
      if (editingShiftId) await api.updateShiftStaff(editingShiftId, form.assignedStaffIds, form.primaryRecorderId);
      else {
        const branch = branches.find(x => x.id === form.branchId);
        const area = locations.areas.find(x => x.id === form.areaId);
        await api.createShift({ ...form, branchName: branch?.name || form.branchName, areaName: area?.name || '' });
      }
      setShow(false); setEditingShiftId(null); setForm(freshForm(user)); setStaffOptions([]); await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function editStaff(row) {
    setEditingShiftId(row.id); setShow(true); setErr('');
    setForm({
      shiftDate: row.shiftDate, shiftType: row.shiftType, branchId: row.branchId,
      branchName: row.branchName || '', areaId: row.areaId || '', areaName: row.areaName || '',
      roomId: row.roomId || '', assignedStaffIds: row.assignedStaffIds || row.assignedStaff?.map(x => x.id) || (row.assignedStaffId ? [row.assignedStaffId] : []), primaryRecorderId: row.primaryRecorderId || row.assignedStaffId || '',
    });
    await loadBranchData(row.branchId);
  }

  async function removeShift(row) {
    const warning = user.role === 'ADMIN' ? 'Admin có quyền xóa cả dữ liệu liên quan và audit sẽ ghi nhận thao tác này.' : 'Chỉ ca chưa có dữ liệu mới được xóa.';
    if (!confirm(`Xóa ${label(row.shiftType)} ngày ${row.shiftDate}? ${warning}`)) return;
    try { setErr(''); await api.deleteShift(row.id); await load(); }
    catch (e) { setErr(e.message); }
  }

  const today = new Date().toLocaleDateString('en-CA');
  return <section>
    <header className="page-head"><div><h1>{user.role === 'CAREGIVER' ? 'Ca của tôi' : 'Ca chăm sóc'}</h1><p>Mỗi ca có tối thiểu 2 nhân sự được chỉ định để truy trách nhiệm và đối chất.</p></div>{canCreate && <button onClick={() => { if(show){setShow(false);setEditingShiftId(null);setForm(freshForm(user));return}setShow(true);setEditingShiftId(null);setForm(freshForm(user));if(form.branchId)loadBranchData(form.branchId); }}>+ Tạo ca</button>}</header>
    {err && <div className="error">{err}</div>}

    {show && <form className="panel shift-create-form" onSubmit={submit}><h3>{editingShiftId?'Cập nhật nhân sự trực ca':'Tạo ca mới'}</h3>
      <div className="form-grid">
        <label>Ngày<input disabled={!!editingShiftId} type="date" value={form.shiftDate} onChange={e => setForm({ ...form, shiftDate: e.target.value })} /></label>
        <label>Loại ca<select disabled={!!editingShiftId} value={form.shiftType} onChange={e => setForm({ ...form, shiftType: e.target.value })}><option value="MORNING">Ca sáng</option><option value="NIGHT">Ca tối</option></select></label>
        <label>Cơ sở<select disabled={!!editingShiftId} value={form.branchId} onChange={e => changeBranch(e.target.value)}><option value="">Chọn cơ sở</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label>Khu<select disabled={!!editingShiftId} value={form.areaId || ''} onChange={e => setForm({ ...form, areaId: e.target.value, roomId: '' })}><option value="">Toàn cơ sở</option>{locations.areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Phòng (tùy chọn)<select disabled={!!editingShiftId} value={form.roomId || ''} onChange={e => setForm({ ...form, roomId: e.target.value })}><option value="">Tất cả phòng trong khu</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      </div>
      <fieldset className="staff-picker"><legend>Nhân sự trực ca — chọn tối thiểu 2 tài khoản *</legend><div className="staff-picker-head"><span>Đã chọn <b>{form.assignedStaffIds.length}</b>/2 tối thiểu</span>{form.assignedStaffIds.length < 2 && <small>Còn thiếu {2 - form.assignedStaffIds.length} người</small>}</div><div className="staff-options">{staffOptions.map(staff => <label className={`staff-option ${form.assignedStaffIds.includes(staff.id) ? 'selected' : ''}`} key={staff.id}><input type="checkbox" checked={form.assignedStaffIds.includes(staff.id)} onChange={() => toggleStaff(staff.id)} /><span><b>{staff.fullName}</b><small>Mã NV: {staff.employeeCode || staff.username} • {staff.areaName || 'Toàn cơ sở'}</small></span></label>)}</div>{form.branchId && !staffOptions.length && <div className="empty compact">Cơ sở chưa có tài khoản nhân sự đang hoạt động.</div>}</fieldset>
      <fieldset className="staff-picker"><legend>Người ghi chính trong ca *</legend><div className="staff-options">{staffOptions.filter(staff=>form.assignedStaffIds.includes(staff.id)).map(staff=><label className={`staff-option ${form.primaryRecorderId===staff.id?'selected':''}`} key={staff.id}><input type="radio" name="primaryRecorder" checked={form.primaryRecorderId===staff.id} onChange={()=>setForm({...form,primaryRecorderId:staff.id})}/><span><b>{staff.fullName}</b><small>Mã NV: {staff.employeeCode||staff.username}</small></span></label>)}</div>{form.assignedStaffIds.length>0&&!form.primaryRecorderId&&<small className="field-error">Chọn 1 người chịu trách nhiệm ghi chính.</small>}</fieldset>
      <div className="actions"><button disabled={busy || form.assignedStaffIds.length < 2 || !form.primaryRecorderId}>{busy ? 'Đang lưu...' : editingShiftId ? 'Lưu phân công nhân sự' : 'Tạo ca & nạp roster'}</button><button type="button" className="secondary" onClick={() => {setShow(false);setEditingShiftId(null);setForm(freshForm(user))}}>Hủy</button></div>
    </form>}

    <div className="cards">{rows.map(x => <div className="shift-card operational" key={x.id}><div><b>{x.shiftDate === today ? 'Hôm nay • ' : ''}{label(x.shiftType)}</b><span>{x.branchName}</span><small>{x.areaName || 'Toàn cơ sở'} • {x.residentCount ?? '—'} NCT</small><small><b>Nhân sự:</b> {(x.assignedStaff||[]).length?x.assignedStaff.map(s=>`${s.fullName} (${s.employeeCode||s.username})`).join(', '):(x.assignedStaffNames||[x.assignedStaffName]).filter(Boolean).join(', ')||'Ca cũ chưa phân công'}</small><small><b>Người ghi chính:</b> {x.primaryRecorderName||x.assignedStaffName||'Chưa chọn'}{(x.primaryRecorderCode||x.assignedStaff?.find(s=>s.id===(x.primaryRecorderId||x.assignedStaffId))?.employeeCode)?` (${x.primaryRecorderCode||x.assignedStaff.find(s=>s.id===(x.primaryRecorderId||x.assignedStaffId))?.employeeCode})`:''}</small></div><div className="shift-enter"><span className={`badge ${x.status}`}>{x.status}</span><Link className="shift-open-link" to={`/shifts/${x.id}`}>Vào ca →</Link>{canUpdate&&x.status==='OPEN'&&<button className="secondary compact-button" onClick={()=>editStaff(x)}>Sửa nhân sự</button>}{canDelete && <button className="danger compact-button" onClick={() => removeShift(x)}>Xóa ca</button>}</div></div>)}</div>
    {!rows.length && <div className="empty shift-empty"><b>Chưa có ca trong phạm vi này.</b><span>Giám đốc cơ sở hoặc Admin tạo ca, chọn tối thiểu 2 nhân sự và 1 người ghi chính.</span></div>}
  </section>;
}
