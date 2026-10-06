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
  { module: 'USER', label: 'Tài khoản & nhân sự', actions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE'] },
  { module: 'SYSTEM', label: 'Kết nối hệ thống', actions: ['VIEW', 'UPDATE'] },
];

const ACTION_LABELS = {
  VIEW: 'Xem', CREATE: 'Thêm', UPDATE: 'Sửa', DELETE: 'Xóa', SIGN: 'Ký giao',
  RECEIVE: 'Ký nhận', OVERRIDE: 'Sửa sau bàn giao', STOP: 'Ngừng y lệnh',
  ADMINISTER: 'Thực hiện thuốc', EXPORT: 'Xuất file',
};

const ROLE_LABEL = {
  ADMIN: 'Admin',
  BRANCH_DIRECTOR: 'Giám đốc cơ sở',
  CARE_SHARED: 'Tài khoản CSV dùng chung',
};

const ROLE_CAPS = {
  ADMIN: ['*'],
  BRANCH_DIRECTOR: [
    'DASHBOARD.VIEW',
    'SHIFT.VIEW', 'SHIFT.CREATE', 'SHIFT.UPDATE',
    'CARE.VIEW', 'CARE.CREATE', 'CARE.UPDATE',
    'HANDOVER.VIEW', 'HANDOVER.SIGN', 'HANDOVER.RECEIVE',
    'MEDICAL.VIEW', 'MEDICAL.CREATE', 'MEDICAL.UPDATE', 'MEDICAL.STOP', 'MEDICAL.ADMINISTER',
    'REPORT.VIEW', 'REPORT.EXPORT',
    'AUDIT.VIEW',
    'USER.VIEW', 'USER.CREATE', 'USER.UPDATE', 'USER.DELETE',
    'SYSTEM.VIEW',
  ],
  CARE_SHARED: [
    'SHIFT.VIEW',
    'CARE.VIEW', 'CARE.CREATE',
    'HANDOVER.VIEW', 'HANDOVER.SIGN', 'HANDOVER.RECEIVE',
    'MEDICAL.VIEW', 'MEDICAL.ADMINISTER',
  ],
};

const ROLE_DEFAULTS = {
  ADMIN: [],
  BRANCH_DIRECTOR: [...ROLE_CAPS.BRANCH_DIRECTOR],
  CARE_SHARED: [...ROLE_CAPS.CARE_SHARED],
};

const emptyAccountForm = () => ({
  username: '',
  password: 'Demo@123',
  fullName: '',
  role: 'BRANCH_DIRECTOR',
  branchId: '',
  branchName: '',
  permissions: [...ROLE_DEFAULTS.BRANCH_DIRECTOR],
});

