import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Residents from './pages/Residents';
import Shifts from './pages/Shifts';
import ShiftDetail from './pages/ShiftDetail';
import Reports from './pages/Reports';
import StaffReports from './pages/StaffReports';
import Audit from './pages/Audit';
import Users from './pages/Users';
import System from './pages/System';
import Forbidden from './pages/Forbidden';
import './styles/app.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(console.warn));
}

function HomeRoute() {
  const { can } = useAuth();
  if (can('DASHBOARD.VIEW')) return <Dashboard />;
  if (can('SHIFT.VIEW')) return <Navigate to="/shifts" replace />;
  return <Navigate to="/403" replace />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/403" element={<Forbidden />} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<HomeRoute />} />
            <Route path="residents" element={<ProtectedRoute permission="CARE.CREATE"><Residents /></ProtectedRoute>} />
            <Route path="shifts" element={<ProtectedRoute permission="SHIFT.VIEW"><Shifts /></ProtectedRoute>} />
            <Route path="shifts/:id" element={<ProtectedRoute permission="SHIFT.VIEW"><ShiftDetail /></ProtectedRoute>} />
            <Route path="reports" element={<ProtectedRoute permission="REPORT.VIEW"><Reports /></ProtectedRoute>} />
            <Route path="reports/staff" element={<ProtectedRoute permission="REPORT.VIEW"><StaffReports /></ProtectedRoute>} />
            <Route path="audit" element={<ProtectedRoute permission="AUDIT.VIEW"><Audit /></ProtectedRoute>} />
            <Route path="users" element={<ProtectedRoute permission="USER.VIEW"><Users /></ProtectedRoute>} />
            <Route path="system" element={<ProtectedRoute permission="SYSTEM.VIEW"><System /></ProtectedRoute>} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
