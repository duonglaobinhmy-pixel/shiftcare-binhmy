import React from 'react';
import ReactDOM from 'react-dom/client';
import {BrowserRouter,Routes,Route} from 'react-router-dom';
import {AuthProvider} from './context/AuthContext';
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

if('serviceWorker'in navigator && import.meta.env.PROD){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(console.warn))}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login/>}/>
          <Route path="/403" element={<Forbidden/>}/>
          <Route element={<ProtectedRoute><Layout/></ProtectedRoute>}>
            <Route index element={<Dashboard/>}/>
            <Route path="residents" element={<Residents/>}/>
            <Route path="shifts" element={<Shifts/>}/>
            <Route path="shifts/:id" element={<ShiftDetail/>}/>
            <Route path="reports" element={<ProtectedRoute roles={['ADMIN','BRANCH_DIRECTOR']}><Reports/></ProtectedRoute>}/>
            <Route path="reports/staff" element={<ProtectedRoute roles={['ADMIN','BRANCH_DIRECTOR']}><StaffReports/></ProtectedRoute>}/>
            <Route path="audit" element={<ProtectedRoute roles={['ADMIN','BRANCH_DIRECTOR']}><Audit/></ProtectedRoute>}/>
            <Route path="users" element={<ProtectedRoute roles={['ADMIN']}><Users/></ProtectedRoute>}/>
            <Route path="system" element={<ProtectedRoute roles={['ADMIN','BRANCH_DIRECTOR']}><System/></ProtectedRoute>}/>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
