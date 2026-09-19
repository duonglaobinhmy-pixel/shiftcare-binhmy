export const PERMISSION_GROUPS = Object.freeze([
  { module: 'DASHBOARD', label: 'Tổng quan', actions: ['VIEW'] },
  { module: 'SHIFT', label: 'Ca chăm sóc', actions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE'] },
  { module: 'CARE', label: 'Ghi nhận chăm sóc', actions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE'] },
  { module: 'HANDOVER', label: 'Bàn giao ca', actions: ['VIEW', 'SIGN', 'RECEIVE', 'OVERRIDE'] },
  { module: 'MEDICAL', label: 'Y khoa / y lệnh', actions: ['VIEW', 'CREATE', 'UPDATE', 'STOP', 'ADMINISTER', 'DELETE'] },
  { module: 'REPORT', label: 'Báo cáo', actions: ['VIEW', 'EXPORT'] },
  { module: 'AUDIT', label: 'Nhật ký hệ thống', actions: ['VIEW'] },
  { module: 'USER', label: 'Tài khoản', actions: ['VIEW', 'CREATE', 'UPDATE', 'DELETE'] },
  { module: 'SYSTEM', label: 'Kết nối hệ thống', actions: ['VIEW', 'UPDATE'] },
]);

export const ALL_PERMISSIONS = Object.freeze(
  PERMISSION_GROUPS.flatMap((group) =>
    group.actions.map((action) => `${group.module}.${action}`)
  )
);

export const DEFAULT_PERMISSIONS = Object.freeze({
  ADMIN: ['*'],
  BRANCH_DIRECTOR: [
    'DASHBOARD.VIEW', 'SHIFT.VIEW', 'SHIFT.CREATE', 'SHIFT.UPDATE', 'SHIFT.DELETE',
    'CARE.VIEW', 'HANDOVER.VIEW', 'REPORT.VIEW', 'REPORT.EXPORT', 'AUDIT.VIEW',
    'USER.VIEW', 'USER.CREATE', 'USER.UPDATE', 'USER.DELETE', 'SYSTEM.VIEW',
  ],
  MEDICAL: [
    'DASHBOARD.VIEW', 'SHIFT.VIEW', 'CARE.VIEW', 'CARE.CREATE',
    'CARE.UPDATE', 'HANDOVER.VIEW', 'HANDOVER.SIGN', 'HANDOVER.RECEIVE',
    'MEDICAL.VIEW', 'MEDICAL.CREATE', 'MEDICAL.UPDATE', 'MEDICAL.STOP',
    'MEDICAL.ADMINISTER', 'REPORT.VIEW',
  ],
  CAREGIVER: [
    'DASHBOARD.VIEW', 'SHIFT.VIEW', 'CARE.VIEW', 'CARE.CREATE',
    'CARE.UPDATE', 'HANDOVER.VIEW', 'HANDOVER.SIGN', 'HANDOVER.RECEIVE',
    'MEDICAL.VIEW', 'MEDICAL.ADMINISTER',
  ],
});

export function normalizePermissions(user = {}) {
  if (user.fullAccess === true && user.role === 'ADMIN') return ['*'];

  if (Array.isArray(user.permissions)) {
    const explicit = [
      ...new Set(
        user.permissions.filter(
          (item) => typeof item === 'string' && ALL_PERMISSIONS.includes(item)
        )
      ),
    ];
    return user.role === 'BRANCH_DIRECTOR' ? [...new Set([...DEFAULT_PERMISSIONS.BRANCH_DIRECTOR, ...explicit])] : explicit;
  }

  return [...(DEFAULT_PERMISSIONS[user.role] || [])];
}

export function hasPermission(user, permission) {
  if (!user || typeof permission !== 'string' || !permission) return false;

  const permissions = normalizePermissions(user);
  return permissions.includes('*') || permissions.includes(permission);
}
