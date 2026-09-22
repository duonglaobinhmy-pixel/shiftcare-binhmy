import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const label = type => type === 'MORNING' ? 'Ca sáng' : 'Ca tối';
const todayVN = () => new Date().toLocaleDateString('en-CA');
const freshForm = user => ({
  shiftDate: todayVN(), shiftType: 'MORNING',
  branchId: user.branchId || '', branchName: user.branchName || '',
  areaId: user.areaId || '', areaName: '', roomId: '', assignedStaffIds: [], primaryRecorderId: '',
});

export default function Shifts() {
  const { user, can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [locations, setLocations] = useState({ areas: [], rooms: [] });
  const [staffOptions, setStaffOptions] = useState([]);
  const [show, setShow] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState(null);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [form, setForm] = useState(() => freshForm(user));
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [branchLoading, setBranchLoading] = useState(false);
  const [refreshingId, setRefreshingId] = useState('');
  const canCreate = can('SHIFT.CREATE');
  const canUpdate = can('SHIFT.UPDATE');
  const canDelete = can('SHIFT.DELETE');

  async function load() {
    setLoading(true);
    try {
      setErr('');
      const r = await api.shifts();
      setRows(r.data || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadBranchData(branchId) {
    if (!branchId) {
      setLocations({ areas: [], rooms: [] });
      setStaffOptions([]);
      return;
    }
    setBranchLoading(true);
    try {
      setErr('');
      const [locationResult, staffResult] = await Promise.all([
        api.locations(branchId),
        api.shiftStaffOptions(branchId),
      ]);
      setLocations(locationResult.data || { areas: [], rooms: [] });
      setStaffOptions(staffResult.data || []);
    } catch (e) {
      setErr(e.message);
      setLocations({ areas: [], rooms: [] });
      setStaffOptions([]);
    } finally {
      setBranchLoading(false);
    }
  }

  useEffect(() => {
    load();
    api.branches().then(r => setBranches(r.data || [])).catch(e => setErr(e.message));
    if (form.branchId && canCreate) loadBranchData(form.branchId);
    if (canCreate && searchParams.get('create') === '1') { setShow(true); setSearchParams({}, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rooms = useMemo(
    () => locations.rooms.filter(r => !form.areaId || String(r.areaId || '') === String(form.areaId)),
    [locations, form.areaId]
  );

  function changeBranch(branchId) {
    setInfo('');
    setForm(f => ({ ...f, branchId, areaId: '', roomId: '', assignedStaffIds: [], primaryRecorderId: '' }));
    loadBranchData(branchId);
  }

  function toggleStaff(id) {
    setForm(f => {
      const removing = f.assignedStaffIds.includes(id);
      if (!removing && f.assignedStaffIds.length >= 3) return f;
      return {
        ...f,
        assignedStaffIds: removing ? f.assignedStaffIds.filter(x => x !== id) : [...f.assignedStaffIds, id],
        primaryRecorderId: removing && f.primaryRecorderId === id ? '' : f.primaryRecorderId,
      };
    });
  }

  async function submit(e) {
    e.preventDefault();
    setErr(''); setInfo('');
    if (!form.branchId) return setErr('Phải chọn cơ sở.');
    if (form.assignedStaffIds.length < 2 || form.assignedStaffIds.length > 3) return setErr('Mỗi ca phải chọn từ 2 đến 3 nhân sự.');
    if (!form.primaryRecorderId || !form.assignedStaffIds.includes(form.primaryRecorderId)) return setErr('Phải chọn một người ghi chính trong số nhân sự trực ca.');
    setBusy(true);
    try {
      if (editingShiftId) {
        await api.updateShiftStaff(editingShiftId, form.assignedStaffIds, form.primaryRecorderId);
        setInfo('Đã cập nhật nhân sự trực ca.');
      } else {
        const branch = branches.find(x => String(x.id) === String(form.branchId));
        const area = locations.areas.find(x => String(x.id) === String(form.areaId));
        const r = await api.createShift({ ...form, branchName: branch?.name || form.branchName, areaName: area?.name || '' });
        const count = Number(r?.data?.residentCount || 0);
        setInfo(count > 0 ? `Đã tạo ca và nạp ${count} NCT từ BCARE.` : 'Đã tạo ca nhưng BCARE chưa trả NCT. Có thể bấm “Nạp lại NCT từ BCARE” trên ca vừa tạo.');
      }
      setShow(false); setEditingShiftId(null); setForm(freshForm(user)); setStaffOptions([]); await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function editStaff(row) {
    setEditingShiftId(row.id); setShow(true); setErr(''); setInfo('');
    setForm({
      shiftDate: row.shiftDate, shiftType: row.shiftType, branchId: row.branchId,
      branchName: row.branchName || '', areaId: row.areaId || '', areaName: row.areaName || '', roomId: row.roomId || '',
      assignedStaffIds: row.assignedStaffIds || row.assignedStaff?.map(x => x.id) || (row.assignedStaffId ? [row.assignedStaffId] : []),
      primaryRecorderId: row.primaryRecorderId || row.assignedStaffId || '',
    });
    await loadBranchData(row.branchId);
  }

  async function refreshRoster(row) {
    setRefreshingId(row.id); setErr(''); setInfo('');
    try {
      const r = await api.refreshShiftRoster(row.id);
      const count = Number(r?.data?.residentCount || 0);
      setInfo(count ? `Đã nạp lại ${count} NCT từ BCARE cho ${label(row.shiftType)}.` : 'BCARE trả 0 NCT cho bộ lọc cơ sở/khu/phòng của ca này.');
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setRefreshingId('');
    }
  }

  async function removeShift(row) {
    const warning = user.role === 'ADMIN' ? 'Admin sẽ xóa cả dữ liệu con của ca và audit vẫn lưu thao tác.' : 'Chỉ ca chưa có dữ liệu mới được xóa.';
    if (!confirm(`Xóa ${label(row.shiftType)} ngày ${row.shiftDate}? ${warning}`)) return;
    try { setErr(''); setInfo(''); await api.deleteShift(row.id); setInfo('Đã xóa ca.'); await load(); }
    catch (e) { setErr(e.message); }
  }

  const today = todayVN();
  return <section>
    <header className="page-head">
      <div><h1>Ca chăm sóc</h1><p>Mỗi ca có 2–3 nhân sự, 1 người ghi chính và roster NCT lấy từ BCARE.</p></div>
      {canCreate && <button type="button" onClick={() => { if (show) { setShow(false); setEditingShiftId(null); setForm(freshForm(user)); return; } setShow(true); setEditingShiftId(null); const next = freshForm(user); setForm(next); if (next.branchId) loadBranchData(next.branchId); }}>+ Tạo ca</button>}
    </header>

    {err && <div className="error">{err}</div>}
    {info && <div className="success-note">{info}</div>}

    {show && <form className="panel shift-create-form" onSubmit={submit}>
      <h3>{editingShiftId ? 'Cập nhật nhân sự trực ca' : 'Tạo ca mới'}</h3>
      <div className="form-grid">
        <label>Ngày<input disabled={!!editingShiftId} type="date" value={form.shiftDate} onChange={e => setForm({ ...form, shiftDate: e.target.value })} /></label>
        <label>Loại ca<select disabled={!!editingShiftId} value={form.shiftType} onChange={e => setForm({ ...form, shiftType: e.target.value })}><option value="MORNING">Ca sáng</option><option value="NIGHT">Ca tối</option></select></label>
        <label>Cơ sở<select disabled={!!editingShiftId} value={form.branchId} onChange={e => changeBranch(e.target.value)}><option value="">Chọn cơ sở</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label>Khu<select disabled={!!editingShiftId || branchLoading} value={form.areaId || ''} onChange={e => setForm({ ...form, areaId: e.target.value, roomId: '' })}><option value="">Toàn cơ sở</option>{locations.areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Phòng<select disabled={!!editingShiftId || branchLoading} value={form.roomId || ''} onChange={e => setForm({ ...form, roomId: e.target.value })}><option value="">Tất cả phòng trong khu</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      </div>

      <fieldset className="staff-picker">
        <legend>Nhân sự trực ca — chọn 2–3 người *</legend>
        <div className="staff-picker-head"><span>Đã chọn <b>{form.assignedStaffIds.length}</b></span><small>Tối thiểu 2, tối đa 3</small></div>
        {branchLoading ? <div className="inline-loading"><span className="loading-spinner" />Đang tải nhân sự và khu/phòng...</div> : <>
          <div className="staff-options">{staffOptions.map(staff => <label className={`staff-option ${form.assignedStaffIds.includes(staff.id) ? 'selected' : ''}`} key={staff.id}><input type="checkbox" checked={form.assignedStaffIds.includes(staff.id)} onChange={() => toggleStaff(staff.id)} /><span><b>{staff.fullName}</b><small>Mã NV: {staff.employeeCode || staff.username || '—'} • {staff.areaName || 'Toàn cơ sở'}</small></span></label>)}</div>
          {form.branchId && !staffOptions.length && <div className="empty compact">Không tìm thấy nhân sự hoạt động của cơ sở này. Kiểm tra branchId/active trong danh sách nhân viên.</div>}
        </>}
      </fieldset>

      <fieldset className="staff-picker"><legend>Người ghi chính trong ca *</legend><div className="staff-options">{staffOptions.filter(staff => form.assignedStaffIds.includes(staff.id)).map(staff => <label className={`staff-option ${form.primaryRecorderId === staff.id ? 'selected' : ''}`} key={staff.id}><input type="radio" name="primaryRecorder" checked={form.primaryRecorderId === staff.id} onChange={() => setForm({ ...form, primaryRecorderId: staff.id })} /><span><b>{staff.fullName}</b><small>Mã NV: {staff.employeeCode || staff.username || '—'}</small></span></label>)}</div></fieldset>
      <div className="actions"><button disabled={busy || branchLoading || form.assignedStaffIds.length < 2 || !form.primaryRecorderId}>{busy ? 'Đang lưu và nạp NCT...' : editingShiftId ? 'Lưu phân công' : 'Tạo ca & nạp roster BCARE'}</button><button type="button" className="secondary" onClick={() => { setShow(false); setEditingShiftId(null); setForm(freshForm(user)); }}>Hủy</button></div>
    </form>}

    {loading ? <div className="page-loading"><div className="page-loading-card"><span className="loading-spinner"/><b>Đang tải ca chăm sóc...</b><small>Đang đọc dữ liệu ca và roster.</small></div></div> : <div className="cards">{rows.map(x => <div className={`shift-card operational ${Number(x.residentCount || 0) === 0 ? 'roster-empty' : ''}`} key={x.id}>
      <div><b>{x.shiftDate === today ? 'Hôm nay • ' : ''}{label(x.shiftType)}</b><span>{x.branchName}</span><small>{x.areaName || 'Toàn cơ sở'} • <b>{x.residentCount ?? 0} NCT</b></small><small><b>Nhân sự:</b> {(x.assignedStaff || []).length ? x.assignedStaff.map(s => `${s.fullName} (${s.employeeCode || s.username || '—'})`).join(', ') : 'Ca cũ chưa phân công'}</small><small><b>Người ghi chính:</b> {x.primaryRecorderName || x.assignedStaffName || 'Chưa chọn'}</small>{Number(x.residentCount || 0) === 0 && <small className="roster-warning">Chưa có NCT trong roster — nạp lại từ BCARE.</small>}</div>
      <div className="shift-enter"><span className={`badge ${x.status}`}>{x.status}</span><Link className="shift-open-link" to={`/shifts/${x.id}`}>Vào ca →</Link>{canUpdate && x.status === 'OPEN' && <button className="secondary compact-button" disabled={refreshingId === x.id} onClick={() => refreshRoster(x)}>{refreshingId === x.id ? 'Đang nạp...' : '↻ Nạp lại NCT'}</button>}{canUpdate && x.status === 'OPEN' && <button className="secondary compact-button" onClick={() => editStaff(x)}>Sửa nhân sự</button>}{canDelete && <button className="danger compact-button" onClick={() => removeShift(x)}>Xóa ca</button>}</div>
    </div>)}</div>}
    {!loading && !rows.length && <div className="empty shift-empty"><b>Chưa có ca trong phạm vi này.</b><span>Tạo ca, chọn 2–3 nhân sự và nạp roster NCT từ BCARE.</span></div>}
  </section>;
}
