import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { authenticate, allowRoles, allowPermission } from '../middleware/auth.js';
import { getUsers, saveUsers, getStore, updateStore } from '../services/store.service.js';
import { audit } from '../services/audit.service.js';
import { CARE_BRANCH_MAP } from '../config/branches.js';
import { DEFAULT_PERMISSIONS, sanitizePermissions } from '../config/permissions.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const router = Router();
router.use(authenticate, allowRoles('ADMIN', 'BRANCH_DIRECTOR'));
const execFileAsync = promisify(execFile);

function publicUser(u) {
  const { password, ...safe } = u;
  return safe;
}

function validUsername(v) {
  return /^[A-Za-z0-9._-]{4,40}$/.test(String(v || '').trim());
}

function validEmployeeCode(v) {
  return /^[A-Za-z0-9._-]{1,30}$/.test(String(v || '').trim());
}

const VALID_ROLES = new Set(['ADMIN', 'BRANCH_DIRECTOR', 'CARE_SHARED']);

function isBranchDirector(user) {
  return user.role === 'BRANCH_DIRECTOR';
}

function staffScope(actor, row) {
  return actor.role === 'ADMIN' || String(row?.branchId || '') === String(actor.branchId || '');
}

function validStaffPayload(body) {
  const employeeCode = String(body.employeeCode || '').trim();
  const fullName = String(body.fullName || '').trim();
  if (!validEmployeeCode(employeeCode)) throw new Error('Mã nhân viên là bắt buộc, tối đa 30 ký tự và chỉ dùng chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.');
  if (!fullName) throw new Error('Họ tên nhân viên là bắt buộc.');
  return { employeeCode, fullName };
}

function xmlText(value = '') {
  return String(value).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function parseEmployeeWorkbook(fileBase64) {
  const tempPath = path.join(os.tmpdir(), `bcare-staff-${uuid()}.xlsx`);
  try {
    const buffer = Buffer.from(String(fileBase64 || '').replace(/^data:.*?;base64,/, ''), 'base64');
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw new Error('File Excel phải có dung lượng tối đa 5 MB.');
    await fs.writeFile(tempPath, buffer);
    const readEntry = async entry => { try { return (await execFileAsync('unzip', ['-p', tempPath, entry], { maxBuffer: 12 * 1024 * 1024 })).stdout; } catch { return ''; } };
    const sharedXml = await readEntry('xl/sharedStrings.xml');
    const shared = [...sharedXml.matchAll(/<si[\s\S]*?<\/si>/g)].map(m => xmlText([...m[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
    const sheetXml = await readEntry('xl/worksheets/sheet1.xml');
    const rows = [];
    for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const values = [];
      for (const cell of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cell[1], body = cell[2], ref = attrs.match(/\br="([A-Z]+)\d+"/i)?.[1] || '';
        const col = ref ? ref.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1 : values.length;
        const type = attrs.match(/\bt="([^"]+)"/)?.[1]; const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '';
        values[col] = xmlText(type === 's' ? (shared[Number(raw)] || '') : raw);
      }
      rows.push(values);
    }
    const headerIndex = rows.findIndex(row => row.some(x => String(x || '').trim().toLowerCase().includes('mã nhân viên')) && row.some(x => String(x || '').trim().toLowerCase().includes('họ và tên')));
    if (headerIndex < 0) throw new Error('Không tìm thấy dòng tiêu đề Mã nhân viên và Họ và tên trong Excel.');
    const headers = rows[headerIndex].map(x => String(x || '').trim().toLowerCase());
    const codeIndex = headers.findIndex(x => x.includes('mã nhân viên')); const nameIndex = headers.findIndex(x => x.includes('họ và tên'));
    return rows.slice(headerIndex + 1).map(row => ({ employeeCode: String(row[codeIndex] || '').trim(), fullName: String(row[nameIndex] || '').trim() })).filter(x => x.employeeCode && x.fullName);
  } finally { await fs.rm(tempPath, { force: true }).catch(() => {}); }
}

router.get('/staff', allowPermission('USER.VIEW'), async (req, res) => {
  const branchId = req.user.role === 'ADMIN' ? String(req.query.branchId || '') : String(req.user.branchId || '');
  if (!branchId) return res.status(400).json({ success: false, message: 'Vui lòng chọn cơ sở.' });
  const store = await getStore();
  const rows = (store.staffMembers || []).filter(x => String(x.branchId) === String(branchId) && !x.deleted).map(x=>({...x,active:x.active!==false})).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), 'vi'));
  res.json({ success: true, data: rows });
});

