export const PERMISSION_GROUPS = Object.freeze([
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
]);

export const ALL_PERMISSIONS = Object.freeze(
  PERMISSION_GROUPS.flatMap(group =>
    group.actions.map(action => `${group.module}.${action}`)
  )
);

/*
 * DEFAULT = quyền khởi tạo khi tạo tài khoản mới.
 * Đây KHÔNG phải quyền cố định. Admin có thể tick/bỏ tick trong giới hạn CEILING.
 */
export const DEFAULT_PERMISSIONS = Object.freeze({
  ADMIN: ['*'],

  BRANCH_DIRECTOR: [
    'DASHBOARD.VIEW',
    'SHIFT.VIEW', 'SHIFT.CREATE', 'SHIFT.UPDATE',
    'CARE.VIEW', 'CARE.CREATE', 'CARE.UPDATE',
    'HANDOVER.VIEW', 'HANDOVER.SIGN', 'HANDOVER.RECEIVE',
    'MEDICAL.VIEW', 'MEDICAL.CREATE', 'MEDICAL.UPDATE', 'MEDICAL.STOP', 'MEDICAL.ADMINISTER',
    'REPORT.VIEW', 'REPORT.EXPORT',
    'AI_REPORT.VIEW',
    'AUDIT.VIEW',
    'USER.VIEW', 'USER.CREATE', 'USER.UPDATE',
    'SYSTEM.VIEW',
  ],

  MEDICAL: [
    'DASHBOARD.VIEW',
    'SHIFT.VIEW',
    'CARE.VIEW', 'CARE.CREATE', 'CARE.UPDATE',
    'HANDOVER.VIEW', 'HANDOVER.SIGN', 'HANDOVER.RECEIVE',
    'MEDICAL.VIEW', 'MEDICAL.CREATE', 'MEDICAL.UPDATE', 'MEDICAL.STOP', 'MEDICAL.ADMINISTER',
    'REPORT.VIEW',
  ],

  CAREGIVER: [
    'SHIFT.VIEW',
    'CARE.VIEW',
    'CARE.CREATE',
  ],
});

/*
 * CEILING = trần quyền tuyệt đối theo vai trò.
 * Checkbox chỉ có thể chọn quyền nằm trong trần này.
 *
 * BRANCH_DIRECTOR có thể được Admin cấp thêm DELETE trong phạm vi cơ sở,
 * nhưng KHÔNG bao giờ được HANDOVER.OVERRIDE, USER.DELETE hoặc SYSTEM.UPDATE.
 */
export const ROLE_PERMISSION_CEILING = Object.freeze({
  ADMIN: ['*'],

  BRANCH_DIRECTOR: [
    'DASHBOARD.VIEW',
    'SHIFT.VIEW', 'SHIFT.CREATE', 'SHIFT.UPDATE', 'SHIFT.DELETE',
    'CARE.VIEW', 'CARE.CREATE', 'CARE.UPDATE', 'CARE.DELETE',
    'HANDOVER.VIEW', 'HANDOVER.SIGN', 'HANDOVER.RECEIVE',
    'MEDICAL.VIEW', 'MEDICAL.CREATE', 'MEDICAL.UPDATE', 'MEDICAL.STOP', 'MEDICAL.ADMINISTER', 'MEDICAL.DELETE',
    'REPORT.VIEW', 'REPORT.EXPORT',
    'AI_REPORT.VIEW',
    'AUDIT.VIEW',
    'USER.VIEW', 'USER.CREATE', 'USER.UPDATE',
    'SYSTEM.VIEW',
  ],

  MEDICAL: [
    'DASHBOARD.VIEW',
    'SHIFT.VIEW',
    'CARE.VIEW', 'CARE.CREATE', 'CARE.UPDATE',
    'HANDOVER.VIEW', 'HANDOVER.SIGN', 'HANDOVER.RECEIVE',
    'MEDICAL.VIEW', 'MEDICAL.CREATE', 'MEDICAL.UPDATE', 'MEDICAL.STOP', 'MEDICAL.ADMINISTER',
    'REPORT.VIEW',
  ],

  CAREGIVER: [
    'SHIFT.VIEW',
    'CARE.VIEW',
    'CARE.CREATE',
  ],
});

export function rolePermissions(role) {
  return [...(DEFAULT_PERMISSIONS[role] || [])];
}

export function rolePermissionCeiling(role) {
  return [...(ROLE_PERMISSION_CEILING[role] || [])];
}

export function sanitizeRolePermissions(role, requested, { fallbackToDefault = true } = {}) {
  if (role === 'ADMIN') return ['*'];

  const ceiling = new Set(rolePermissionCeiling(role));

  if (!Array.isArray(requested)) {
    return fallbackToDefault ? rolePermissions(role) : [];
  }

  return [...new Set(
    requested
      .map(x => String(x || '').trim())
      .filter(Boolean)
      .filter(permission => ceiling.has(permission))
  )];
}

/*
 * Runtime phải dùng permissions đã lưu nếu field tồn tại.
 * - tài khoản mới: permissions được ghi rõ từ form tick.
 * - tài khoản legacy không có field: dùng default.
 * - [] là hợp lệ và có nghĩa không có quyền module nào.
 */
export function normalizePermissions(user = {}) {
  if (user.role === 'ADMIN') return ['*'];

  if (Array.isArray(user.permissions)) {
    return sanitizeRolePermissions(user.role, user.permissions, { fallbackToDefault: false });
  }

  return rolePermissions(user.role);
}

export function hasPermission(user, permission) {
  if (!user || !permission) return false;
  if (user.role === 'ADMIN') return true;
  const permissions = normalizePermissions(user);
  return permissions.includes('*') || permissions.includes(permission);
}

/*
 * Quyền người quản trị được phép gán cho target.
 * Admin: trong ceiling của target.
 * Director: chỉ quản lý MEDICAL/CAREGIVER và không thể cấp quyền mà chính mình không có.
 */
export function assignablePermissions(actor, targetRole, requested) {
  if (targetRole === 'ADMIN') return actor?.role === 'ADMIN' ? ['*'] : [];

  const clean = sanitizeRolePermissions(targetRole, requested);
  if (actor?.role === 'ADMIN') return clean;

  if (actor?.role === 'BRANCH_DIRECTOR' && ['MEDICAL', 'CAREGIVER'].includes(targetRole)) {
    const actorPermissions = new Set(normalizePermissions(actor));
    return clean.filter(permission => actorPermissions.has(permission));
  }

  return [];
}
