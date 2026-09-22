import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setToken } from '../services/api';

const AuthContext = createContext(null);

const FALLBACK_PERMISSIONS = {
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
    'SHIFT.VIEW', 'SHIFT.CREATE',
    'CARE.VIEW', 'CARE.CREATE',
    'HANDOVER.VIEW', 'HANDOVER.SIGN', 'HANDOVER.RECEIVE',
    'MEDICAL.VIEW', 'MEDICAL.ADMINISTER',
  ],
};

export function userCan(user, permission) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (user.role === 'CARE_SHARED' && permission === 'SHIFT.CREATE') return true;
  const permissions = Array.isArray(user.permissions)
    ? user.permissions
    : (FALLBACK_PERMISSIONS[user.role] || []);
  return permissions.includes('*') || permissions.includes(permission);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('shiftcare_user') || 'null'); }
    catch { return null; }
  });
  const [loading, setLoading] = useState(false);

  const saveUser = useCallback(next => {
    setUser(next);
    if (next) localStorage.setItem('shiftcare_user', JSON.stringify(next));
    else localStorage.removeItem('shiftcare_user');
  }, []);

  async function login(username, password) {
    setLoading(true);
    try {
      const r = await api.login({ username, password });
      setToken(r.token);
      saveUser(r.user);
      return r.user;
    } finally {
      setLoading(false);
    }
  }

  const logout = useCallback(() => {
    setToken('');
    saveUser(null);
  }, [saveUser]);

  const refreshUser = useCallback(async () => {
    if (!localStorage.getItem('shiftcare_token')) return null;
    const r = await api.me();
    const next = r.user || r.data || null;
    if (!next) throw new Error('Không đọc được thông tin tài khoản.');
    saveUser(next);
    return next;
  }, [saveUser]);

  useEffect(() => {
    if (user) refreshUser().catch(logout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const can = useCallback(permission => userCan(user, permission), [user]);
  const value = useMemo(() => ({ user, loading, login, logout, refreshUser, can }), [user, loading, logout, refreshUser, can]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