router.post('/staff', allowPermission('USER.CREATE'), async (req, res) => {
  try {
    const { employeeCode, fullName } = validStaffPayload(req.body || {});
    const branchId = req.user.role === 'ADMIN' ? String(req.body?.branchId || '') : String(req.user.branchId || '');
    const branch = CARE_BRANCH_MAP[branchId];
    if (!branch) return res.status(400).json({ success: false, message: 'Cơ sở không hợp lệ.' });
    const store = await getStore();
    if ((store.staffMembers || []).some(x => !x.deleted && x.branchId === branchId && String(x.employeeCode).toLowerCase() === employeeCode.toLowerCase())) return res.status(409).json({ success: false, message: 'Mã nhân viên đã tồn tại trong danh sách cơ sở.' });
    const row = { id: uuid(), employeeCode, fullName, branchId, branchName: branch.name, active: true, createdBy: req.user.sub, createdAt: new Date().toISOString() };
    await updateStore(next => { next.staffMembers = next.staffMembers || []; next.staffMembers.unshift(row); });
    await audit(req.user, 'STAFF_DIRECTORY_CREATE', 'staff_member', row.id, { employeeCode, fullName, branchId });
    res.status(201).json({ success: true, data: row });
  } catch (e) { res.status(400).json({ success: false, message: e.message }); }
});

router.post('/staff/import', allowPermission('USER.CREATE'), async (req, res) => {
  try {
    const branchId = req.user.role === 'ADMIN' ? String(req.body?.branchId || '') : String(req.user.branchId || '');
    const branch = CARE_BRANCH_MAP[branchId]; if (!branch) return res.status(400).json({ success: false, message: 'Cơ sở không hợp lệ.' });
    const rows = await parseEmployeeWorkbook(req.body?.fileBase64); if (!rows.length) return res.status(422).json({ success: false, message: 'Excel không có dòng nhân viên hợp lệ.' });
    const store = await getStore(); store.staffMembers = store.staffMembers || [];
    const existing = new Set(store.staffMembers.filter(x => !x.deleted && x.branchId === branchId).map(x => String(x.employeeCode).toLowerCase()));
    const seen = new Set(); const imported = []; const skipped = [];
    for (const item of rows) {
      const code = item.employeeCode.toLowerCase(); if (seen.has(code) || existing.has(code)) { skipped.push(item); continue; }
      seen.add(code); const row = { id: uuid(), employeeCode: item.employeeCode, fullName: item.fullName, branchId, branchName: branch.name, active: true, createdBy: req.user.sub, createdAt: new Date().toISOString() }; store.staffMembers.unshift(row); imported.push(row);
    }
    await updateStore(next => { next.staffMembers = store.staffMembers; });
    await audit(req.user, 'STAFF_DIRECTORY_IMPORT', 'staff_member', branchId, { imported: imported.length, skipped: skipped.length, fileName: req.body?.fileName || '' });
    res.status(201).json({ success: true, data: { imported, importedCount: imported.length, skippedCount: skipped.length, totalRows: rows.length } });
  } catch (e) { res.status(400).json({ success: false, message: `Không thể đọc Excel: ${e.message}` }); }
});

router.patch('/staff/:id', allowPermission('USER.UPDATE'), async (req, res) => {
  const body = req.body || {};let found = null;
  let store = await getStore(); found = (store.staffMembers || []).find(x => x.id === req.params.id && !x.deleted);
  if (!found || !staffScope(req.user, found)) return res.status(404).json({ success: false, message: 'Không tìm thấy nhân viên trong cơ sở.' });
  let payload; try { payload = validStaffPayload({ employeeCode: body.employeeCode ?? found.employeeCode, fullName: body.fullName ?? found.fullName }); } catch (e) { return res.status(400).json({ success: false, message: e.message }); }
  if ((store.staffMembers || []).some(x => x.id !== found.id && !x.deleted && x.branchId === found.branchId && String(x.employeeCode).toLowerCase() === payload.employeeCode.toLowerCase())) return res.status(409).json({ success: false, message: 'Mã nhân viên đã tồn tại trong danh sách cơ sở.' });
  await updateStore(next => { const row = next.staffMembers.find(x => x.id === found.id); Object.assign(row, payload, { active: body.active===undefined ? row.active!==false : body.active!==false, updatedBy: req.user.sub, updatedAt: new Date().toISOString() }); });
  await audit(req.user, 'STAFF_DIRECTORY_UPDATE', 'staff_member', found.id, payload);res.json({ success: true, data: { ...found, ...payload } });
});

