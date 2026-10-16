import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReportTrend, {dayRows} from '../components/ReportTrend';
import {useAuth} from '../context/AuthContext';
import { api } from '../services/api';

const VN_TZ = 'Asia/Ho_Chi_Minh';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: VN_TZ }).format(new Date());
const monthOf = value => String(value || today()).slice(0, 7);

function monthBounds(month) {
  const [year, mon] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, '0')}`
  };
}

function formatDate(value) {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}

function buildCalendarCells(month) {
  const [year, mon] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, mon - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const mondayIndex = (first.getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < mondayIndex; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${month}-${String(day).padStart(2, '0')}`);
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

export default function StaffReports() {
  const navigate = useNavigate();
  const {user}=useAuth();
  const [staffData,setStaffData]=useState(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const [month, setMonth] = useState(searchParams.get('month') || monthOf(today()));
  const [branchId, setBranchId] = useState(user.role==='ADMIN'?(searchParams.get('branchId')||''):(user.branchId||''));
  const [staffId, setStaffId] = useState(searchParams.get('staffId') || '');
  const [branches, setBranches] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const bounds = useMemo(() => monthBounds(month), [month]);
  const cells = useMemo(() => buildCalendarCells(month), [month]);
  const dayMap = useMemo(() => new Map((data?.days || []).map(x => [x.date, x])), [data]);

  useEffect(() => {
    api.branches()
      .then(r => setBranches(r.data || []))
      .catch(e => setErr(e.message));
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr('');
    setData(null);setStaffData(null);
    Promise.all([api.staffCalendar(bounds.from,bounds.to,branchId,staffId),api.staffReports(bounds.from,bounds.to,branchId)])
      .then(([r,staff]) => {
        if(alive){setData(r.data||null);setStaffData(staff.data||null);}
      })
      .catch(e => {
        if (alive) setErr(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [bounds.from, bounds.to, branchId, staffId]);

  useEffect(() => {
    const q = {};
    if (month) q.month = month;
    if (branchId) q.branchId = branchId;
    if (staffId) q.staffId = staffId;
    setSearchParams(q, { replace: true });
  }, [month, branchId, staffId, setSearchParams]);

  const staffStats=useMemo(()=>(staffData?.staffDetails||[]).filter(p=>!staffId||String(p.id)===String(staffId)).map(p=>{
    const shifts=(p.shifts||[]).filter(s=>s.shiftDate>=bounds.from&&s.shiftDate<=bounds.to);
    return {...p,shiftCount:shifts.length,dayCount:shifts.filter(s=>s.shiftType==='MORNING').length,nightCount:shifts.filter(s=>s.shiftType==='NIGHT').length};
  }),[staffData,staffId,bounds]);
  const staffingTrend=useMemo(()=>dayRows(bounds.from,bounds.to).map(row=>{
    const shifts=(staffData?.calendar||[]).filter(s=>s.shiftDate===row.date);
    const count=type=>new Set(shifts.filter(s=>s.shiftType===type).flatMap(s=>(s.staff||[]).filter(p=>!staffId||String(p.id)===String(staffId)).map(p=>String(p.id)))).size;
    return {...row,day:count('MORNING'),night:count('NIGHT')};
  }),[staffData,bounds,staffId]);
  const summary = data?.summary || {};
  const staffDirectory = data?.staffDirectory || [];

  function openDay(date) {
    const qs = new URLSearchParams();
    if (branchId) qs.set('branchId', branchId);
    if (staffId) qs.set('staffId', staffId);
    qs.set('month', month);
    navigate(`/reports/staff/day/${date}?${qs.toString()}`);
  }

  return (
    <section>
      <header className="page-head report-page-head">
        <div>
          <h1>Lịch ca nhân viên</h1>
          <p>Nhân sự theo ca sáng / ca tối và số ca của từng người. Lịch bên dưới mở chi tiết mỗi ngày.</p>
        </div>
        <div className="actions report-top-actions">
          <button className="secondary" onClick={() => window.print()}>In / PDF</button>
        </div>
      </header>

      <div className="report-period-panel staff-calendar-filter">
        <div className="report-period-inputs calendar-filter-grid">
          <label>
            Tháng
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
          </label>
          <label>
            Cơ sở
            <select disabled={user.role!=='ADMIN'} value={branchId} onChange={e => { setBranchId(e.target.value); setStaffId(''); }}>
              <option value="">Tất cả cơ sở</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label>
            Nhân viên
            <select value={staffId} onChange={e => setStaffId(e.target.value)}>
              <option value="">Tất cả nhân viên</option>
              {staffDirectory.map(s => (
                <option key={s.id} value={s.id}>
                  {s.employeeCode ? `${s.employeeCode} — ` : ''}{s.fullName}
                </option>
              ))}
            </select>
          </label>
          <div className="report-range-summary">
            <small>Khoảng</small>
            <b>{formatDate(bounds.from)} → {formatDate(bounds.to)}</b>
          </div>
        </div>
      </div>

      {err && <div className="error">{err}</div>}

      {loading ? (
        <div className="page-loading">
          <div className="page-loading-card">
            <span className="loading-spinner" />
            <b>Đang tải lịch ca...</b>
            <small>Chỉ lấy dữ liệu tổng hợp nên không tải toàn bộ chi tiết ca.</small>
          </div>
        </div>
      ) : (
        <>
          <div className="stats report-kpis calendar-kpis">
            <div className="stat"><b>{summary.shiftCount || 0}</b><span>Ca trong tháng</span></div>
            <div className="stat"><b>{summary.staffCount || 0}</b><span>Nhân viên có trực</span></div>
            <div className="stat"><b>{staffStats.reduce((n,p)=>n+p.dayCount,0)}</b><span>Lượt nhân sự trực ca sáng</span></div>
            <div className="stat"><b>{staffStats.reduce((n,p)=>n+p.nightCount,0)}</b><span>Lượt nhân sự trực ca tối</span></div>
            <div className="stat success-stat"><b>{summary.handoverDone || 0}</b><span>Đã bàn giao</span></div>
          </div>

          <ReportTrend title="Số nhân sự theo ca sáng / ca tối" description="Mỗi nhân sự tính một lần cho mỗi loại ca trong ngày, theo ngày bắt đầu ca. Không đếm lại ca tối khi có ghi nhận sau 0 giờ." rows={staffingTrend} unit="người" series={[{key:'day',label:'Trực ca sáng',color:'#2563eb'},{key:'night',label:'Trực ca tối',color:'#7c3aed'}]}/>
          <div className="panel"><h2>Số ca từng nhân sự</h2><p>Tính theo phân công và ngày bắt đầu ca trong tháng; số ca không phải số lượt ghi nhận.</p><div className="table-wrap"><table><thead><tr><th>Mã NV</th><th>Họ tên</th><th>Cơ sở</th><th>Tổng ca</th><th>Ca sáng</th><th>Ca tối</th></tr></thead><tbody>{staffStats.map(p=><tr key={p.id}><td>{p.employeeCode}</td><td>{p.fullName}</td><td>{p.branchName}</td><td>{p.shiftCount}</td><td>{p.dayCount}</td><td>{p.nightCount}</td></tr>)}{!staffStats.length&&<tr><td colSpan="6">Không có phân công trong kỳ.</td></tr>}</tbody></table></div></div>
          <div className="panel staff-month-calendar-panel">
            <div className="panel-title">
              <div>
                <h2>Tháng {month.split('-')[1]}/{month.split('-')[0]}</h2>
                <p>Mỗi ô chỉ hiển thị icon và số tổng. Bấm ngày để xem đầy đủ ca, nhân viên, ghi nhận và bàn giao.</p>
              </div>
            </div>

            <div className="month-calendar-weekdays">
              {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(x => <div key={x}>{x}</div>)}
            </div>

            <div className="month-calendar-grid">
              {cells.map((date, idx) => {
                if (!date) return <div className="month-calendar-cell empty-day" key={`empty-${idx}`} />;
                const d = dayMap.get(date) || {};
                const hasData = (d.shiftCount || 0) + (d.changeCount || 0) + (d.toiletingCount || 0) > 0;
                return (
                  <button
                    type="button"
                    className={`month-calendar-cell ${hasData ? 'has-data' : ''} ${date === today() ? 'is-today' : ''}`}
                    key={date}
                    onClick={() => openDay(date)}
                  >
                    <div className="month-calendar-date">
                      <b>{Number(date.slice(-2))}</b>
                      {date === today() && <span>Hôm nay</span>}
                    </div>
                    <div className="month-calendar-icons">
                      {!!d.shiftCount && <span title="Số ca">🕒 <b>{d.shiftCount}</b></span>}
                      {!!d.staffCount && <span title="Nhân viên có trực">👥 <b>{d.staffCount}</b></span>}
                      {!!d.changeCount && <span title="Biến động">📝 <b>{d.changeCount}</b></span>}
                      {!!d.toiletingCount && <span title="Tiêu / tiểu">🚽 <b>{d.toiletingCount}</b></span>}
                      {!!d.redCount && <span className="calendar-red" title="Cảnh báo đỏ">🔴 <b>{d.redCount}</b></span>}
                      {!!d.yellowCount && <span className="calendar-yellow" title="Cảnh báo vàng">🟡 <b>{d.yellowCount}</b></span>}
                      {!!d.handoverDone && <span title="Đã bàn giao">✅ <b>{d.handoverDone}</b></span>}
                      {!!d.handoverPending && <span title="Chưa bàn giao">⏳ <b>{d.handoverPending}</b></span>}
                    </div>
                    {!hasData && <small className="calendar-no-data">Không phát sinh</small>}
                  </button>
                );
              })}
            </div>

            <div className="calendar-legend">
              <span>🕒 Ca</span><span>👥 Nhân viên</span><span>📝 Biến động</span><span>🚽 Tiêu/tiểu</span>
              <span>🔴 Đỏ</span><span>🟡 Vàng</span><span>✅ Đã bàn giao</span><span>⏳ Chưa bàn giao</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
