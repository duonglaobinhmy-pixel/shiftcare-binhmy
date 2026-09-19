import jwt from 'jsonwebtoken';
import { getUsers } from '../services/store.service.js';
import { normalizePermissions, hasPermission } from '../config/permissions.js';

const SECRET = process.env.JWT_SECRET || 'demo-secret';

function safeIdentity(user) {
  return {
    sub: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    fullAccess: user.fullAccess === true || (user.role === 'ADMIN' && !Array.isArray(user.permissions)),
    permissions: normalizePermissions(user),
    branchId: user.branchId || null,
    branchName: user.branchName || null,
    areaId: user.areaId || null,
    areaName: user.areaName || null,
  };
}

export function signUser(user) {
  return jwt.sign(
    safeIdentity(user),
    SECRET,
    { expiresIn: '12h' }
  );
}

export async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';

  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : '';

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Chưa đăng nhập',
    });
  }

  try {
    const decoded = jwt.verify(token, SECRET);

    const users = await getUsers();

    const current = users.find(
      (x) =>
        x.id === decoded.sub &&
        x.active
    );

    if (!current) {
      return res.status(401).json({
        success: false,
        message:
          'Tài khoản đã bị khóa hoặc không còn tồn tại',
      });
    }

    req.user = {
      ...decoded,
      ...safeIdentity(current),
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message:
        'Phiên đăng nhập không hợp lệ hoặc đã hết hạn',
    });
  }
}

/**
 * Permission middleware mới
 *
 * Ví dụ:
 *
 * router.get(
 *   '/orders',
 *   allowPermission('MEDICAL_ORDER.VIEW'),
 *   handler
 * )
 */
export function allowPermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Chưa đăng nhập',
      });
    }

    const allowed = permissions.some(
      (permission) =>
        hasPermission(
          req.user,
          permission
        )
    );

    if (!allowed) {
      return res.status(403).json({
        success: false,
        message:
          'Không có quyền thực hiện chức năng này',
        requiredPermissions:
          permissions,
      });
    }

    next();
  };
}

/**
 * Giữ lại để các route cũ chưa migrate
 * vẫn chạy được.
 */
export function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Chưa đăng nhập',
      });
    }

    if (
      req.user.role !== 'ADMIN' &&
      !roles.includes(req.user.role)
    ) {
      return res.status(403).json({
        success: false,
        message:
          'Không có quyền thực hiện chức năng này',
      });
    }

    next();
  };
}

export function scopedBranch(
  req,
  requestedBranchId
) {
  if (req.user.role === 'ADMIN') {
    return requestedBranchId || '';
  }

  return req.user.branchId || '';
}
