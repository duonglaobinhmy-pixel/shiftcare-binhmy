import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

const VN_TZ = 'Asia/Ho_Chi_Minh';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: VN_TZ }).format(new Date());

function formatDate(v) {
  if (!v) return '—';
  const [y, m, d] = String(v).split('-');
  return `${d}/${m}/${y}`;
}

function formatDateTime(v) {
  if (!v) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: VN_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(v));
}

function riskRank(x) {
  if (x.redOpen) return 3;
  if (x.yellowOpen) return 2;
  if (x.handoverCount || x.toiletingAbnormal) return 1;
  return 0;
}

export default function Reports() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initial = today();
  const [from, setFrom] = useState(searchParams.get('from') || initial);
  const [to, setTo] = useState(searchParams.get('to') || initial);
  const [branchId, setBranchId] = useState(searchParams.get('branchId') || user.branchId || '');
  const [branches, setBranches] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [riskFilter, setRiskFilter] = useState('ALL');

  const isAdmin = user.role === 'ADMIN';
  const rangeLabel = from === to ? formatDate(from) : `${formatDate(from)} → ${formatDate(to)}`;

  useEffect(() => {
    api.branches()
      .then(r => setBranches(r.data || []))
      .catch(e => setErr(e.message));
  }, []);

  useEffect(() => {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    if (branchId) params.branchId = branchId;
    setSearchParams(params, { replace: true });
  }, [from, to, branchId, setSearchParams]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr('');

    api.reports(from, to, branchId)
      .then(r => {
        if (alive) setData(r.data || null);
      })
      .catch(e => {
        if (alive) {
          setErr(e.message);
          setData(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  }, [from, to, branchId]);

  const branchSummaries = useMemo(() => data?.branchSummaries || [], [data]);

  const residents = useMemo(() => {
    const query = q.trim().toLowerCase();
    return [...(data?.residentSummaries || [])]
      .filter(x => {
        if (riskFilter === 'RED' && !x.redOpen) return false;
        if (riskFilter === 'YELLOW' && !x.yellowOpen) return false;
        if (riskFilter === 'HANDOVER' && !x.handoverCount) return false;
        if (riskFilter === 'TOILETING' && !x.toiletingAbnormal) return false;
        if (!query) return true;
        return `${x.residentName || ''} ${x.areaName || ''} ${x.roomName || ''} ${x.bedName || ''}`
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) =>
        (riskRank(b) - riskRank(a)) ||
        (Number(b.changeCount || 0) - Number(a.changeCount || 0)) ||
        String(a.residentName || '').localeCompare(String(b.residentName || ''), 'vi')
      );
  }, [data, q, riskFilter]);

  const outstanding = useMemo(() => (data?.outstanding || []).slice(0, 8), [data]);

  function openResident(row) {
    const qs = new URLSearchParams();
    qs.set('from', from);
    qs.set('to', to);
    if (branchId) qs.set('branchId', branchId);
    navigate(`/reports/resident/${encodeURIComponent(row.residentId)}?${qs.toString()}`);
  }

  function exportCsv() {
    if (!data) return;
    const rows = [
      ['NCT', 'Cơ sở', 'Khu', 'Phòng', 'Giường', 'Biến động', 'Đỏ mở', 'Vàng mở', 'Cần bàn giao', 'Tiêu/tiểu lưu ý', 'Nội dung gần nhất'],
      ...(data.residentSummaries || []).map(x => [
        x.residentName || '',
        x.branchName || '',
        x.areaName || '',
        x.roomName || '',
        x.bedName || '',
        x.changeCount || 0,
        x.redOpen || 0,
        x.yellowOpen || 0,
        x.handoverCount || 0,
        x.toiletingAbnormal || 0,
        x.lastContent || ''
      ])
    ];
    const csv = '\ufeff' + rows
      .map(row => row.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `bao-cao-nct-${from}-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const branchName = branchId
    ? branches.find(b => String(b.id) === String(branchId))?.name || 'Cơ sở đã chọn'
    : 'Toàn hệ thống';

  return (
    <section>
      <header className="page-head report-page-head">
        <div>
          <h1>Báo cáo biến động NCT</h1>
          <p>Tổng hợp nhẹ theo NCT. Bấm vào một NCT để mở trang diễn tiến chi tiết riêng.</p>
        </div>
        <div className="report-top-actions">
          <Link className="button-link" to="/reports/staff">Lịch ca nhân viên</Link>
          <button className="secondary" onClick={exportCsv} disabled={!data}>Xuất CSV</button>
        </div>
      </header>

      <div className="report-period-panel">
        <div className="report-period-inputs resident-report-filter-grid">
          <label>
            Từ ngày
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </label>
          <label>
            Đến ngày
            <input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </label>
          <label>
            Cơ sở
            <select value={branchId} onChange={e => setBranchId(e.target.value)} disabled={!isAdmin}>
              <option value="">{isAdmin ? 'Tất cả cơ sở' : 'Cơ sở của tôi'}</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <div className="report-range-summary">
            <small>Khoảng báo cáo</small>
            <b>{rangeLabel}</b>
            <span>{branchName}</span>
          </div>
        </div>
      </div>

      {err && <div className="error">{err}</div>}

      {loading ? (
        <div className="page-loading">
          <div className="page-loading-card">
            <span className="loading-spinner" />
            <b>Đang tải báo cáo NCT...</b>
            <small>Chỉ lấy dữ liệu trong khoảng ngày và cơ sở đã chọn.</small>
          </div>
        </div>
      ) : (
        <>
          <div className="stats report-kpis resident-report-kpis">
            <div className="stat"><b>{data?.uniqueResidents || 0}</b><span>NCT có dữ liệu</span></div>
            <div className="stat"><b>{data?.changes || 0}</b><span>Biến động</span></div>
            <div className="stat danger"><b>{data?.openRed || 0}</b><span>Đỏ chưa xử lý</span></div>
            <div className="stat warning"><b>{data?.openYellow || 0}</b><span>Vàng chưa xử lý</span></div>
            <div className="stat"><b>{data?.requiresHandover || 0}</b><span>Cần bàn giao</span></div>
            <div className="stat"><b>{data?.toiletingAbnormal || 0}</b><span>Tiêu/tiểu lưu ý</span></div>
            <div className="stat success-stat"><b>{data?.resolutionRate ?? 100}%</b><span>Tỷ lệ xử lý</span></div>
          </div>

          {isAdmin && !branchId && branchSummaries.length > 1 && (
            <div className="panel branch-overview-panel">
              <div className="panel-title">
                <div>
                  <h2>Theo cơ sở</h2>
                  <p>Chọn một cơ sở để đi sâu, tránh trộn hàng trăm NCT của nhiều cơ sở trên một màn hình.</p>
                </div>
                <span>{branchSummaries.length} cơ sở</span>
              </div>
              <div className="branch-report-grid compact-branch-grid">
                {branchSummaries.map(x => (
                  <button
                    key={x.branchId}
                    className="branch-report-card"
                    onClick={() => setBranchId(String(x.branchId))}
                  >
                    <div>
                      <b>{x.branchName}</b>
                      <small>{x.residents} NCT có dữ liệu · {x.shifts} ca</small>
                    </div>
                    <div className="branch-report-numbers">
                      <span><b>{x.changes}</b> biến động</span>
                      <span className="red"><b>{x.redOpen}</b> đỏ</span>
                      <span className="yellow"><b>{x.yellowOpen}</b> vàng</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!!outstanding.length && (
            <div className="panel resident-priority-panel">
              <div className="panel-title">
                <div>
                  <h2>Cần xử lý trước</h2>
                  <p>Cảnh báo đỏ/vàng đang mở, ưu tiên theo mức và thời điểm.</p>
                </div>
                <span>{outstanding.length} cảnh báo hiển thị</span>
              </div>
              <div className="priority-alert-list">
                {outstanding.map(x => (
                  <button
                    type="button"
                    key={x.id}
                    className={`priority-alert-row ${x.attentionLevel || ''}`}
                    onClick={() => openResident(x)}
                  >
                    <span className={`attention-status ${x.attentionLevel || ''}`}>{x.attentionLevel || '—'}</span>
                    <div>
                      <b>{x.residentName || 'NCT'}</b>
                      <small>{x.areaName || '—'} · {x.roomName || '—'} · {x.bedName || '—'}</small>
                    </div>
                    <p>{x.content || '—'}</p>
                    <time>{formatDateTime(x.occurredAt || x.createdAt)}</time>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="panel resident-index-panel">
            <div className="panel-title resident-index-title">
              <div>
                <h2>NCT trong kỳ</h2>
                <p>Không tải toàn bộ bảng chi tiết. Chọn NCT để xem timeline riêng.</p>
              </div>
              <span>{residents.length} NCT</span>
            </div>

            <div className="report-inline-filters resident-index-filters">
              <input
                placeholder="Tìm tên NCT / khu / phòng / giường..."
                value={q}
                onChange={e => setQ(e.target.value)}
              />
              <select value={riskFilter} onChange={e => setRiskFilter(e.target.value)}>
                <option value="ALL">Tất cả</option>
                <option value="RED">Có cảnh báo đỏ</option>
                <option value="YELLOW">Có cảnh báo vàng</option>
                <option value="HANDOVER">Cần bàn giao</option>
                <option value="TOILETING">Tiêu/tiểu lưu ý</option>
              </select>
            </div>

            <div className="resident-report-grid resident-index-grid">
              {residents.map(x => (
                <button
                  type="button"
                  key={x.residentId}
                  className={`resident-report-card ${x.redOpen ? 'risk-red' : x.yellowOpen ? 'risk-yellow' : ''}`}
                  onClick={() => openResident(x)}
                >
                  <div className="resident-report-card-head">
                    <div>
                      <b>{x.residentName}</b>
                      <small>{x.areaName || '—'} · {x.roomName || '—'} · {x.bedName || '—'}</small>
                    </div>
                    {x.redOpen ? (
                      <span className="attention-status RED">🔴 {x.redOpen}</span>
                    ) : x.yellowOpen ? (
                      <span className="attention-status YELLOW">🟡 {x.yellowOpen}</span>
                    ) : (
                      <span className="resident-ok">Ổn</span>
                    )}
                  </div>

                  <div className="resident-mini-stats">
                    <span>📝 <b>{x.changeCount || 0}</b></span>
                    <span>↗ <b>{x.handoverCount || 0}</b></span>
                    <span>🚽 <b>{x.toiletingAbnormal || 0}</b></span>
                    {(x.images?.length || 0) > 0 && <span>📷 <b>{x.images.length}</b></span>}
                  </div>

                  {x.lastContent && (
                    <div className="resident-last-event">
                      <small>{formatDateTime(x.lastEventAt)}</small>
                      <p>{x.lastContent}</p>
                    </div>
                  )}

                  <div className="resident-card-open">Xem diễn tiến →</div>
                </button>
              ))}
            </div>

            {!residents.length && <div className="empty">Không có NCT phù hợp trong khoảng đã chọn.</div>}
          </div>
        </>
      )}
    </section>
  );
}
