import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setToken } from '../services/api';

const AuthContext = createContext(null);

const ROLE_DEFAULTS = {
  ADMIN: ['*'],
  BRANCH_DIRECTOR: [
    'DASHBOARD.VIEW',
    'SHIFT.VIEW','SHIFT.CREATE','SHIFT.UPDATE',
    'CARE.VIEW','CARE.CREATE','CARE.UPDATE',
    'HANDOVER.VIEW','HANDOVER.SIGN','HANDOVER.RECEIVE',
    'MEDICAL.VIEW','MEDICAL.CREATE','MEDICAL.UPDATE','MEDICAL.STOP','MEDICAL.ADMINISTER',
    'REPORT.VIEW','REPORT.EXPORT','AI_REPORT.VIEW','AUDIT.VIEW',
    'USER.VIEW','USER.CREATE','USER.UPDATE','SYSTEM.VIEW'
  ],
  MEDICAL: [
    'DASHBOARD.VIEW','SHIFT.VIEW','CARE.VIEW','CARE.CREATE','CARE.UPDATE',
    'HANDOVER.VIEW','HANDOVER.SIGN','HANDOVER.RECEIVE',
    'MEDICAL.VIEW','MEDICAL.CREATE','MEDICAL.UPDATE','MEDICAL.STOP','MEDICAL.ADMINISTER','REPORT.VIEW'
  ],
  CAREGIVER: ['SHIFT.VIEW','CARE.VIEW','CARE.CREATE']
};

export function userPermissions(user) {
  if (!user) return [];
  if (user.role === 'ADMIN') return ['*'];
  if (Array.isArray(user.permissions)) return [...new Set(user.permissions)];
  return [...(ROLE_DEFAULTS[user.role] || [])];
}

export function userCan(user, permission) {
  const permissions = userPermissions(user);
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
      const result = await api.login({ username, password });
      setToken(result.token);
      saveUser(result.user);
      return result.user;
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
    const result = await api.me();
    const next = result.user || result.data || null;
    if (!next) throw new Error('Không đọc được thông tin tài khoản.');
    saveUser(next);
    return next;
  }, [saveUser]);

  useEffect(() => {
    if (user) refreshUser().catch(logout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const can = useCallback(permission => userCan(user, permission), [user]);
  const value = useMemo(
    () => ({ user, loading, login, logout, refreshUser, can, permissions: userPermissions(user) }),
    [user, loading, logout, refreshUser, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
