import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';

const shiftLabel = t => t === 'MORNING' ? 'Ca sáng' : t === 'NIGHT' ? 'Ca tối' : (t || 'Ca');

function formatDate(v) {
  if (!v) return '—';
  const [y, m, d] = String(v).split('-');
  return `${d}/${m}/${y}`;
}

function timeVN(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function levelText(level) {
  if (level === 'RED') return 'ĐỎ';
  if (level === 'YELLOW') return 'VÀNG';
  return 'THƯỜNG';
}

export default function StaffReportDay() {
  const { date } = useParams();
  const [searchParams] = useSearchParams();
  const branchId = searchParams.get('branchId') || '';
  const staffId = searchParams.get('staffId') || '';
  const month = searchParams.get('month') || String(date || '').slice(0, 7);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr('');
    api.staffReportDay(date, branchId, staffId)
      .then(r => { if (alive) setData(r.data || null); })
      .catch(e => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [date, branchId, staffId]);

  const backQs = useMemo(() => {
    const q = new URLSearchParams();
    q.set('month', month);
    if (branchId) q.set('branchId', branchId);
    if (staffId) q.set('staffId', staffId);
    return q.toString();
  }, [month, branchId, staffId]);

  const summary = data?.summary || {};

  return (
    <section>
      <header className="page-head report-page-head">
        <div>
          <Link className="report-back-link" to={`/reports/staff?${backQs}`}>← Quay lại lịch tháng</Link>
          <h1>Chi tiết ca ngày {formatDate(date)}</h1>
          <p>Một trang duy nhất: ca trực, nhân sự, biến động, tiêu/tiểu và trạng thái bàn giao.</p>
        </div>
        <div className="actions report-top-actions">
          <button className="secondary" onClick={() => window.print()}>In / PDF</button>
        </div>
      </header>

      {err && <div className="error">{err}</div>}

      {loading ? (
        <div className="page-loading">
          <div className="page-loading-card">
            <span className="loading-spinner" />
            <b>Đang tải chi tiết ngày...</b>
          </div>
        </div>
      ) : (
        <>
          <div className="stats report-kpis day-detail-kpis">
            <div className="stat"><b>{summary.shiftCount || 0}</b><span>Ca</span></div>
            <div className="stat"><b>{summary.staffCount || 0}</b><span>Nhân viên</span></div>
            <div className="stat"><b>{summary.changeCount || 0}</b><span>Biến động</span></div>
            <div className="stat"><b>{summary.toiletingCount || 0}</b><span>Tiêu / tiểu</span></div>
            <div className="stat danger"><b>{summary.redCount || 0}</b><span>Đỏ</span></div>
            <div className="stat warning"><b>{summary.yellowCount || 0}</b><span>Vàng</span></div>
            <div className="stat success-stat"><b>{summary.handoverDone || 0}</b><span>Đã bàn giao</span></div>
          </div>

          <div className="day-shift-list">
            {(data?.shifts || []).map(shift => (
              <article className="day-shift-card" key={shift.id}>
                <div className="day-shift-head">
                  <div>
                    <div className="day-shift-title-row">
                      <h2>{shiftLabel(shift.shiftType)}</h2>
                      <span className={`handover-badge ${shift.handover?.confirmedAt ? 'done' : 'pending'}`}>
                        {shift.handover?.confirmedAt ? '✅ Đã bàn giao' : '⏳ Chưa bàn giao'}
                      </span>
                    </div>
                    <p>{shift.branchName || '—'} · {shift.areaName || 'Toàn cơ sở'}</p>
                    {shift.shiftDate !== date && (
                      <small className="overnight-note">Ca nguồn ngày {formatDate(shift.shiftDate)} có phát sinh trong ngày đang xem.</small>
                    )}
                  </div>
                  <Link className="secondary button-link" to={`/shifts/${shift.id}`}>Mở ca →</Link>
                </div>

                <div className="day-shift-staff">
                  <b>Nhân sự trực</b>
                  <div className="staff-chip-list">
                    {(shift.staff || []).map(p => (
                      <span key={p.id}>
                        {p.fullName}{p.employeeCode ? ` #${p.employeeCode}` : ''}{p.isPrimary ? ' · Ghi chính' : ''}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="day-shift-mini-kpis">
                  <span>📝 <b>{shift.changeCount || 0}</b> biến động</span>
                  <span>🚽 <b>{shift.toiletingCount || 0}</b> tiêu/tiểu</span>
                  <span>🔴 <b>{shift.redCount || 0}</b> đỏ</span>
                  <span>🟡 <b>{shift.yellowCount || 0}</b> vàng</span>
                </div>

                <div className="day-detail-columns">
                  <div className="day-detail-block">
                    <div className="day-detail-block-title"><h3>Biến động trong ngày</h3><span>{shift.changes?.length || 0}</span></div>
                    {(shift.changes || []).length ? (
                      <div className="day-activity-list">
                        {shift.changes.map(c => (
                          <div className={`day-activity-item ${c.attentionLevel || ''}`} key={c.id}>
                            <div className="day-activity-time">{timeVN(c.occurredAt || c.createdAt)}</div>
                            <div className="day-activity-main">
                              <div className="day-activity-title">
                                <b>{c.residentName || 'NCT'}</b>
                                {c.attentionLevel && <span className={`activity-level ${c.attentionLevel}`}>{levelText(c.attentionLevel)}</span>}
                              </div>
                              <small>{c.category || '—'} · {c.eventType || '—'}</small>
                              <p>{c.content || '—'}</p>
                              {c.intervention && <div className="activity-action"><b>Xử lý:</b> {c.intervention}</div>}
                              {c.vitals && (
                                <div className="activity-vitals">
                                  {c.vitals.pulse != null && <span>Mạch {c.vitals.pulse}</span>}
                                  {c.vitals.temperature != null && <span>Nhiệt {c.vitals.temperature}°C</span>}
                                  {c.vitals.bpSys != null && c.vitals.bpDia != null && <span>HA {c.vitals.bpSys}/{c.vitals.bpDia}</span>}
                                  {c.vitals.spo2 != null && <span>SpO₂ {c.vitals.spo2}%</span>}
                                  {c.vitals.respiratoryRate != null && <span>Thở {c.vitals.respiratoryRate}</span>}
                                  {c.vitals.bloodGlucose != null && <span>ĐH {c.vitals.bloodGlucose}</span>}
                                </div>
                              )}
                              {!!c.imageCount && <small>📷 {c.imageCount} ảnh thêm</small>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <div className="empty compact">Không có biến động trong ngày.</div>}
                  </div>

                  <div className="day-detail-block">
                    <div className="day-detail-block-title"><h3>Tiêu / tiểu trong ngày</h3><span>{shift.toilets?.length || 0}</span></div>
                    {(shift.toilets || []).length ? (
                      <div className="day-activity-list">
                        {shift.toilets.map(t => (
                          <div className="day-activity-item toilet" key={t.id}>
                            <div className="day-activity-time">{timeVN(t.createdAt)}</div>
                            <div className="day-activity-main">
                              <b>{t.residentName || 'NCT'}</b>
                              <p>Tiêu: {t.bowelStatus || '—'} · Tiểu: {t.urineStatus || '—'}</p>
                              {t.urineDetail && <small>{t.urineDetail}</small>}
                              {t.note && <small>Ghi chú: {t.note}</small>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <div className="empty compact">Không có ghi nhận tiêu/tiểu trong ngày.</div>}
                  </div>
                </div>
              </article>
            ))}

            {!data?.shifts?.length && (
              <div className="panel"><div className="empty">Không có ca hoặc phát sinh phù hợp trong ngày này.</div></div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
