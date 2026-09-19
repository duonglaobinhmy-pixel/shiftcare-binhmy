import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const PERMISSION_GROUPS = [
  { module: 'DASHBOARD', label: 'Tổng quan', actions: ['VIEW'] },
  { module: 'SHIFT', label: 'Ca chăm sóc', actions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE'] },
  { module: 'CARE', label: 'Ghi nhận chăm sóc', actions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE'] },
  { module: 'HANDOVER', label: 'Bàn giao ca', actions: ['VIEW', 'SIGN', 'RECEIVE', 'OVERRIDE'] },
  { module: 'MEDICAL', label: 'Y khoa / y lệnh', actions: ['VIEW', 'CREATE', 'UPDATE', 'STOP', 'ADMINISTER', 'DELETE'] },
  { module: 'REPORT', label: 'Báo cáo', actions: ['VIEW', 'EXPORT'] },
  { module: 'AUDIT', label: 'Nhật ký hệ thống', actions: ['VIEW'] },
  { module: 'USER', label: 'Tài khoản', actions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE'] },
  { module: 'SYSTEM', label: 'Kết nối hệ thống', actions: ['VIEW', 'UPDATE'] },
];

const ACTION_LABELS = {
  VIEW: 'Xem', CREATE: 'Thêm', UPDATE: 'Sửa', DELETE: 'Xóa', SIGN: 'Ký giao',
  RECEIVE: 'Ký nhận', OVERRIDE: 'Sửa sau bàn giao', STOP: 'Ngừng y lệnh',
  ADMINISTER: 'Thực hiện thuốc', EXPORT: 'Xuất file',
};

const ROLE_LABEL = {
  ADMIN: 'Admin', BRANCH_DIRECTOR: 'Giám đốc cơ sở',
  MEDICAL: 'Nhân sự y khoa', CAREGIVER: 'Chăm sóc viên',
};

const ROLE_DEFAULTS = {
  ADMIN: [],
  BRANCH_DIRECTOR: ['DASHBOARD.VIEW','SHIFT.VIEW','SHIFT.CREATE','SHIFT.UPDATE','SHIFT.DELETE','CARE.VIEW','HANDOVER.VIEW','REPORT.VIEW','REPORT.EXPORT','AUDIT.VIEW','USER.VIEW','USER.CREATE','USER.UPDATE','USER.DELETE','SYSTEM.VIEW'],
  MEDICAL: ['DASHBOARD.VIEW','SHIFT.VIEW','CARE.VIEW','CARE.CREATE','CARE.UPDATE','HANDOVER.VIEW','HANDOVER.SIGN','HANDOVER.RECEIVE','MEDICAL.VIEW','MEDICAL.CREATE','MEDICAL.UPDATE','MEDICAL.STOP','MEDICAL.ADMINISTER','REPORT.VIEW'],
  CAREGIVER: ['DASHBOARD.VIEW','SHIFT.VIEW','CARE.VIEW','CARE.CREATE','CARE.UPDATE','HANDOVER.VIEW','HANDOVER.SIGN','HANDOVER.RECEIVE','MEDICAL.VIEW','MEDICAL.ADMINISTER'],
};

const emptyForm = user => ({
  username: '', password: 'Demo@123', employeeCode: '', fullName: '', role: 'CAREGIVER',
  branchId: user?.role === 'BRANCH_DIRECTOR' ? (user.branchId || '') : '', branchName: user?.role === 'BRANCH_DIRECTOR' ? (user.branchName || '') : '', areaId: '', areaName: '', fullAccess: false,
  permissions: [...ROLE_DEFAULTS.CAREGIVER],
});

export default function Users() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [areas, setAreas] = useState([]);
  const [show, setShow] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [err, setErr] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [form, setForm] = useState(() => emptyForm(user));
  const [busy, setBusy] = useState(false);
  const [staffRows, setStaffRows] = useState([]);
  const [staffBranchId, setStaffBranchId] = useState(user?.role === 'BRANCH_DIRECTOR' ? (user.branchId || '') : '');
  const [staffForm, setStaffForm] = useState({ employeeCode: '', fullName: '' });
  const [staffBusy, setStaffBusy] = useState(false);
  const staffFileRef = useRef(null);

  async function load() {
    setErr('');
    try {
      const [u, b] = await Promise.all([api.users(), api.branches()]);
      setRows(u.data || []);
      setBranches(b.data || []);
      if (user?.role === 'BRANCH_DIRECTOR') setStaffBranchId(user.branchId || '');
    } catch (e) { setErr(e.message); }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!staffBranchId) { setStaffRows([]); return; }
    api.staff(staffBranchId).then(r => setStaffRows(r.data || [])).catch(e => setErr(e.message));
  }, [staffBranchId]);
  useEffect(() => {
    if (form.role === 'ADMIN' || !form.branchId) { setAreas([]); return; }
    api.locations(form.branchId).then(r => setAreas(r.data?.areas || [])).catch(e => setErr(e.message));
  }, [form.branchId, form.role]);

  const selectedBranch = useMemo(() => branches.find(x => x.id === form.branchId) || null, [branches, form.branchId]);

  function resetEditor() {
    setShow(false); setEditingId(null); setForm(emptyForm(user)); setAreas([]); setFieldErrors({});
  }

  function validate() {
    const x = {};
    const username = form.username.trim();
    if (!editingId && !username) x.username = 'Bắt buộc nhập username';
    else if (!editingId && !/^[A-Za-z0-9._-]{4,40}$/.test(username)) x.username = '4–40 ký tự; chỉ chữ, số, dấu chấm, gạch dưới/gạch ngang';
    if (!editingId && !form.password) x.password = 'Bắt buộc nhập mật khẩu';
    else if (form.password && form.password.length < 8) x.password = 'Mật khẩu tối thiểu 8 ký tự';
    if (!form.fullName.trim()) x.fullName = 'Bắt buộc nhập họ tên';
    if (!form.employeeCode.trim()) x.employeeCode = 'Bắt buộc nhập mã nhân viên';
    else if (!/^[A-Za-z0-9._-]{1,30}$/.test(form.employeeCode.trim())) x.employeeCode = 'Tối đa 30 ký tự; chỉ chữ, số, dấu chấm, gạch dưới/gạch ngang';
    if (form.role !== 'ADMIN' && !form.branchId) x.branchId = 'Phải chọn cơ sở';
    if (form.role === 'CAREGIVER' && !form.areaId) x.areaId = 'Phải chọn khu phụ trách';
    setFieldErrors(x);
    return Object.keys(x).length === 0;
  }

  async function submit(e) {
    e.preventDefault(); setErr('');
    if (!validate()) return;
    setBusy(true);
    try {
      const area = areas.find(x => x.id === form.areaId);
      const payload = {
        ...form, username: form.username.trim(), employeeCode: form.employeeCode.trim(), fullName: form.fullName.trim(),
        branchName: form.role === 'ADMIN' ? '' : (selectedBranch?.name || form.branchName || ''),
        areaName: form.role === 'CAREGIVER' ? (area?.name || form.areaName || '') : '',
      };
      if (editingId) {
        if (!payload.password) delete payload.password;
        await api.updateUser(editingId, payload);
      } else await api.createUser(payload);
      resetEditor(); await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  function startCreate() { setEditingId(null); setForm(emptyForm(user)); setShow(true); setFieldErrors({}); setErr(''); }
  function startEdit(row) {
    const legacyFullAdmin = row.role === 'ADMIN' && !Array.isArray(row.permissions);
    setEditingId(row.id);
    setForm({
      username: row.username, password: '', employeeCode: row.employeeCode || row.username, fullName: row.fullName || '', role: row.role,
      branchId: row.branchId || '', branchName: row.branchName || '', areaId: row.areaId || '', areaName: row.areaName || '',
      fullAccess: row.role === 'ADMIN' && (row.fullAccess === true || legacyFullAdmin),
      permissions: Array.isArray(row.permissions) ? [...row.permissions] : [...(ROLE_DEFAULTS[row.role] || [])],
    });
    setShow(true); setFieldErrors({}); setErr('');
  }

  function changeRole(role) {
    setForm(f => ({ ...f, role, branchId: user.role === 'BRANCH_DIRECTOR' ? (user.branchId || '') : '', branchName: user.role === 'BRANCH_DIRECTOR' ? (user.branchName || '') : '', areaId: '', areaName: '', fullAccess: role === 'ADMIN', permissions: [...(ROLE_DEFAULTS[role] || [])] }));
    setAreas([]); setFieldErrors({});
  }
  function changeBranch(branchId) {
    const b = branches.find(x => x.id === branchId);
    setForm(f => ({ ...f, branchId, branchName: b?.name || '', areaId: '', areaName: '' }));
  }
  function changeArea(areaId) {
    const a = areas.find(x => x.id === areaId);
    setForm(f => ({ ...f, areaId, areaName: a?.name || '' }));
  }
  function togglePermission(permission) {
    setForm(f => ({ ...f, permissions: f.permissions.includes(permission) ? f.permissions.filter(x => x !== permission) : [...f.permissions, permission] }));
  }
  function toggleModule(group, checked) {
    const modulePermissions = group.actions.map(action => `${group.module}.${action}`);
    setForm(f => ({ ...f, permissions: checked ? [...new Set([...f.permissions, ...modulePermissions])] : f.permissions.filter(x => !modulePermissions.includes(x)) }));
  }

  async function deactivate(row) {
    if (!confirm(`Khóa tài khoản “${row.username}”? Người này sẽ không đăng nhập được.`)) return;
    try { await api.deactivateUser(row.id); await load(); } catch (e) { setErr(e.message); }
  }
  async function activate(row) {
    if (!confirm(`Mở khóa tài khoản “${row.username}”?`)) return;
    try { await api.activateUser(row.id); await load(); } catch (e) { setErr(e.message); }
  }
  async function remove(row) {
    if (row.active) { alert('Phải KHÓA tài khoản trước rồi mới được xóa vĩnh viễn.'); return; }
    const typed = prompt(`XÓA VĨNH VIỄN tài khoản “${row.username}”.\nNhập đúng username để xác nhận:`);
    if (typed !== row.username) return;
    try { await api.deleteUserPermanent(row.id, row.username); await load(); } catch (e) { setErr(e.message); }
  }

  async function addStaff(e) {
    e.preventDefault(); setErr('');
    if (!staffForm.fullName.trim() || !staffForm.employeeCode.trim() || !staffBranchId) return setErr('Cần chọn cơ sở, mã nhân viên và họ tên.');
    setStaffBusy(true);
    try { await api.createStaff({ ...staffForm, branchId: staffBranchId }); setStaffForm({ employeeCode: '', fullName: '' }); const r = await api.staff(staffBranchId); setStaffRows(r.data || []); }
    catch (e) { setErr(e.message); } finally { setStaffBusy(false); }
  }

  async function importStaffFile(e) {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) return setErr('Chỉ nhận file Excel .xlsx.');
    if (file.size > 5 * 1024 * 1024) return setErr('File Excel tối đa 5 MB.');
    if (!staffBranchId) return setErr('Hãy chọn cơ sở trước khi tải Excel.');
    setStaffBusy(true); setErr('');
    try {
      const fileBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('Không đọc được file Excel.')); reader.readAsDataURL(file); });
      const result = await api.importStaff({ fileName: file.name, fileBase64, branchId: staffBranchId });
      const list = await api.staff(staffBranchId); setStaffRows(list.data || []);
      alert(`Đã nhập ${result.data.importedCount} nhân viên. Bỏ qua ${result.data.skippedCount} dòng trùng mã.`);
    } catch (e) { setErr(e.message); } finally { setStaffBusy(false); }
  }

  async function editStaff(row) {
    const fullName = prompt('Họ tên nhân viên', row.fullName); if (fullName === null) return;
    const employeeCode = prompt('Mã nhân viên', row.employeeCode); if (employeeCode === null) return;
    try { await api.updateStaff(row.id, { fullName, employeeCode }); const r = await api.staff(staffBranchId); setStaffRows(r.data || []); } catch (e) { setErr(e.message); }
  }

  async function removeStaff(row) {
    const reason = prompt(`Lý do xóa nhân viên “${row.fullName}”?`); if (!reason) return;
    try { await api.deleteStaff(row.id, reason); const r = await api.staff(staffBranchId); setStaffRows(r.data || []); } catch (e) { setErr(e.message); }
  }

  return <section>
    <header className="page-head"><div><h1>Tài khoản & phân quyền</h1><p>Phân quyền chi tiết theo từng module và từng hành động.</p></div><button onClick={show ? resetEditor : startCreate}>{show ? 'Đóng' : '+ Tạo tài khoản'}</button></header>
    {err && <div className="error">{err}</div>}

    <div className="panel">
      <div className="permission-head"><div><h2>Danh sách nhân viên theo cơ sở</h2><p>Đây là danh sách nhân sự thực tế để phân ca. Không cần tạo tài khoản đăng nhập cho từng nhân viên.</p></div></div>
      <div className="form-grid user-form">
        <label>Cơ sở *<select disabled={user?.role === 'BRANCH_DIRECTOR'} value={staffBranchId} onChange={e => setStaffBranchId(e.target.value)}><option value="">-- Chọn cơ sở --</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <form className="inline-form" onSubmit={addStaff}><label>Mã nhân viên *<input value={staffForm.employeeCode} onChange={e => setStaffForm({ ...staffForm, employeeCode: e.target.value })} placeholder="VD: NV001" /></label><label>Họ tên *<input value={staffForm.fullName} onChange={e => setStaffForm({ ...staffForm, fullName: e.target.value })} placeholder="Nguyễn Văn A" /></label><button disabled={staffBusy || !staffBranchId}>{staffBusy ? 'Đang lưu...' : '+ Thêm nhân viên'}</button><button type="button" className="secondary" disabled={staffBusy} onClick={() => { if (!staffBranchId) { setErr('Hãy chọn cơ sở trước khi tải Excel.'); return; } staffFileRef.current?.click(); }}>{staffBusy ? 'Đang nhập Excel…' : 'Tải Excel danh sách'}</button><input ref={staffFileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: 'none' }} onChange={importStaffFile} /></form>
      </div>
      {staffBranchId && <div className="table-wrap"><table><thead><tr><th>Mã nhân viên</th><th>Họ tên</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{staffRows.map(x => <tr key={x.id}><td><b>{x.employeeCode}</b></td><td>{x.fullName}</td><td><span className="status-pill on">Đang làm việc</span></td><td><div className="actions"><button className="secondary" onClick={() => editStaff(x)}>Sửa</button><button className="danger" onClick={() => removeStaff(x)}>Xóa</button></div></td></tr>)}{!staffRows.length && <tr><td colSpan="4">Chưa có nhân viên. Hãy thêm danh sách trước khi tạo ca.</td></tr>}</tbody></table></div>}
    </div>

    {show && <form className="panel user-editor" onSubmit={submit} noValidate>
      <div className="form-grid user-form">
        <label>Username *<input value={form.username} disabled={!!editingId} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="vd: csv.hoalan" />{fieldErrors.username && <small className="field-error">{fieldErrors.username}</small>}</label>
        <label>{editingId ? 'Mật khẩu mới (để trống nếu giữ nguyên)' : 'Mật khẩu *'}<input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />{fieldErrors.password && <small className="field-error">{fieldErrors.password}</small>}</label>
        <label>Mã nhân viên *<input value={form.employeeCode} onChange={e => setForm({ ...form, employeeCode: e.target.value })} placeholder="VD: 960" />{fieldErrors.employeeCode && <small className="field-error">{fieldErrors.employeeCode}</small>}</label>
        <label>Họ tên *<input value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} placeholder="Nguyễn Văn A" />{fieldErrors.fullName && <small className="field-error">{fieldErrors.fullName}</small>}</label>
        <label>Vai trò *<select value={form.role} onChange={e => changeRole(e.target.value)}>{user.role === 'ADMIN' && <><option value="ADMIN">Admin</option><option value="BRANCH_DIRECTOR">Giám đốc cơ sở</option></>}<option value="MEDICAL">Nhân sự y khoa</option><option value="CAREGIVER">Chăm sóc viên</option></select></label>
        {form.role !== 'ADMIN' && <label>Cơ sở *<select disabled={user.role === 'BRANCH_DIRECTOR'} value={form.branchId} onChange={e => changeBranch(e.target.value)}><option value="">-- Chọn cơ sở --</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>{fieldErrors.branchId && <small className="field-error">{fieldErrors.branchId}</small>}</label>}
        {form.role === 'CAREGIVER' && <label>Khu phụ trách *<select value={form.areaId} onChange={e => changeArea(e.target.value)} disabled={!form.branchId}><option value="">{form.branchId ? '-- Chọn khu --' : '-- Chọn cơ sở trước --'}</option>{areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>{fieldErrors.areaId && <small className="field-error">{fieldErrors.areaId}</small>}</label>}
      </div>

      {form.role === 'ADMIN' && <label className="check full-access-check"><input type="checkbox" checked={form.fullAccess} onChange={e => setForm({ ...form, fullAccess: e.target.checked })} /><span><b>Toàn quyền hệ thống</b><small>Bỏ tick để cấu hình quyền Admin theo từng chức năng bên dưới.</small></span></label>}

      {user.role === 'ADMIN' && <div className={`permission-section ${form.fullAccess ? 'disabled' : ''}`}>
        <div className="permission-head"><div><h3>Quyền chi tiết</h3><p>Quyền được kiểm tra lại ở API, không chỉ ẩn nút trên giao diện.</p></div><button type="button" className="secondary" disabled={form.fullAccess} onClick={() => setForm(f => ({ ...f, permissions: [...(ROLE_DEFAULTS[f.role] || [])] }))}>Khôi phục mặc định vai trò</button></div>
        <div className="permission-matrix">{PERMISSION_GROUPS.map(group => {
          const keys = group.actions.map(action => `${group.module}.${action}`);
          const allChecked = keys.every(key => form.permissions.includes(key));
          return <div className="permission-row" key={group.module}><label className="permission-module"><input type="checkbox" disabled={form.fullAccess} checked={allChecked} onChange={e => toggleModule(group, e.target.checked)} /><b>{group.label}</b></label><div>{group.actions.map(action => { const key = `${group.module}.${action}`; return <label className="permission-toggle" key={key}><input type="checkbox" disabled={form.fullAccess} checked={form.permissions.includes(key)} onChange={() => togglePermission(key)} />{ACTION_LABELS[action] || action}</label>; })}</div></div>;
        })}</div>
      </div>}
      <div className="actions"><button disabled={busy}>{busy ? 'Đang lưu...' : editingId ? 'Lưu tài khoản & quyền' : 'Tạo tài khoản'}</button><button type="button" className="secondary" onClick={resetEditor}>Hủy</button></div>
    </form>}

    <div className="table-wrap"><table><thead><tr><th>Tài khoản</th><th>Mã NV</th><th>Họ tên</th><th>Vai trò</th><th>Cơ sở</th><th>Khu</th><th>Quyền</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{rows.map(x => <tr key={x.id}>
      <td><b>{x.username}</b></td><td><b>{x.employeeCode || x.username}</b></td><td>{x.fullName}</td><td>{ROLE_LABEL[x.role] || x.role}</td><td>{x.role === 'ADMIN' ? 'Toàn hệ thống' : (x.branchName || '—')}</td><td>{x.role === 'CAREGIVER' ? (x.areaName || x.areaId || '—') : '—'}</td>
      <td>{x.role === 'ADMIN' && (x.fullAccess || !Array.isArray(x.permissions)) ? <span className="status-pill on">Toàn quyền</span> : <span>{Array.isArray(x.permissions) ? x.permissions.length : (ROLE_DEFAULTS[x.role] || []).length} quyền</span>}</td>
      <td><span className={`status-pill ${x.active ? 'on' : 'off'}`}>{x.active ? 'Hoạt động' : 'Đã khóa'}</span></td>
      <td><div className="actions"><button className="secondary" onClick={() => startEdit(x)}>Sửa quyền</button>{x.active ? <button className="secondary" onClick={() => deactivate(x)}>Khóa</button> : <button onClick={() => activate(x)}>Mở khóa</button>}{!x.active && <button className="danger" onClick={() => remove(x)}>Xóa</button>}</div></td>
    </tr>)}</tbody></table></div>
  </section>;
}
