import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const FALLBACK_GROUPS = [
  { module: 'DASHBOARD', label: 'Tổng quan', actions: ['VIEW'] },
  { module: 'SHIFT', label: 'Ca chăm sóc', actions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE'] },
  { module: 'CARE', label: 'Ghi nhận chăm sóc', actions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE'] },
  { module: 'HANDOVER', label: 'Bàn giao ca', actions: ['VIEW', 'SIGN', 'RECEIVE', 'OVERRIDE'] },
  { module: 'MEDICAL', label: 'Y khoa / y lệnh', actions: ['VIEW', 'CREATE', 'UPDATE', 'STOP', 'ADMINISTER', 'DELETE'] },
  { module: 'REPORT', label: 'Báo cáo', actions: ['VIEW', 'EXPORT'] },
  { module: 'AI_REPORT', label: 'AI báo cáo', actions: ['VIEW'] },
  { module: 'AUDIT', label: 'Nhật ký hệ thống', actions: ['VIEW'] },
  { module: 'USER', label: 'Tài khoản', actions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE'] },
  { module: 'SYSTEM', label: 'Kết nối hệ thống', actions: ['VIEW', 'UPDATE'] },
];

const FALLBACK_DEFAULTS = {
  ADMIN: ['*'],
  BRANCH_DIRECTOR: [
    'DASHBOARD.VIEW',
    'SHIFT.VIEW', 'SHIFT.CREATE', 'SHIFT.UPDATE',
    'CARE.VIEW', 'CARE.CREATE', 'CARE.UPDATE',
    'HANDOVER.VIEW', 'HANDOVER.SIGN', 'HANDOVER.RECEIVE',
    'MEDICAL.VIEW', 'MEDICAL.CREATE', 'MEDICAL.UPDATE', 'MEDICAL.STOP', 'MEDICAL.ADMINISTER',
    'REPORT.VIEW', 'REPORT.EXPORT',
    'AI_REPORT.VIEW', 'AUDIT.VIEW',
    'USER.VIEW', 'USER.CREATE', 'USER.UPDATE',
    'SYSTEM.VIEW',
  ],
  MEDICAL: [
    'DASHBOARD.VIEW', 'SHIFT.VIEW',
    'CARE.VIEW', 'CARE.CREATE', 'CARE.UPDATE',
    'HANDOVER.VIEW', 'HANDOVER.SIGN', 'HANDOVER.RECEIVE',
    'MEDICAL.VIEW', 'MEDICAL.CREATE', 'MEDICAL.UPDATE', 'MEDICAL.STOP', 'MEDICAL.ADMINISTER',
    'REPORT.VIEW',
  ],
  CAREGIVER: ['SHIFT.VIEW', 'CARE.VIEW', 'CARE.CREATE'],
};

const FALLBACK_CEILING = {
  ADMIN: ['*'],
  BRANCH_DIRECTOR: [
    'DASHBOARD.VIEW',
    'SHIFT.VIEW', 'SHIFT.CREATE', 'SHIFT.UPDATE', 'SHIFT.DELETE',
    'CARE.VIEW', 'CARE.CREATE', 'CARE.UPDATE', 'CARE.DELETE',
    'HANDOVER.VIEW', 'HANDOVER.SIGN', 'HANDOVER.RECEIVE',
    'MEDICAL.VIEW', 'MEDICAL.CREATE', 'MEDICAL.UPDATE', 'MEDICAL.STOP', 'MEDICAL.ADMINISTER', 'MEDICAL.DELETE',
    'REPORT.VIEW', 'REPORT.EXPORT', 'AI_REPORT.VIEW', 'AUDIT.VIEW',
    'USER.VIEW', 'USER.CREATE', 'USER.UPDATE', 'SYSTEM.VIEW',
  ],
  MEDICAL: [...FALLBACK_DEFAULTS.MEDICAL],
  CAREGIVER: [...FALLBACK_DEFAULTS.CAREGIVER],
};

const ROLE_LABEL = {
  ADMIN: 'Admin toàn hệ thống',
  BRANCH_DIRECTOR: 'Giám đốc cơ sở',
  MEDICAL: 'Nhân sự y khoa',
  CAREGIVER: 'Chăm sóc viên',
};

const ACTION_LABEL = {
  VIEW: 'Xem', CREATE: 'Thêm', UPDATE: 'Sửa', DELETE: 'Xóa',
  SIGN: 'Ký giao', RECEIVE: 'Ký nhận', OVERRIDE: 'Sửa sau bàn giao',
  STOP: 'Ngừng y lệnh', ADMINISTER: 'Thực hiện thuốc', EXPORT: 'Xuất file',
};

function initialForm(actor) {
  const branchLocked = actor?.role === 'BRANCH_DIRECTOR';
  return {
    username: '',
    password: 'Demo@123',
    employeeCode: '',
    fullName: '',
    role: 'CAREGIVER',
    branchId: branchLocked ? actor.branchId || '' : '',
    branchName: branchLocked ? actor.branchName || '' : '',
    areaId: '',
    areaName: '',
    permissions: [...FALLBACK_DEFAULTS.CAREGIVER],
  };
}

function uniq(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function LoadingBlock({ text = 'Đang tải dữ liệu...' }) {
  return (
    <div className="users-loading-block">
      <span className="users-spinner" />
      <span>{text}</span>
    </div>
  );
}

function PermissionEditor({ groups, role, permissions, ceiling, disabled, onChange }) {
  if (role === 'ADMIN') {
    return (
      <div className="permission-admin-note">
        <b>Admin có toàn quyền.</b>
        <span>Không thể bỏ quyền riêng lẻ của Admin.</span>
      </div>
    );
  }

  const selected = new Set(permissions || []);
  const allowed = new Set(ceiling || []);

  function toggle(permission) {
    if (disabled || !allowed.has(permission)) return;
    const next = new Set(selected);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    onChange?.([...next]);
  }

  function toggleModule(modulePermissions) {
    if (disabled) return;
    const editable = modulePermissions.filter(permission => allowed.has(permission));
    const allOn = editable.length > 0 && editable.every(permission => selected.has(permission));
    const next = new Set(selected);
    editable.forEach(permission => allOn ? next.delete(permission) : next.add(permission));
    onChange?.([...next]);
  }

  return (
    <div className="permission-editor">
      <div className="permission-editor-head">
        <div>
          <b>Quyền chi tiết</b>
          <small>Chỉ các ô không bị khóa mới được cấp cho vai trò này.</small>
        </div>
        <span>{selected.size} quyền đang chọn</span>
      </div>

      {groups.map(group => {
        const modulePermissions = group.actions.map(action => `${group.module}.${action}`);
        const editable = modulePermissions.filter(permission => allowed.has(permission));
        const moduleOn = editable.length > 0 && editable.every(permission => selected.has(permission));
        return (
          <div className="permission-edit-row" key={group.module}>
            <button
              type="button"
              className="permission-module-toggle"
              disabled={disabled || editable.length === 0}
              onClick={() => toggleModule(modulePermissions)}
            >
              <span className={`permission-module-check ${moduleOn ? 'on' : ''}`}>{moduleOn ? '✓' : ''}</span>
              <b>{group.label}</b>
            </button>

            <div className="permission-edit-actions">
              {group.actions.map(action => {
                const permission = `${group.module}.${action}`;
                const canAssign = allowed.has(permission);
                const checked = selected.has(permission);
                return (
                  <label
                    key={permission}
                    className={`${checked ? 'checked' : ''} ${!canAssign ? 'locked' : ''}`}
                    title={!canAssign ? 'Vai trò này không được cấp quyền này' : permission}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled || !canAssign}
                      onChange={() => toggle(permission)}
                    />
                    <span>{ACTION_LABEL[action] || action}</span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Users() {
  const { user, can } = useAuth();
  const [rows, setRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [areas, setAreas] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [form, setForm] = useState(() => initialForm(user));
  const [editingId, setEditingId] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [loading, setLoading] = useState(true);
  const [areasLoading, setAreasLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const [staffRows, setStaffRows] = useState([]);
  const [staffBranchId, setStaffBranchId] = useState(user?.role === 'BRANCH_DIRECTOR' ? user.branchId || '' : '');
  const [staffForm, setStaffForm] = useState({ employeeCode: '', fullName: '' });
  const [staffBusy, setStaffBusy] = useState(false);
  const staffFileRef = useRef(null);

  const groups = policy?.groups || FALLBACK_GROUPS;
  const rolePolicies = policy?.rolePolicies || {};
  const assignableRoles = policy?.assignableRoles || (user?.role === 'ADMIN'
    ? ['ADMIN', 'BRANCH_DIRECTOR', 'MEDICAL', 'CAREGIVER']
    : ['MEDICAL', 'CAREGIVER']);

  const selectedRolePolicy = rolePolicies[form.role] || {
    defaultPermissions: FALLBACK_DEFAULTS[form.role] || [],
    ceiling: FALLBACK_CEILING[form.role] || [],
  };

  const branch = useMemo(
    () => branches.find(item => String(item.id) === String(form.branchId)) || null,
    [branches, form.branchId]
  );

  async function loadPage() {
    setLoading(true);
    setErr('');
    try {
      const [usersResult, branchesResult, policyResult] = await Promise.all([
        api.users(),
        api.branches(),
        api.userPolicy().catch(() => ({ data: null })),
      ]);
      setRows(usersResult.data || []);
      setBranches(branchesResult.data || []);
      setPolicy(policyResult.data || null);
      if (user?.role === 'BRANCH_DIRECTOR') setStaffBranchId(user.branchId || '');
    } catch (error) {
      setErr(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPage(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!staffBranchId || !can('USER.VIEW')) {
      setStaffRows([]);
      return;
    }
    let cancelled = false;
    setStaffBusy(true);
    api.staff(staffBranchId)
      .then(result => { if (!cancelled) setStaffRows(result.data || []); })
      .catch(error => { if (!cancelled) setErr(error.message); })
      .finally(() => { if (!cancelled) setStaffBusy(false); });
    return () => { cancelled = true; };
  }, [staffBranchId, can]);

  useEffect(() => {
    if (form.role === 'ADMIN' || !form.branchId) {
      setAreas([]);
      return;
    }
    let cancelled = false;
    setAreasLoading(true);
    api.locations(form.branchId)
      .then(result => { if (!cancelled) setAreas(result.data?.areas || []); })
      .catch(error => { if (!cancelled) setErr(error.message); })
      .finally(() => { if (!cancelled) setAreasLoading(false); });
    return () => { cancelled = true; };
  }, [form.branchId, form.role]);

  function defaultsForRole(role) {
    return [...(rolePolicies?.[role]?.defaultPermissions || FALLBACK_DEFAULTS[role] || [])].filter(p => p !== '*');
  }

  function ceilingForRole(role) {
    return [...(rolePolicies?.[role]?.ceiling || FALLBACK_CEILING[role] || [])].filter(p => p !== '*');
  }

  function openCreate() {
    const next = initialForm(user);
    next.permissions = defaultsForRole(next.role);
    setEditingId(null);
    setForm(next);
    setShowEditor(true);
    setErr('');
    setOk('');
  }

  function openEdit(row) {
    setEditingId(row.id);
    setForm({
      username: row.username || '',
      password: '',
      employeeCode: row.employeeCode || row.username || '',
      fullName: row.fullName || '',
      role: row.role || 'CAREGIVER',
      branchId: row.branchId || '',
      branchName: row.branchName || '',
      areaId: row.areaId || '',
      areaName: row.areaName || '',
      permissions: Array.isArray(row.permissions) ? [...row.permissions] : defaultsForRole(row.role),
    });
    setShowEditor(true);
    setErr('');
    setOk('');
  }

  function changeRole(role) {
    const director = user?.role === 'BRANCH_DIRECTOR';
    setForm(current => ({
      ...current,
      role,
      branchId: role === 'ADMIN' ? '' : (director ? user.branchId || '' : current.branchId),
      branchName: role === 'ADMIN' ? '' : (director ? user.branchName || '' : current.branchName),
      areaId: '',
      areaName: '',
      permissions: defaultsForRole(role),
    }));
  }

  async function saveAccount(event) {
    event.preventDefault();
    if (saving) return;
    setErr('');
    setOk('');

    if (!form.fullName.trim()) return setErr('Cần nhập họ tên.');
    if (!form.employeeCode.trim()) return setErr('Cần nhập mã nhân viên.');
    if (!editingId && !form.username.trim()) return setErr('Cần nhập username.');
    if (!editingId && form.password.length < 8) return setErr('Mật khẩu tối thiểu 8 ký tự.');
    if (form.role !== 'ADMIN' && !form.branchId) return setErr('Cần chọn cơ sở.');

    setSaving(true);
    try {
      const area = areas.find(item => String(item.id) === String(form.areaId));
      const payload = {
        ...form,
        username: form.username.trim(),
        employeeCode: form.employeeCode.trim(),
        fullName: form.fullName.trim(),
        branchName: form.role === 'ADMIN' ? '' : (branch?.name || form.branchName || ''),
        areaName: form.role === 'CAREGIVER' ? (area?.name || form.areaName || '') : '',
        permissions: form.role === 'ADMIN'
          ? ['*']
          : uniq(form.permissions).filter(permission => ceilingForRole(form.role).includes(permission)),
        fullAccess: form.role === 'ADMIN',
      };

      if (editingId) {
        if (!payload.password) delete payload.password;
        await api.updateUser(editingId, payload);
        setOk('Đã cập nhật tài khoản và quyền.');
      } else {
        await api.createUser(payload);
        setOk('Đã tạo tài khoản mới.');
      }

      setShowEditor(false);
      setEditingId(null);
      setForm(initialForm(user));
      await loadPage();
    } catch (error) {
      setErr(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row) {
    setErr('');
    try {
      if (row.active === false) {
        if (!confirm(`Mở khóa tài khoản “${row.username}”?`)) return;
        await api.activateUser(row.id);
      } else {
        if (!confirm(`Khóa tài khoản “${row.username}”?`)) return;
        await api.deactivateUser(row.id);
      }
      await loadPage();
    } catch (error) { setErr(error.message); }
  }

  async function addStaff(event) {
    event.preventDefault();
    if (staffBusy) return;
    setErr('');
    if (!staffBranchId || !staffForm.employeeCode.trim() || !staffForm.fullName.trim()) {
      return setErr('Cần chọn cơ sở, mã nhân viên và họ tên.');
    }
    setStaffBusy(true);
    try {
      await api.createStaff({ branchId: staffBranchId, employeeCode: staffForm.employeeCode.trim(), fullName: staffForm.fullName.trim() });
      setStaffForm({ employeeCode: '', fullName: '' });
      const result = await api.staff(staffBranchId);
      setStaffRows(result.data || []);
    } catch (error) { setErr(error.message); }
    finally { setStaffBusy(false); }
  }

  async function importStaffFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) return setErr('Chỉ nhận file Excel .xlsx.');
    if (!staffBranchId) return setErr('Hãy chọn cơ sở trước khi tải Excel.');
    setStaffBusy(true);
    setErr('');
    try {
      const fileBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api.importStaff({ branchId: staffBranchId, fileBase64, fileName: file.name });
      const result = await api.staff(staffBranchId);
      setStaffRows(result.data || []);
    } catch (error) { setErr(error.message); }
    finally { setStaffBusy(false); }
  }

  async function editStaff(row) {
    const employeeCode = prompt('Mã nhân viên:', row.employeeCode || '');
    if (employeeCode == null) return;
    const fullName = prompt('Họ tên:', row.fullName || '');
    if (fullName == null) return;
    setStaffBusy(true);
    try {
      await api.updateStaff(row.id, { employeeCode: employeeCode.trim(), fullName: fullName.trim() });
      const result = await api.staff(staffBranchId);
      setStaffRows(result.data || []);
    } catch (error) { setErr(error.message); }
    finally { setStaffBusy(false); }
  }

  async function deleteStaff(row) {
    const reason = prompt(`Lý do đưa ${row.fullName} khỏi danh bạ phân ca:`);
    if (!reason?.trim()) return;
    setStaffBusy(true);
    try {
      await api.deleteStaff(row.id, reason.trim());
      const result = await api.staff(staffBranchId);
      setStaffRows(result.data || []);
    } catch (error) { setErr(error.message); }
    finally { setStaffBusy(false); }
  }

  if (loading) {
    return <section className="accounts-page"><LoadingBlock text="Đang tải tài khoản, cơ sở và chính sách quyền..." /></section>;
  }

  return (
    <section className="accounts-page">
      <header className="page-head accounts-head">
        <div>
          <h1>Tài khoản & phân quyền</h1>
          <p>Admin cấp quyền chi tiết bằng checkbox. Server vẫn giới hạn quyền tối đa theo vai trò và phạm vi cơ sở.</p>
        </div>
        {can('USER.CREATE') && <button type="button" onClick={openCreate}>+ Tạo tài khoản</button>}
      </header>

      {err && <div className="error account-message">{err}</div>}
      {ok && <div className="success account-message">{ok}</div>}

      <div className="access-hierarchy">
        <div className="access-card admin"><span>01</span><div><b>ADMIN</b><strong>Toàn hệ thống</strong><small>Full quyền, tất cả cơ sở và cấu hình.</small></div></div>
        <div className="hierarchy-arrow">→</div>
        <div className="access-card director"><span>02</span><div><b>GIÁM ĐỐC CƠ SỞ</b><strong>Quyền được Admin tick</strong><small>Chỉ hiệu lực trong đúng cơ sở; không thể vượt trần quyền của Director.</small></div></div>
        <div className="hierarchy-arrow">→</div>
        <div className="access-card caregiver"><span>03</span><div><b>NHÂN SỰ</b><strong>Y khoa / Chăm sóc viên</strong><small>Quyền tối thiểu theo nghiệp vụ và khu được phân công.</small></div></div>
      </div>

      {showEditor && (
        <form className="panel account-editor" onSubmit={saveAccount}>
          {saving && <div className="account-saving-overlay"><div><span className="users-spinner" /><b>{editingId ? 'Đang cập nhật tài khoản...' : 'Đang tạo tài khoản...'}</b><small>Đang gọi API, vui lòng không bấm lại.</small></div></div>}

          <div className="panel-title">
            <div><h2>{editingId ? 'Sửa tài khoản' : 'Tạo tài khoản mới'}</h2><p>Thông tin đăng nhập, phạm vi dữ liệu và quyền được lưu cùng tài khoản.</p></div>
            <button type="button" className="secondary" disabled={saving} onClick={() => setShowEditor(false)}>Đóng</button>
          </div>

          <div className="account-form-grid">
            <label>Vai trò
              <select value={form.role} disabled={saving || !!editingId && form.role === 'ADMIN' && user?.role !== 'ADMIN'} onChange={e => changeRole(e.target.value)}>
                {assignableRoles.map(role => <option key={role} value={role}>{ROLE_LABEL[role] || role}</option>)}
              </select>
            </label>

            <label>Username
              <input value={form.username} disabled={saving || !!editingId} onChange={e => setForm(v => ({ ...v, username: e.target.value }))} placeholder="vd: csv.nguyentuan" />
            </label>

            <label>Mật khẩu
              <input type="password" value={form.password} disabled={saving} onChange={e => setForm(v => ({ ...v, password: e.target.value }))} placeholder={editingId ? 'Để trống nếu không đổi' : 'Tối thiểu 8 ký tự'} />
            </label>

            <label>Mã nhân viên
              <input value={form.employeeCode} disabled={saving} onChange={e => setForm(v => ({ ...v, employeeCode: e.target.value }))} />
            </label>

            <label>Họ tên
              <input value={form.fullName} disabled={saving} onChange={e => setForm(v => ({ ...v, fullName: e.target.value }))} />
            </label>

            {form.role !== 'ADMIN' && (
              <label>Cơ sở
                <select value={form.branchId} disabled={saving || user?.role === 'BRANCH_DIRECTOR'} onChange={e => setForm(v => ({ ...v, branchId: e.target.value, branchName: branches.find(x => String(x.id) === String(e.target.value))?.name || '', areaId: '', areaName: '' }))}>
                  <option value="">Chọn cơ sở</option>
                  {branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )}

            {form.role === 'CAREGIVER' && (
              <label>Khu phụ trách
                <select value={form.areaId} disabled={saving || areasLoading} onChange={e => setForm(v => ({ ...v, areaId: e.target.value, areaName: areas.find(x => String(x.id) === String(e.target.value))?.name || '' }))}>
                  <option value="">{areasLoading ? 'Đang tải khu...' : 'Chọn khu'}</option>
                  {areas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )}
          </div>

          <PermissionEditor
            groups={groups}
            role={form.role}
            permissions={form.permissions}
            ceiling={ceilingForRole(form.role)}
            disabled={saving || form.role === 'ADMIN'}
            onChange={permissions => setForm(v => ({ ...v, permissions }))}
          />

          <div className="account-editor-actions">
            <button type="submit" disabled={saving}>{saving ? 'Đang lưu...' : (editingId ? 'Lưu thay đổi' : 'Tạo tài khoản')}</button>
            <button type="button" className="secondary" disabled={saving || form.role === 'ADMIN'} onClick={() => setForm(v => ({ ...v, permissions: defaultsForRole(v.role) }))}>Khôi phục quyền mặc định</button>
          </div>
        </form>
      )}

      <div className="panel accounts-list-panel">
        <div className="panel-title"><div><h2>Danh sách tài khoản</h2><p>{rows.length} tài khoản trong phạm vi hiện tại</p></div></div>
        <div className="account-table-wrap">
          <table className="account-table">
            <thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Phạm vi</th><th>Quyền</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td><b>{row.fullName || row.username}</b><small>{row.username} • {row.employeeCode || '—'}</small></td>
                  <td>{ROLE_LABEL[row.role] || row.role}</td>
                  <td>{row.role === 'ADMIN' ? 'Toàn hệ thống' : [row.branchName, row.areaName].filter(Boolean).join(' • ') || '—'}</td>
                  <td><span className="permission-count-badge">{row.role === 'ADMIN' ? 'FULL' : `${Array.isArray(row.permissions) ? row.permissions.length : 0} quyền`}</span></td>
                  <td><span className={`status-pill ${row.active === false ? 'off' : 'on'}`}>{row.active === false ? 'Đã khóa' : 'Đang hoạt động'}</span></td>
                  <td className="account-row-actions">
                    {can('USER.UPDATE') && <button type="button" className="secondary" onClick={() => openEdit(row)}>Sửa</button>}
                    {can('USER.UPDATE') && row.id !== user?.sub && <button type="button" className="secondary" onClick={() => toggleActive(row)}>{row.active === false ? 'Mở khóa' : 'Khóa'}</button>}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan="6" className="empty-cell">Chưa có tài khoản trong phạm vi này.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {can('USER.VIEW') && (
        <div className="panel staff-directory-panel">
          <div className="panel-title"><div><h2>Danh bạ nhân sự phân ca</h2><p>Danh sách này dùng khi chọn 2–3 nhân sự trong ca.</p></div></div>

          {user?.role === 'ADMIN' && (
            <label className="staff-branch-picker">Cơ sở
              <select value={staffBranchId} onChange={e => setStaffBranchId(e.target.value)}>
                <option value="">Chọn cơ sở</option>
                {branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          )}

          {can('USER.CREATE') && staffBranchId && (
            <form className="staff-add-form" onSubmit={addStaff}>
              <input value={staffForm.employeeCode} disabled={staffBusy} onChange={e => setStaffForm(v => ({ ...v, employeeCode: e.target.value }))} placeholder="Mã nhân viên" />
              <input value={staffForm.fullName} disabled={staffBusy} onChange={e => setStaffForm(v => ({ ...v, fullName: e.target.value }))} placeholder="Họ tên" />
              <button type="submit" disabled={staffBusy}>{staffBusy ? 'Đang lưu...' : '+ Thêm nhân viên'}</button>
              <button type="button" className="secondary" disabled={staffBusy} onClick={() => staffFileRef.current?.click()}>Import Excel</button>
              <input ref={staffFileRef} type="file" accept=".xlsx" hidden onChange={importStaffFile} />
            </form>
          )}

          {staffBusy && <LoadingBlock text="Đang xử lý danh sách nhân sự..." />}
          {!staffBusy && staffBranchId && (
            <div className="staff-grid">
              {staffRows.map(row => (
                <div className="staff-card" key={row.id}>
                  <div><b>{row.fullName}</b><small>{row.employeeCode}</small></div>
                  {can('USER.UPDATE') && <div><button type="button" className="secondary" onClick={() => editStaff(row)}>Sửa</button><button type="button" className="secondary danger" onClick={() => deleteStaff(row)}>Xóa</button></div>}
                </div>
              ))}
              {!staffRows.length && <div className="empty-state">Cơ sở chưa có nhân sự trong danh bạ phân ca.</div>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
