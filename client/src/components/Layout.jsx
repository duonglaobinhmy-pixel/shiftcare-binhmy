import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PWAStatus from './PWAStatus';
import AIChat from './AIChat';
import AlertBell from './AlertBell';

const menus = [
  ['/', 'Tổng quan', 'DASHBOARD.VIEW'],
  ['/shifts', 'Ca chăm sóc', 'SHIFT.VIEW'],
  ['/residents', 'Nhập nhanh NCT', 'CARE.VIEW'],
  ['/reports', 'Báo cáo biến động', 'REPORT.VIEW'],
  ['/reports/staff', 'Báo cáo ca nhân viên', 'REPORT.VIEW'],
  ['/audit', 'Audit', 'AUDIT.VIEW'],
  ['/users', 'Tài khoản', 'USER.VIEW'],
  ['/system', 'Kết nối BCARE', 'SYSTEM.VIEW']
];

export default function Layout() {
  const { user, logout, can } = useAuth();
  const visibleMenus = menus.filter(([, , permission]) => can(permission));

  return <div className="app-shell">
    <aside className="app-sidebar">
      <div className="brand-lockup">
        <img src="/logo-binhmy.jpg" alt="Dưỡng lão Bình Mỹ" />
        <div><b>BÌNH MỸ CARE</b><span>Chăm Sóc Thông Minh • v10.10</span></div>
      </div>
      <nav className="sidebar-nav">
        {visibleMenus.map(([to, label]) => <NavLink key={to} to={to} end={to === '/' || to === '/reports'}>{label}</NavLink>)}
      </nav>
      <div className="userbox">
        <b>{user.fullName}</b>
        <small>{user.role}</small>
        <small>{user.branchName || 'Toàn hệ thống'}</small>
        <button onClick={logout}>Đăng xuất</button>
      </div>
    </aside>
    <main className="app-main">
      <div className="app-topbar"><PWAStatus /><AlertBell /></div>
      <div className="app-content-scroll"><Outlet /></div>
    </main>
    <AIChat />
  </div>;
}
