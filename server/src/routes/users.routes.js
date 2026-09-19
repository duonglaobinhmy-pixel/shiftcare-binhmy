import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { authenticate, allowRoles, allowPermission } from '../middleware/auth.js';
import { getUsers, saveUsers, getStore, updateStore } from '../services/store.service.js';
import { audit } from '../services/audit.service.js';
import { CARE_BRANCH_MAP } from '../config/branches.js';
import { getResidents } from '../services/bcare.service.js';
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS } from '../config/permissions.js';
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

const VALID_ROLES = new Set(['ADMIN', 'BRANCH_DIRECTOR', 'MEDICAL', 'CAREGIVER']);

function sanitizePermissions(value, role) {
  if (!Array.isArray(value)) return [...(DEFAULT_PERMISSIONS[role] || [])].filter(x => x !== '*');
  return [...new Set(value.filter(x => ALL_PERMISSIONS.includes(x)))];
}

function isFullAccessAdmin(user) {
  return user.role === 'ADMIN' && (user.fullAccess === true || !Array.isArray(user.permissions));
}

function isBranchDirector(user) {
  return user.role === 'BRANCH_DIRECTOR';
}

function directorCanManage(actor, target) {
  return isBranchDirector(actor) && target && target.branchId === actor.branchId && ['CAREGIVER', 'MEDICAL'].includes(target.role);
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

async function areaExists(branchId, areaId) {
  if (!branchId || !areaId) return false;
  let page = 1, totalPage = 1;
  do {
    const r = await getResidents({ pageIndex: page, pageSize: 100, branchId, status: 1 });
    if ((r.items || []).some(x => x.areaId === areaId)) return true;
    totalPage = Number(r.totalPage || 1);
    page += 1;
  } while (page <= totalPage && page <= 20);
  return false;
}

router.get('/', allowPermission('USER.VIEW'), async (req, res) => {
  const all = await getUsers();
  const users = (req.user.role === 'ADMIN' ? all : all.filter(u => u.branchId === req.user.branchId && ['CAREGIVER', 'MEDICAL'].includes(u.role))).map(publicUser);
  res.json({ success: true, data: users });
});

router.post('/', allowPermission('USER.CREATE'), async (req, res) => {
  const users = await getUsers();
  const body = req.body || {};
  const role = body.role;
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const fullName = String(body.fullName || '').trim();
  const employeeCode = String(body.employeeCode || '').trim();

  if (!validUsername(username)) {
    return res.status(400).json({ success: false, message: 'Username phải 4–40 ký tự và chỉ dùng chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.' });
  }
  if (password.length < 8) return res.status(400).json({ success: false, message: 'Mật khẩu tối thiểu 8 ký tự.' });
  if (!fullName) return res.status(400).json({ success: false, message: 'Họ tên là bắt buộc.' });
  if (!VALID_ROLES.has(role)) return res.status(400).json({ success: false, message: 'Vai trò không hợp lệ.' });
  if (!validEmployeeCode(employeeCode)) return res.status(400).json({ success: false, message: 'Mã nhân viên là bắt buộc, tối đa 30 ký tự và chỉ dùng chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.' });
  if (isBranchDirector(req.user) && !['CAREGIVER', 'MEDICAL'].includes(role)) return res.status(403).json({ success: false, message: 'Giám đốc cơ sở chỉ được tạo nhân sự Chăm sóc viên hoặc Y khoa tại cơ sở mình.' });
  if (users.some(u => String(u.username).toLowerCase() === username.toLowerCase())) return res.status(409).json({ success: false, message: 'Username đã tồn tại.' });

  let branchId = null, branchName = 'Toàn hệ thống', areaId = null, areaName = '';
  if (role !== 'ADMIN') {
    branchId = isBranchDirector(req.user) ? String(req.user.branchId || '') : String(body.branchId || '');
    const branch = CARE_BRANCH_MAP[branchId];
    if (!branch) return res.status(400).json({ success: false, message: 'Cơ sở không hợp lệ. Phải chọn từ danh mục BCARE.' });
    branchName = branch.name;
  }
  if (role === 'CAREGIVER') {
    areaId = String(body.areaId || '');
    if (!areaId) return res.status(400).json({ success: false, message: 'Chăm sóc viên phải được gán khu phụ trách.' });
    try {
      const ok = await areaExists(branchId, areaId);
      if (!ok) return res.status(400).json({ success: false, message: 'Khu không thuộc cơ sở đã chọn hoặc không tồn tại trong dữ liệu BCARE.' });
      areaName = String(body.areaName || '');
    } catch (e) {
      return res.status(502).json({ success: false, message: `Không xác minh được khu từ BCARE: ${e.message}` });
    }
  }

  const fullAccess = role === 'ADMIN' && body.fullAccess === true;
  const permissions = fullAccess ? [] : (isBranchDirector(req.user) ? [...(DEFAULT_PERMISSIONS[role] || [])] : sanitizePermissions(body.permissions, role));
  if (users.some(u => u.branchId === branchId && String(u.employeeCode || '').toLowerCase() === employeeCode.toLowerCase())) return res.status(409).json({ success: false, message: 'Mã nhân viên đã tồn tại trong cơ sở.' });
  const user = { id: uuid(), username, password, employeeCode, fullName, role, branchId, branchName, areaId, areaName, fullAccess, permissions, active: true };
  users.push(user);
  await saveUsers(users);
  await audit(req.user, 'USER_CREATE', 'user', user.id, { username: user.username, role: user.role, branchId, areaId });
  res.status(201).json({ success: true, data: publicUser(user) });
});

router.patch('/:id', allowPermission('USER.UPDATE'), async (req, res) => {
  const users = await getUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, message: 'Không tìm thấy user' });
  const body = req.body || {};
  const current = users[idx];
  if (isBranchDirector(req.user) && !directorCanManage(req.user, current)) return res.status(403).json({ success: false, message: 'Bạn chỉ được sửa nhân sự Chăm sóc viên/Y khoa thuộc cơ sở mình.' });
  const nextRole = body.role || current.role;
  if (!VALID_ROLES.has(nextRole)) return res.status(400).json({ success: false, message: 'Vai trò không hợp lệ.' });
  if (isBranchDirector(req.user) && !['CAREGIVER', 'MEDICAL'].includes(nextRole)) return res.status(403).json({ success: false, message: 'Giám đốc cơ sở không được nâng vai trò nhân sự.' });
  if ('password' in body && body.password !== '' && String(body.password).length < 8) return res.status(400).json({ success: false, message: 'Mật khẩu tối thiểu 8 ký tự.' });

  const next = { ...current };
  if ('fullName' in body) next.fullName = String(body.fullName || '').trim();
  if (!next.fullName) return res.status(400).json({ success: false, message: 'Họ tên là bắt buộc.' });
  if ('employeeCode' in body) next.employeeCode = String(body.employeeCode || '').trim();
  if (!validEmployeeCode(next.employeeCode || next.username)) return res.status(400).json({ success: false, message: 'Mã nhân viên không hợp lệ.' });
  if (body.password) next.password = String(body.password);
  next.role = nextRole;
  next.fullAccess = nextRole === 'ADMIN' && body.fullAccess === true;
  next.permissions = next.fullAccess ? [] : (isBranchDirector(req.user) ? [...(DEFAULT_PERMISSIONS[nextRole] || [])] : sanitizePermissions(body.permissions, nextRole));

  if (nextRole === 'ADMIN') {
    next.branchId = null;
    next.branchName = 'Toàn hệ thống';
    next.areaId = null;
    next.areaName = '';
  } else {
    const branchId = isBranchDirector(req.user) ? String(req.user.branchId || '') : String(body.branchId ?? current.branchId ?? '');
    const branch = CARE_BRANCH_MAP[branchId];
    if (!branch) return res.status(400).json({ success: false, message: 'Cơ sở không hợp lệ.' });
    next.branchId = branchId;
    next.branchName = branch.name;
    next.areaId = null;
    next.areaName = '';
    if (nextRole === 'CAREGIVER') {
      const areaId = String(body.areaId ?? current.areaId ?? '');
      if (!areaId) return res.status(400).json({ success: false, message: 'Chăm sóc viên phải được gán khu phụ trách.' });
      try {
        if (!await areaExists(branchId, areaId)) return res.status(400).json({ success: false, message: 'Khu không thuộc cơ sở đã chọn.' });
      } catch (e) {
        return res.status(502).json({ success: false, message: `Không xác minh được khu từ BCARE: ${e.message}` });
      }
      next.areaId = areaId;
      next.areaName = String(body.areaName ?? current.areaName ?? '');
    }
  }

  if (users.some(u => u.id !== current.id && u.branchId === next.branchId && String(u.employeeCode || '').toLowerCase() === String(next.employeeCode || next.username).toLowerCase())) return res.status(409).json({ success: false, message: 'Mã nhân viên đã tồn tại trong cơ sở.' });
  next.employeeCode = next.employeeCode || next.username;

  if (current.id === req.user.sub && !isFullAccessAdmin(next)) {
    return res.status(422).json({ success: false, message: 'Không được tự gỡ quyền toàn hệ thống của tài khoản đang đăng nhập.' });
  }

  users[idx] = next;
  await saveUsers(users);
  await audit(req.user, 'USER_UPDATE', 'user', next.id, { username: next.username, role: next.role, permissions: next.permissions, fullAccess: next.fullAccess });
  res.json({ success: true, data: publicUser(next) });
});