export default function Users() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [rows, setRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [showAccount, setShowAccount] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyAccountForm);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const [staffRows, setStaffRows] = useState([]);
  const [staffBranchId, setStaffBranchId] = useState(user?.role === 'BRANCH_DIRECTOR' ? (user.branchId || '') : '');
  const [staffForm, setStaffForm] = useState({ employeeCode: '', fullName: '' });
  const [staffBusy, setStaffBusy] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);
  const staffFileRef = useRef(null);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const [b, u] = await Promise.all([
        api.branches(),
        api.users(),
      ]);
      setBranches(b.data || []);
      setRows(u.data || []);
      if (user?.role === 'BRANCH_DIRECTOR') setStaffBranchId(user.branchId || '');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!staffBranchId) { setStaffRows([]); return; }
    let cancelled = false;
    setStaffLoading(true);
    api.staff(staffBranchId)
      .then(r => { if (!cancelled) setStaffRows(r.data || []); })
      .catch(e => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setStaffLoading(false); });
    return () => { cancelled = true; };
  }, [staffBranchId]);

  const selectedBranch = useMemo(
    () => branches.find(x => String(x.id) === String(form.branchId)) || null,
    [branches, form.branchId]
  );

  function resetAccountEditor() {
    setShowAccount(false);
    setEditingId(null);
    setForm(emptyAccountForm());
    setFieldErrors({});
  }

  function changeRole(role) {
    setForm(current => ({
      ...current,
      role,
      branchId: role === 'ADMIN' ? '' : current.branchId,
      branchName: role === 'ADMIN' ? '' : current.branchName,
      permissions: [...(ROLE_DEFAULTS[role] || [])],
    }));
  }

  function togglePermission(permission) {
    const cap = ROLE_CAPS[form.role] || [];
    if (!cap.includes(permission)) return;
    setForm(current => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter(x => x !== permission)
        : [...current.permissions, permission],
    }));
  }

  function toggleModule(group, checked) {
    const cap = new Set(ROLE_CAPS[form.role] || []);
    const keys = group.actions.map(action => `${group.module}.${action}`).filter(key => cap.has(key));
    setForm(current => ({
      ...current,
      permissions: checked
        ? [...new Set([...current.permissions, ...keys])]
        : current.permissions.filter(x => !keys.includes(x)),
    }));
  }

  function validateAccount() {
    const errors = {};
    if (!editingId && !/^[A-Za-z0-9._-]{4,40}$/.test(form.username.trim())) errors.username = 'Username 4–40 ký tự.';
    if (!editingId && form.password.length < 8) errors.password = 'Mật khẩu tối thiểu 8 ký tự.';
    if (editingId && form.password && form.password.length < 8) errors.password = 'Mật khẩu tối thiểu 8 ký tự.';
    if (!form.fullName.trim()) errors.fullName = 'Bắt buộc nhập tên hiển thị.';
    if (form.role !== 'ADMIN' && !form.branchId) errors.branchId = 'Phải chọn cơ sở.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function submitAccount(e) {
    e.preventDefault();
    if (!isAdmin || !validateAccount()) return;
    setBusy(true);
    setErr('');
    try {
      const payload = {
        username: form.username.trim(),
        fullName: form.fullName.trim(),
        role: form.role,
        branchId: form.role === 'ADMIN' ? null : form.branchId,
        branchName: form.role === 'ADMIN' ? '' : (selectedBranch?.name || form.branchName || ''),
        permissions: form.role === 'ADMIN' ? [] : form.permissions,
      };
      if (form.password) payload.password = form.password;
      if (editingId) await api.updateUser(editingId, payload);
      else await api.createUser(payload);
      resetAccountEditor();
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function startCreateAccount() {
    setEditingId(null);
    setForm(emptyAccountForm());
    setFieldErrors({});
    setShowAccount(true);
  }

  function startEditAccount(row) {
    setEditingId(row.id);
    setForm({
      username: row.username || '',
      password: '',
      fullName: row.fullName || '',
      role: row.role,
      branchId: row.branchId || '',
      branchName: row.branchName || '',
      permissions: Array.isArray(row.permissions) ? [...row.permissions] : [...(ROLE_DEFAULTS[row.role] || [])],
    });
    setFieldErrors({});
    setShowAccount(true);
  }

  async function deactivate(row) {
    if (!confirm(`Khóa tài khoản “${row.username}”?`)) return;
    try { await api.deactivateUser(row.id); await load(); } catch (e) { setErr(e.message); }
  }

  async function activate(row) {
    if (!confirm(`Mở khóa tài khoản “${row.username}”?`)) return;
    try { await api.activateUser(row.id); await load(); } catch (e) { setErr(e.message); }
  }

  async function removeAccount(row) {
    if (row.active) return alert('Phải khóa tài khoản trước khi xóa vĩnh viễn.');
    const typed = prompt(`Nhập đúng username “${row.username}” để xác nhận xóa vĩnh viễn:`);
    if (typed !== row.username) return;
    try { await api.deleteUserPermanent(row.id, row.username); await load(); } catch (e) { setErr(e.message); }
  }

  async function reloadStaff() {
    if (!staffBranchId) return setStaffRows([]);
    const r = await api.staff(staffBranchId);
    setStaffRows(r.data || []);
  }

  async function addStaff(e) {
    e.preventDefault();
    if (!staffBranchId || !staffForm.employeeCode.trim() || !staffForm.fullName.trim()) {
      return setErr('Cần chọn cơ sở, mã nhân viên và họ tên.');
    }
    setStaffBusy(true);
    setErr('');
    try {
      await api.createStaff({ branchId: staffBranchId, employeeCode: staffForm.employeeCode.trim(), fullName: staffForm.fullName.trim() });
      setStaffForm({ employeeCode: '', fullName: '' });
      await reloadStaff();
    } catch (e) {
      setErr(e.message);
    } finally {
      setStaffBusy(false);
    }
  }

  async function importStaffFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!staffBranchId) return setErr('Hãy chọn cơ sở trước khi tải Excel.');
    if (!/\.xlsx$/i.test(file.name)) return setErr('Chỉ nhận file Excel .xlsx.');
    if (file.size > 5 * 1024 * 1024) return setErr('File Excel tối đa 5 MB.');
    setStaffBusy(true);
    setErr('');
    try {
      const fileBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Không đọc được file Excel.'));
        reader.readAsDataURL(file);
      });
      const result = await api.importStaff({ branchId: staffBranchId, fileName: file.name, fileBase64 });
      await reloadStaff();
      alert(`Đã nhập ${result.data.importedCount} nhân viên. Bỏ qua ${result.data.skippedCount} dòng trùng mã.`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setStaffBusy(false);
    }
  }

  async function editStaff(row) {
    const fullName = prompt('Họ tên nhân viên', row.fullName);
    if (fullName === null) return;
    const employeeCode = prompt('Mã nhân viên', row.employeeCode);
    if (employeeCode === null) return;
    try { await api.updateStaff(row.id, { fullName, employeeCode }); await reloadStaff(); } catch (e) { setErr(e.message); }
  }

  async function removeStaff(row) {
    const reason = prompt(`Lý do xóa nhân viên “${row.fullName}”?`);
    if (!reason) return;
    try { await api.deleteStaff(row.id, reason); await reloadStaff(); } catch (e) { setErr(e.message); }
  }

  return <section>
    <header className="page-head">
      <div>
        <h1>Tài khoản & nhân sự</h1>
        <p>Admin quản tài khoản. Giám đốc cơ sở quản danh sách nhân viên thực tế của đúng cơ sở mình.</p>
      </div>
      {isAdmin && <button onClick={showAccount ? resetAccountEditor : startCreateAccount}>{showAccount ? 'Đóng' : '+ Tạo tài khoản'}</button>}
    </header>

    {err && <div className="error">{err}</div>}

    <div className="panel">
      <div className="permission-head">
        <div>
          <h2>Danh sách nhân viên theo cơ sở</h2>
          <p>Nhân viên không cần tài khoản riêng. Danh sách này dùng để chọn tối thiểu 2 người vào ca, không giới hạn số người.</p>
        </div>
      </div>
      <div className="form-grid user-form">
        <label>Cơ sở *
          <select disabled={!isAdmin} value={staffBranchId} onChange={e => setStaffBranchId(e.target.value)}>
            <option value="">-- Chọn cơ sở --</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <form className="inline-form" onSubmit={addStaff}>
          <label>Mã nhân viên *<input value={staffForm.employeeCode} onChange={e => setStaffForm({ ...staffForm, employeeCode: e.target.value })} /></label>
          <label>Họ tên *<input value={staffForm.fullName} onChange={e => setStaffForm({ ...staffForm, fullName: e.target.value })} /></label>
          <button disabled={staffBusy || !staffBranchId}>{staffBusy ? 'Đang lưu...' : '+ Thêm nhân viên'}</button>
          <button type="button" className="secondary" disabled={staffBusy || !staffBranchId} onClick={() => staffFileRef.current?.click()}>Tải Excel</button>
          <input ref={staffFileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={importStaffFile} />
        </form>
      </div>
      {staffLoading ? <div className="page-loading"><div className="page-loading-card"><span className="loading-spinner"/><b>Đang tải nhân viên...</b></div></div> :
        staffBranchId && <div className="table-wrap"><table><thead><tr><th>Mã NV</th><th>Họ tên</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
          {staffRows.map(x => <tr key={x.id}><td><b>{x.employeeCode}</b></td><td>{x.fullName}</td><td><span className={`status-pill ${x.active !== false ? 'on' : 'off'}`}>{x.active !== false ? 'Đang làm việc' : 'Ngừng làm việc'}</span></td><td><div className="actions"><button className="secondary" onClick={() => editStaff(x)}>Sửa</button><button className="danger" onClick={() => removeStaff(x)}>Xóa</button></div></td></tr>)}
          {!staffRows.length && <tr><td colSpan="4">Chưa có nhân viên trong cơ sở.</td></tr>}
        </tbody></table></div>}
    </div>

    {isAdmin && showAccount && <form className="panel user-editor" onSubmit={submitAccount} noValidate>
      <div className="form-grid user-form">
        <label>Username *<input disabled={!!editingId} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />{fieldErrors.username && <small className="field-error">{fieldErrors.username}</small>}</label>
        <label>{editingId ? 'Mật khẩu mới' : 'Mật khẩu *'}<input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />{fieldErrors.password && <small className="field-error">{fieldErrors.password}</small>}</label>
        <label>Tên hiển thị *<input value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} />{fieldErrors.fullName && <small className="field-error">{fieldErrors.fullName}</small>}</label>
        <label>Vai trò *<select value={form.role} onChange={e => changeRole(e.target.value)}><option value="ADMIN">Admin</option><option value="BRANCH_DIRECTOR">Giám đốc cơ sở</option><option value="CARE_SHARED">Tài khoản CSV dùng chung</option></select></label>
        {form.role !== 'ADMIN' && <label>Cơ sở *<select value={form.branchId} onChange={e => { const b = branches.find(x => String(x.id) === String(e.target.value)); setForm(current => ({ ...current, branchId: e.target.value, branchName: b?.name || '' })); }}><option value="">-- Chọn cơ sở --</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>{fieldErrors.branchId && <small className="field-error">{fieldErrors.branchId}</small>}</label>}
      </div>

      {form.role === 'ADMIN' ? <div className="permission-section"><div className="permission-head"><div><h3>Admin</h3><p>Admin luôn có toàn quyền hệ thống. Không cần tick từng quyền.</p></div></div></div> :
      <div className="permission-section">
        <div className="permission-head"><div><h3>Quyền chi tiết</h3><p>Role chỉ là trần quyền; quyền thực tế là những ô đang được tick.</p></div><button type="button" className="secondary" onClick={() => setForm(current => ({ ...current, permissions: [...(ROLE_DEFAULTS[current.role] || [])] }))}>Khôi phục mặc định</button></div>
        <div className="permission-matrix">{PERMISSION_GROUPS.map(group => {
          const cap = new Set(ROLE_CAPS[form.role] || []);
          const keys = group.actions.map(action => `${group.module}.${action}`).filter(key => cap.has(key));
          if (!keys.length) return null;
          const allChecked = keys.every(key => form.permissions.includes(key));
          return <div className="permission-row" key={group.module}><label className="permission-module"><input type="checkbox" checked={allChecked} onChange={e => toggleModule(group, e.target.checked)} /><b>{group.label}</b></label><div>{group.actions.map(action => { const key = `${group.module}.${action}`; if (!cap.has(key)) return null; return <label className="permission-toggle" key={key}><input type="checkbox" checked={form.permissions.includes(key)} onChange={() => togglePermission(key)} />{ACTION_LABELS[action] || action}</label>; })}</div></div>;
        })}</div>
      </div>}

      <div className="actions"><button disabled={busy}>{busy ? 'Đang lưu tài khoản...' : editingId ? 'Lưu tài khoản & quyền' : 'Tạo tài khoản'}</button><button type="button" className="secondary" onClick={resetAccountEditor}>Hủy</button></div>
    </form>}

    {isAdmin && <div className="panel">
      <div className="permission-head"><div><h2>Tài khoản đăng nhập</h2><p>Mỗi cơ sở tối đa 1 Giám đốc hoạt động và 1 tài khoản CSV dùng chung hoạt động.</p></div></div>
      {loading ? <div className="page-loading"><div className="page-loading-card"><span className="loading-spinner"/><b>Đang tải tài khoản...</b></div></div> : <div className="table-wrap"><table><thead><tr><th>Tài khoản</th><th>Tên hiển thị</th><th>Vai trò</th><th>Cơ sở</th><th>Quyền</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
        {rows.map(x => <tr key={x.id}><td><b>{x.username}</b></td><td>{x.fullName}</td><td>{ROLE_LABEL[x.role] || x.role}</td><td>{x.role === 'ADMIN' ? 'Toàn hệ thống' : (x.branchName || '—')}</td><td>{x.role === 'ADMIN' ? <span className="status-pill on">Toàn quyền</span> : <span>{Array.isArray(x.permissions) ? x.permissions.length : 0} quyền</span>}</td><td><span className={`status-pill ${x.active ? 'on' : 'off'}`}>{x.active ? 'Hoạt động' : 'Đã khóa'}</span></td><td><div className="actions"><button className="secondary" onClick={() => startEditAccount(x)}>Sửa quyền</button>{x.active ? <button className="secondary" onClick={() => deactivate(x)}>Khóa</button> : <button onClick={() => activate(x)}>Mở khóa</button>}{!x.active && <button className="danger" onClick={() => removeAccount(x)}>Xóa</button>}</div></td></tr>)}
      </tbody></table></div>}
    </div>}
  </section>;
}
