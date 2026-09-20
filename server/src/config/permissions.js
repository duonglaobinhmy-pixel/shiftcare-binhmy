export const PERMISSION_GROUPS = Object.freeze([
  { module: 'DASHBOARD', label: 'Tổng quan', actions: ['VIEW'] },
  { module: 'SHIFT', label: 'Ca chăm sóc', actions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE'] },
  { module: 'CARE', label: 'Ghi nhận chăm sóc', actions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE'] },
  { module: 'HANDOVER', label: 'Bàn giao ca', actions: ['VIEW', 'SIGN', 'RECEIVE', 'OVERRIDE'] },
  { module: 'MEDICAL', label: 'Y khoa / y lệnh', actions: ['VIEW', 'CREATE', 'UPDATE', 'STOP', 'ADMINISTER', 'DELETE'] },
  { module: 'REPORT', label: 'Báo cáo', actions: ['VIEW', 'EXPORT'] },
  { module: 'AUDIT', label: 'Nhật ký hệ thống', actions: ['VIEW'] },
  { module: 'USER', label: 'Tài khoản & nhân sự', actions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE'] },
  { module: 'SYSTEM', label: 'Kết nối hệ thống', actions: ['VIEW', 'UPDATE'] },
]);

export const ALL_PERMISSIONS = Object.freeze(
  PERMISSION_GROUPS.flatMap(group => group.actions.map(action => `${group.module}.${action}`))
);

/**
 * Chỉ còn 3 loại tài khoản đăng nhập:
 * - ADMIN: toàn hệ thống.
 * - BRANCH_DIRECTOR: tài khoản giám đốc của một cơ sở.
 * - CARE_SHARED: tài khoản chăm sóc dùng chung tại một cơ sở/iPad.
 *
 * ROLE_CAPS là TRẦN quyền. Admin chỉ được tick quyền nằm trong trần này.
 * Quyền thực tế của Director / CARE_SHARED lấy từ user_permissions.
 */
export const ROLE_CAPS = Object.freeze({
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
});

export const DEFAULT_PERMISSIONS = Object.freeze({
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
});

export function sanitizePermissions(value, role) {
  if (role === 'ADMIN') return ['*'];
  const cap = new Set(ROLE_CAPS[role] || []);
  const source = Array.isArray(value) ? value : (DEFAULT_PERMISSIONS[role] || []);
  return [...new Set(source.filter(item => typeof item === 'string' && ALL_PERMISSIONS.includes(item) && cap.has(item)))];
}

export function normalizePermissions(user = {}) {
  if (user.role === 'ADMIN') return ['*'];
  return sanitizePermissions(user.permissions, user.role);
}

export function hasPermission(user, permission) {
  if (!user || !permission) return false;
  if (user.role === 'ADMIN') return true;
  const permissions = normalizePermissions(user);
  return permissions.includes(permission);
}