// DELETE /:id = khóa tài khoản (soft-disable), giữ lịch sử/audit.
router.delete('/:id', allowPermission('USER.UPDATE'), async (req, res) => {
  const users = await getUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy user' });
  if (isBranchDirector(req.user) && !directorCanManage(req.user, user)) return res.status(403).json({ success: false, message: 'Bạn chỉ được khóa nhân sự thuộc cơ sở mình.' });
  if (user.id === req.user.sub) return res.status(422).json({ success: false, message: 'Không thể tự khóa tài khoản đang đăng nhập.' });
  user.active = false;
  user.deactivatedAt = new Date().toISOString();
  user.deactivatedBy = req.user.sub;
  await saveUsers(users);
  await audit(req.user, 'USER_DEACTIVATE', 'user', user.id, { username: user.username });
  res.json({ success: true });
});

router.post('/:id/activate', allowPermission('USER.UPDATE'), async (req, res) => {
  const users = await getUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy user' });
  if (isBranchDirector(req.user) && !directorCanManage(req.user, user)) return res.status(403).json({ success: false, message: 'Bạn chỉ được mở khóa nhân sự thuộc cơ sở mình.' });
  user.active = true;
  delete user.deactivatedAt;
  delete user.deactivatedBy;
  await saveUsers(users);
  await audit(req.user, 'USER_ACTIVATE', 'user', user.id, { username: user.username });
  res.json({ success: true, data: publicUser(user) });
});

