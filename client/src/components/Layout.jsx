import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PWAStatus from './PWAStatus';
import AlertBell from './AlertBell';
import AIChat from './AIChat';

const MENU_ITEMS=[
  {to:'/',label:'Tổng quan',permission:'DASHBOARD.VIEW',icon:'⌂',end:true},
  {to:'/shifts/current',label:'Ca chăm sóc',permission:'SHIFT.VIEW',icon:'◷'},
  // {to:'/residents',label:'Nhập nhanh NCT',permission:'CARE.VIEW',icon:'+'},
  {to:'/reports',label:'Báo cáo biến động',permission:'REPORT.VIEW',icon:'▤'},
  {to:'/reports/staff',label:'Báo cáo ca nhân viên',permission:'REPORT.VIEW',icon:'♙'},
  // c
  {to:'/users',label:'Tài khoản',permission:'USER.VIEW',icon:'♟'},
  // {to:'/system',label:'Kết nối BCARE',permission:'SYSTEM.VIEW',icon:'↔'}
];

export default function Layout(){
  const {user,logout,can}=useAuth();
  const [collapsed,setCollapsed]=useState(()=>{try{return window.matchMedia?.('(max-width: 900px)')?.matches||localStorage.getItem('shiftcare_sidebar_collapsed')==='1'}catch{return false}});
  const visibleMenus=useMemo(()=>MENU_ITEMS.filter(item=>{try{return can(item.permission)}catch{return true}}),[can]);
  useEffect(()=>{try{localStorage.setItem('shiftcare_sidebar_collapsed',collapsed?'1':'0')}catch{}},[collapsed]);
  useEffect(()=>{
    const media=window.matchMedia?.('(max-width: 900px)');
    if(!media)return undefined;
    const onChange=event=>{if(event.matches)setCollapsed(true)};
    if(media.matches)setCollapsed(true);
    media.addEventListener?.('change',onChange);
    return()=>media.removeEventListener?.('change',onChange);
  },[]);
  const closeMobileMenu=()=>{if(window.matchMedia?.('(max-width: 900px)')?.matches)setCollapsed(true)};

  return <div className={`app-shell ${collapsed?'sidebar-collapsed':''}`}>
    <aside className="app-sidebar">
      <button type="button" className="sidebar-edge-toggle" onClick={()=>setCollapsed(v=>!v)} title={collapsed?'Mở rộng menu':'Thu gọn menu'} aria-label={collapsed?'Mở rộng menu':'Thu gọn menu'}>{collapsed?'›':'‹'}</button>
      <div className="sidebar-brand">
        <img src="/logo-binhmy.jpg" alt="Bình Mỹ Care" className="sidebar-logo"/>
        {!collapsed&&<div className="sidebar-brand-text"><strong>BÌNH MỸ CARE</strong><span>Chăm Sóc Thông Minh • v10.10</span></div>}
      </div>
      <nav className="sidebar-nav">
        {visibleMenus.map(item=><NavLink key={item.to} to={item.to} end={item.end} title={collapsed?item.label:undefined} onClick={closeMobileMenu} className={({isActive})=>isActive?'active':''}>
          <span className="sidebar-nav-icon" aria-hidden="true">{item.icon}</span>
          {!collapsed&&<span className="sidebar-nav-label">{item.label}</span>}
        </NavLink>)}
      </nav>
      <div className="sidebar-footer">
        {!collapsed?<>
          <div className="sidebar-user-info"><strong>{user?.fullName||user?.username||'Người dùng'}</strong><span>{user?.role||''}</span><span>{user?.branchName||'Toàn hệ thống'}</span></div>
          <button type="button" className="sidebar-logout" onClick={logout}>Đăng xuất</button>
        </>:<>
          <div className="sidebar-user-avatar" title={user?.fullName||user?.username||'Người dùng'}>{String(user?.fullName||user?.username||'U').trim().charAt(0).toUpperCase()}</div>
          <button type="button" className="sidebar-logout-compact" onClick={logout} title="Đăng xuất">↪</button>
        </>}
      </div>
    </aside>
    <main className="app-main">
      <header className="app-topbar"><button type="button" className="mobile-menu-toggle" onClick={()=>setCollapsed(v=>!v)}>☰</button><div className="app-topbar-right"><PWAStatus/><AlertBell/></div></header>
      <div className="app-content-scroll"><Outlet/></div>
    </main>
    <AIChat/>
  </div>;
}
