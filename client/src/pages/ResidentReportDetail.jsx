import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';

const VN_TZ = 'Asia/Ho_Chi_Minh';
const catLabel = {
  HEALTH: 'Sức khỏe',
  NUTRITION: 'Dinh dưỡng / ăn uống',
  PSYCHOLOGY: 'Tâm lý / hành vi',
  SKIN: 'Ngoài da',
  INCIDENT: 'Ngã / sự cố',
  OTHER: 'Khác'
};
const bowelLabel = { NORMAL: 'Bình thường', CONSTIPATION: 'Táo bón', DIARRHEA: 'Tiêu chảy', OTHER: 'Khác' };
const urineLabel = { NORMAL: 'BT', SONDE: 'Qua sonde', CATHETER: 'Qua ống tiểu', DIAPER: 'Qua tã', OTHER: 'Khác', LOW: 'Tiểu ít', NONE: 'Không tiểu' };

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

function dateKey(v) {
  if (!v) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: VN_TZ }).format(new Date(v));
}

function vitalText(v) {
  if (!v) return [];
  return [
    v.pulse != null && `Mạch ${v.pulse}`,
    v.temperature != null && `Nhiệt ${v.temperature}°C`,
    v.bpSys != null && v.bpDia != null && `HA ${v.bpSys}/${v.bpDia}`,
    v.spo2 != null && `SpO₂ ${v.spo2}%`,
    v.respiratoryRate != null && `Thở ${v.respiratoryRate}`,
    v.bloodGlucose != null && `ĐH ${v.bloodGlucose} mg/dL`,
    v.insulinDoseUnits != null && `Insulin ${v.insulinDoseUnits} IU`
  ].filter(Boolean);
}