// Xóa vĩnh viễn chỉ dành cho bản DEMO: bắt buộc tài khoản đã khóa + nhập lại username.
router.delete('/:id/permanent', allowPermission('USER.DELETE'), async (req, res) => {
  const users = await getUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, message: 'Không tìm thấy user' });
  const user = users[idx];
  if (isBranchDirector(req.user) && !directorCanManage(req.user, user)) return res.status(403).json({ success: false, message: 'Bạn chỉ được xóa nhân sự thuộc cơ sở mình.' });
  if (user.id === req.user.sub) return res.status(422).json({ success: false, message: 'Không thể tự xóa tài khoản đang đăng nhập.' });
  if (user.active) return res.status(422).json({ success: false, message: 'Phải khóa tài khoản trước khi xóa vĩnh viễn.' });
  if (req.body?.confirmUsername !== user.username) return res.status(422).json({ success: false, message: 'Xác nhận username không khớp.' });

  if (user.role === 'ADMIN') {
    const activeAdmins = users.filter(u => u.role === 'ADMIN' && u.active);
    if (activeAdmins.length < 1) return res.status(422).json({ success: false, message: 'Không thể xóa vì hệ thống phải còn ít nhất một Admin hoạt động.' });
  }

  users.splice(idx, 1);
  await saveUsers(users);
  await audit(req.user, 'USER_DELETE_PERMANENT', 'user', user.id, {
    username: user.username, role: user.role, branchId: user.branchId, areaId: user.areaId
  });
  res.json({ success: true });
});

export default router;