router.delete('/staff/:id', allowPermission('USER.DELETE'), async (req, res) => {
  const reason = String(req.body?.reason || '').trim(); if (!reason) return res.status(422).json({ success: false, message: 'Cần nhập lý do xóa nhân viên.' });
  const store = await getStore(); const found = (store.staffMembers || []).find(x => x.id === req.params.id && !x.deleted);
  if (!found || !staffScope(req.user, found)) return res.status(404).json({ success: false, message: 'Không tìm thấy nhân viên trong cơ sở.' });
  await updateStore(next => { const row = next.staffMembers.find(x => x.id === found.id); row.deleted = true; row.deletedAt = new Date().toISOString(); row.deletedBy = req.user.sub; row.deleteReason = reason; });
  await audit(req.user, 'STAFF_DIRECTORY_DELETE', 'staff_member', found.id, { reason, employeeCode: found.employeeCode, fullName: found.fullName });res.json({ success: true });
});


router.get('/', allowPermission('USER.VIEW'), async (req, res) => {
  const all = await getUsers();
  const scoped = req.user.role === 'ADMIN'
    ? all
    : all.filter(u => String(u.branchId || '') === String(req.user.branchId || ''));
  res.json({ success: true, data: scoped.map(publicUser) });
});

function validateAccountInput(body, current = null) {
  const role = String(body.role ?? current?.role ?? '').trim();
  const username = String(body.username ?? current?.username ?? '').trim();
  const fullName = String(body.fullName ?? current?.fullName ?? '').trim();
  const password = body.password === undefined ? undefined : String(body.password || '');
  if (!VALID_ROLES.has(role)) throw new Error('Vai trò không hợp lệ.');
  if (!validUsername(username)) throw new Error('Username phải 4–40 ký tự và chỉ dùng chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.');
  if (!fullName) throw new Error('Tên hiển thị là bắt buộc.');
  if (!current && (!password || password.length < 8)) throw new Error('Mật khẩu tối thiểu 8 ký tự.');
  if (current && password && password.length < 8) throw new Error('Mật khẩu tối thiểu 8 ký tự.');
  return { role, username, fullName, password };
}

function resolveAccountBranch(role, body, current = null) {
  if (role === 'ADMIN') return { branchId: null, branchName: 'Toàn hệ thống' };
  const branchId = String(body.branchId ?? current?.branchId ?? '').trim();
  const branch = CARE_BRANCH_MAP[branchId];
  if (!branch) throw new Error('Giám đốc cơ sở và tài khoản CSV bắt buộc phải chọn một cơ sở BCARE hợp lệ.');
  return { branchId, branchName: branch.name };
}

function duplicateBranchRole(users, role, branchId, excludeId = null) {
  if (!['BRANCH_DIRECTOR', 'CARE_SHARED'].includes(role)) return false;
  return users.some(u => u.id !== excludeId && u.active !== false && u.role === role && String(u.branchId || '') === String(branchId || ''));
}