export default function ResidentReportDetail() {
  const { residentId } = useParams();
  const [searchParams] = useSearchParams();
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || from;
  const branchId = searchParams.get('branchId') || '';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [imagePreview, setImagePreview] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr('');
    api.residentMedicalReport(residentId, from, to, branchId)
      .then(r => { if (alive) setData(r.data || null); })
      .catch(e => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [residentId, from, to, branchId]);

  const backQs = useMemo(() => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (branchId) q.set('branchId', branchId);
    return q.toString();
  }, [from, to, branchId]);

  const timeline = useMemo(() => {
    const rows = [];
    for (const c of data?.changes || []) {
      rows.push({ type: 'CHANGE', at: c.occurredAt || c.createdAt, item: c });
      for (const image of c.woundImages || []) {
        rows.push({ type: 'IMAGE', at: c.occurredAt || c.createdAt, item: { ...image, care: c } });
      }
    }
    for (const t of data?.toileting || []) rows.push({ type: 'TOILET', at: t.createdAt, item: t });
    return rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  }, [data]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const row of timeline) {
      const key = dateKey(row.at) || 'unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return [...map.entries()];
  }, [timeline]);

  const reportVitalHistory = useMemo(() => {
    const fromApi = Array.isArray(data?.vitalHistory) ? data.vitalHistory : [];
    if (fromApi.length) return fromApi;

    // Fallback trực tiếp từ changes. Timeline đang hiển thị được sinh hiệu thì
    // khối Chỉ số sinh tồn cũng phải hiển thị cùng dữ liệu đó.
    return (data?.changes || [])
      .filter(c => {
        const v = c?.vitals;
        if (!v) return false;
        return [
          v.pulse,
          v.temperature,
          v.bpSys,
          v.bpDia,
          v.spo2,
          v.respiratoryRate,
          v.bloodGlucose,
          v.insulinDoseUnits
        ].some(value => value !== null && value !== undefined && value !== '');
      })
      .sort((a, b) => String(b.occurredAt || b.createdAt || '').localeCompare(String(a.occurredAt || a.createdAt || '')));
  }, [data]);

  const latestVitalRecord = useMemo(() => {
    if (data?.latestVitalRecord?.vitals) return data.latestVitalRecord;
    return reportVitalHistory[0] || null;
  }, [data, reportVitalHistory]);

  const summary = data?.summary || {};
  const rangeLabel = from === to ? formatDate(from) : `${formatDate(from)} → ${formatDate(to)}`;

  return (
    <section>
      <header className="page-head report-page-head resident-detail-head">
        <div>
          <Link className="report-back-link" to={`/reports?${backQs}`}>← Quay lại báo cáo NCT</Link>
          <h1>{data?.resident?.name || 'Chi tiết NCT'}</h1>
          <p>{[data?.resident?.areaName, data?.resident?.roomName, data?.resident?.bedName].filter(Boolean).join(' · ') || '—'} · {rangeLabel}</p>
        </div>
        <div className="report-top-actions">
          <button className="secondary" onClick={() => window.print()}>In / PDF</button>
        </div>
      </header>

      {err && <div className="error">{err}</div>}

      {loading ? (
        <div className="page-loading">
          <div className="page-loading-card">
            <span className="loading-spinner" />
            <b>Đang tải diễn tiến NCT...</b>
          </div>
        </div>
      ) : (
        <>
          <div className="stats report-kpis resident-detail-kpis">
            <div className="stat"><b>{summary.changes || 0}</b><span>Biến động</span></div>
            <div className="stat danger"><b>{summary.openRed || 0}</b><span>Đỏ đang mở</span></div>
            <div className="stat warning"><b>{summary.openYellow || 0}</b><span>Vàng đang mở</span></div>
            <div className="stat success-stat"><b>{summary.resolved || 0}</b><span>Đã xử lý</span></div>
            <div className="stat"><b>{summary.handover || 0}</b><span>Cần bàn giao</span></div>
            <div className="stat"><b>{summary.toiletingAbnormal || 0}</b><span>Tiêu/tiểu lưu ý</span></div>
          </div>

          <div className="panel resident-vitals-report">
            <div className="panel-title">
              <div>
                <h2>Chỉ số sinh tồn</h2>
                <p>
                  {reportVitalHistory.length
                    ? `${reportVitalHistory.length} lần đo trong khoảng báo cáo.`
                    : latestVitalRecord
                      ? 'Không có lần đo mới trong khoảng báo cáo; hiển thị chỉ số gần nhất trước/cuối kỳ.'
                      : 'Chưa có dữ liệu sinh hiệu.'}
                </p>
              </div>
              {latestVitalRecord && <span>Gần nhất: {formatDateTime(latestVitalRecord.occurredAt || latestVitalRecord.createdAt)}</span>}
            </div>

            {latestVitalRecord?.vitals ? (
              <>
                <div className="resident-vital-grid">
                  {[
                    ['Mạch', latestVitalRecord.vitals.pulse, 'lần/phút'],
                    ['Nhiệt độ', latestVitalRecord.vitals.temperature, '°C'],
                    ['Huyết áp', (latestVitalRecord.vitals.bpSys != null || latestVitalRecord.vitals.bpDia != null) ? `${latestVitalRecord.vitals.bpSys ?? '—'}/${latestVitalRecord.vitals.bpDia ?? '—'}` : null, 'mmHg'],
                    ['SpO₂', latestVitalRecord.vitals.spo2, '%'],
                    ['Nhịp thở', latestVitalRecord.vitals.respiratoryRate, 'lần/phút'],
                    ['Đường huyết', latestVitalRecord.vitals.bloodGlucose, 'mg/dL'],
                    ['Insulin', latestVitalRecord.vitals.insulinDoseUnits, 'IU']
                  ].map(([label, value, unit]) => (
                    <div className={`resident-vital-card ${value == null ? 'empty' : ''}`} key={label}>
                      <span>{label}</span>
                      <b>{value == null ? '—' : value}</b>
                      <small>{value == null ? 'Chưa ghi nhận' : unit}</small>
                    </div>
                  ))}
                </div>

                {!!reportVitalHistory.length && (
                  <div className="resident-vital-history">
                    <h3>Lịch sử đo trong kỳ</h3>
                    {reportVitalHistory.map(c => {
                      const values = vitalText(c.vitals);
                      return (
                        <div className="resident-vital-history-row" key={c.id}>
                          <strong>{formatDateTime(c.occurredAt || c.createdAt)}</strong>
                          <div>{values.length ? values.join(' · ') : 'Không có chỉ số'}</div>
                          {c.vitals?.alertLevel && c.vitals.alertLevel !== 'NORMAL' && (
                            <span className={`attention-status ${c.vitals.alertLevel}`}>{c.vitals.alertLevel}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="empty">Chưa có chỉ số sinh tồn của NCT.</div>
            )}
          </div>

          <div className="panel resident-timeline-page">
            <div className="panel-title">
              <div>
                <h2>Dòng thời gian chăm sóc</h2>
                <p>Biến động, tiêu/tiểu và ảnh thêm được xếp chung theo thời gian.</p>
              </div>
              <span>{timeline.length} mục</span>
            </div>

            {grouped.map(([day, rows]) => (
              <div className="resident-day-group" key={day}>
                <div className="resident-day-label">{day === 'unknown' ? 'Không rõ ngày' : formatDate(day)}</div>
                <div className="resident-day-events">
                  {rows.map((row, idx) => {
                    if (row.type === 'CHANGE') {
                      const c = row.item;
                      const vitals = vitalText(c.vitals);
                      return (
                        <article className={`resident-timeline-event change ${c.attentionLevel || ''}`} key={`c-${c.id}`}>
                          <div className="resident-event-time">{formatDateTime(row.at)}</div>
                          <div className="resident-event-content">
                            <div className="resident-event-title">
                              <b>📝 {catLabel[c.category] || c.category || 'Biến động'}</b>
                              {c.attentionLevel && <span className={`attention-status ${c.attentionLevel}`}>{c.attentionLevel}</span>}
                              {c.attentionStatus === 'RESOLVED' && <span className="resident-resolved-chip">Đã xử lý</span>}
                            </div>
                            <p>{c.content || '—'}</p>
                            {!!vitals.length && <div className="resident-vital-chips">{vitals.map(v => <span key={v}>{v}</span>)}</div>}
                            {c.intervention && <div className="resident-event-action"><b>Xử lý:</b> {c.intervention}</div>}
                            {c.requiresHandover && <div className="resident-handover-chip">↗ Cần bàn giao ca sau</div>}
                            <small>Người ghi: {c.createdByName || '—'}</small>
                            {!!c.woundImages?.length && (
                              <div className="resident-event-images">
                                {c.woundImages.map((img, i) => {
                                  const src = img?.dataUrl || img?.url || img?.image;
                                  return src ? (
                                    <button type="button" key={img.id || i} onClick={() => setImagePreview(src)}>
                                      <img src={src} alt="Ảnh thêm" />
                                    </button>
                                  ) : null;
                                })}
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    }

                    if (row.type === 'TOILET') {
                      const t = row.item;
                      return (
                        <article className="resident-timeline-event toilet" key={`t-${t.id}`}>
                          <div className="resident-event-time">{formatDateTime(row.at)}</div>
                          <div className="resident-event-content">
                            <div className="resident-event-title"><b>🚽 Tiêu / tiểu</b></div>
                            <p><b>Tiêu:</b> {bowelLabel[t.bowelStatus] || t.bowelStatus || '—'} · <b>Tiểu:</b> {urineLabel[t.urineStatus] || t.urineStatus || '—'}</p>
                            {[t.urineDetail, t.note].filter(Boolean).length > 0 && <small>{[t.urineDetail, t.note].filter(Boolean).join(' · ')}</small>}
                            <small>Người ghi: {t.createdByName || '—'}</small>
                          </div>
                        </article>
                      );
                    }

                    const img = row.item;
                    const src = img?.dataUrl || img?.url || img?.image;
                    return (
                      <article className="resident-timeline-event image" key={`i-${img.id || idx}-${row.at}`}>
                        <div className="resident-event-time">{formatDateTime(row.at)}</div>
                        <div className="resident-event-content">
                          <div className="resident-event-title"><b>📷 Ảnh thêm</b></div>
                          {src && <button className="resident-single-image" type="button" onClick={() => setImagePreview(src)}><img src={src} alt="Ảnh thêm" /></button>}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}

            {!timeline.length && <div className="empty">Không có diễn tiến trong khoảng đã chọn.</div>}
          </div>
        </>
      )}

      {imagePreview && (
        <div className="modal image-modal-top" onClick={() => setImagePreview(null)}>
          <div className="modal-card image-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Ảnh thêm</h2>
              <button className="secondary" onClick={() => setImagePreview(null)}>Đóng</button>
            </div>
            <img src={imagePreview} alt="Ảnh thêm" />
          </div>
        </div>
      )}
    </section>
  );
}
