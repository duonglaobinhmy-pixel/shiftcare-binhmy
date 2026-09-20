/*
 * Một nơi duy nhất định nghĩa data scope.
 * Không dùng UI để bảo mật; mọi API phải kiểm tra scope ở server.
 */

export function isAdmin(user) {
  return user?.role === 'ADMIN';
}

export function isBranchDirector(user) {
  return user?.role === 'BRANCH_DIRECTOR';
}

export function isCaregiver(user) {
  return user?.role === 'CAREGIVER';
}

export function normalizedId(value) {
  return String(value ?? '').trim();
}

export function effectiveBranchId(user, requestedBranchId = '') {
  if (isAdmin(user)) return normalizedId(requestedBranchId);
  return normalizedId(user?.branchId);
}

export function effectiveAreaId(user) {
  return isCaregiver(user) ? normalizedId(user?.areaId) : '';
}

export function canViewScopedRow(user, row = {}) {
  if (!user) return false;
  if (isAdmin(user)) return true;

  const userBranch = normalizedId(user.branchId);
  const rowBranch = normalizedId(row.branchId ?? row.branch_id);
  if (rowBranch && userBranch && rowBranch !== userBranch) return false;

  // Chăm sóc viên chỉ xem NCT/dữ liệu thuộc khu được giao khi record có area.
  if (isCaregiver(user)) {
    const userArea = normalizedId(user.areaId);
    const rowArea = normalizedId(
      row.areaId ?? row.area_id ?? row.areaIdSnapshot ?? row.area_id_snapshot
    );
    if (userArea && rowArea && rowArea !== userArea) return false;
  }

  return true;
}

export function canManageUser(actor, target) {
  if (!actor || !target) return false;
  if (isAdmin(actor)) return true;

  if (isBranchDirector(actor)) {
    return (
      normalizedId(actor.branchId) === normalizedId(target.branchId) &&
      ['CAREGIVER', 'MEDICAL'].includes(target.role)
    );
  }

  return false;
}

export function assignableRoles(actor) {
  if (isAdmin(actor)) return ['ADMIN', 'BRANCH_DIRECTOR', 'MEDICAL', 'CAREGIVER'];
  if (isBranchDirector(actor)) return ['MEDICAL', 'CAREGIVER'];
  return [];
}

export function scopeLabel(user) {
  if (isAdmin(user)) return 'Toàn hệ thống';
  if (isBranchDirector(user)) return user?.branchName || 'Cơ sở được phân quyền';
  if (isCaregiver(user)) {
    return [user?.branchName, user?.areaName].filter(Boolean).join(' • ') || 'Khu được phân công';
  }
  return user?.branchName || 'Phạm vi tài khoản';
}