router.post('/', allowPermission('USER.CREATE'), async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Chỉ Admin được tạo tài khoản đăng nhập.' });
  try {
    const users = await getUsers();
    const body = req.body || {};
    const { role, username, fullName, password } = validateAccountInput(body);
    if (users.some(u => String(u.username).toLowerCase() === username.toLowerCase())) {
      return res.status(409).json({ success: false, message: 'Username đã tồn tại.' });
    }
    const { branchId, branchName } = resolveAccountBranch(role, body);
    if (duplicateBranchRole(users, role, branchId)) {
      const label = role === 'BRANCH_DIRECTOR' ? 'Giám đốc cơ sở' : 'tài khoản CSV dùng chung';
      return res.status(409).json({ success: false, message: `Cơ sở này đã có ${label} đang hoạt động.` });
    }
    const permissions = role === 'ADMIN' ? [] : sanitizePermissions(body.permissions, role);
    const user = {
      id: uuid(), username, password, employeeCode: null, fullName, role,
      branchId, branchName, areaId: null, areaName: '', permissions, active: true,
    };
    users.push(user);
    await saveUsers(users);
    await audit(req.user, 'USER_CREATE', 'user', user.id, { username, role, branchId, permissions });
    res.status(201).json({ success: true, data: publicUser(user) });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

router.patch('/:id', allowPermission('USER.UPDATE'), async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Chỉ Admin được sửa tài khoản đăng nhập.' });
  try {
    const users = await getUsers();
    const idx = users.findIndex(u => String(u.id) === String(req.params.id));
    if (idx < 0) return res.status(404).json({ success: false, message: 'Không tìm thấy user.' });
    const current = users[idx];
    const body = req.body || {};
    const { role, username, fullName, password } = validateAccountInput(body, current);
    if (users.some(u => u.id !== current.id && String(u.username).toLowerCase() === username.toLowerCase())) {
      return res.status(409).json({ success: false, message: 'Username đã tồn tại.' });
    }
    const { branchId, branchName } = resolveAccountBranch(role, body, current);
    if (duplicateBranchRole(users, role, branchId, current.id)) {
      const label = role === 'BRANCH_DIRECTOR' ? 'Giám đốc cơ sở' : 'tài khoản CSV dùng chung';
      return res.status(409).json({ success: false, message: `Cơ sở này đã có ${label} đang hoạt động.` });
    }
    const next = {
      ...current,
      username,
      fullName,
      role,
      branchId,
      branchName,
      areaId: null,
      areaName: '',
      employeeCode: null,
      permissions: role === 'ADMIN' ? [] : sanitizePermissions(body.permissions, role),
    };
    if (password) next.password = password;
    users[idx] = next;
    await saveUsers(users);
    await audit(req.user, 'USER_UPDATE', 'user', next.id, { username, role, branchId, permissions: next.permissions });
    res.json({ success: true, data: publicUser(next) });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

router.delete('/:id', allowPermission('USER.UPDATE'), async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Chỉ Admin được khóa tài khoản.' });
  const users = await getUsers();
  const user = users.find(u => String(u.id) === String(req.params.id));
  if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy user.' });
  if (user.id === req.user.sub) return res.status(422).json({ success: false, message: 'Không thể tự khóa tài khoản đang đăng nhập.' });
  user.active = false;
  user.deactivatedAt = new Date().toISOString();
  user.deactivatedBy = req.user.sub;
  await saveUsers(users);
  await audit(req.user, 'USER_DEACTIVATE', 'user', user.id, { username: user.username });
  res.json({ success: true });
});

router.post('/:id/activate', allowPermission('USER.UPDATE'), async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Chỉ Admin được mở khóa tài khoản.' });
  const users = await getUsers();
  const user = users.find(u => String(u.id) === String(req.params.id));
  if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy user.' });
  if (duplicateBranchRole(users, user.role, user.branchId, user.id)) {
    return res.status(409).json({ success: false, message: 'Cơ sở đã có tài khoản cùng vai trò đang hoạt động.' });
  }
  user.active = true;
  delete user.deactivatedAt;
  delete user.deactivatedBy;
  await saveUsers(users);
  await audit(req.user, 'USER_ACTIVATE', 'user', user.id, { username: user.username });
  res.json({ success: true, data: publicUser(user) });
});

router.delete('/:id/permanent', allowPermission('USER.DELETE'), async (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Chỉ Admin được xóa vĩnh viễn tài khoản.' });
  const users = await getUsers();
  const idx = users.findIndex(u => String(u.id) === String(req.params.id));
  if (idx < 0) return res.status(404).json({ success: false, message: 'Không tìm thấy user.' });
  const user = users[idx];
  if (user.id === req.user.sub) return res.status(422).json({ success: false, message: 'Không thể tự xóa tài khoản đang đăng nhập.' });
  if (user.active) return res.status(422).json({ success: false, message: 'Phải khóa tài khoản trước khi xóa vĩnh viễn.' });
  if (String(req.body?.confirmUsername || '') !== user.username) return res.status(422).json({ success: false, message: 'Xác nhận username không khớp.' });
  if (user.role === 'ADMIN' && users.filter(u => u.role === 'ADMIN' && u.active !== false && u.id !== user.id).length < 1) {
    return res.status(422).json({ success: false, message: 'Hệ thống phải còn ít nhất một Admin hoạt động.' });
  }
  users.splice(idx, 1);
  await saveUsers(users);
  await audit(req.user, 'USER_DELETE_PERMANENT', 'user', user.id, { username: user.username, role: user.role, branchId: user.branchId });
  res.json({ success: true });
});

export default router;
