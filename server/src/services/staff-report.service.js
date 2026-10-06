// JSON-mode implementation of the existing PostgreSQL report contracts.
// Calendar days use Vietnamese event dates; source shifts may start the night before.
const dateVN = value => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
};
const level = row => row.vitals?.alertLevel === 'RED' || row.eventType === 'FALL' || row.categoryCodes?.includes('INCIDENT') || row.priority === 'HIGH'
  ? 'RED' : row.vitals?.alertLevel === 'YELLOW' || row.priority === 'MEDIUM' ? 'YELLOW' : null;
const blank = () => ({ shiftCount: 0, staffCount: 0, changeCount: 0, toiletingCount: 0, redCount: 0, yellowCount: 0, openCount: 0, handoverDone: 0, handoverPending: 0 });

export function staffDayReport(store, user, { date, branchId = '', staffId = '' }) {
  const branch = user.role === 'ADMIN' ? String(branchId) : String(user.branchId || '');
  const scoped = row => (!branch || String(row.branchId) === branch) && (user.role === 'ADMIN' || String(row.branchId) === String(user.branchId || ''));
  const changes = (store.changeLogs || []).filter(row => !row.deleted && scoped(row) && dateVN(row.occurredAt || row.createdAt) === date).map(row => ({
    ...row, attentionLevel: level(row), attentionStatus: level(row) ? row.attentionStatus === 'RESOLVED' ? 'RESOLVED' : 'OPEN' : null,
    imageCount: (row.woundImages || []).length
  }));
  const toilets = (store.toiletingLogs || []).filter(row => !row.deleted && scoped(row) && dateVN(row.createdAt) === date);
  const activityIds = new Set([...changes, ...toilets].map(row => String(row.shiftId)));
  const shifts = (store.shifts || []).filter(shift => scoped(shift) && (!staffId || (shift.assignedStaff || []).some(person => String(person.id) === String(staffId))) && (shift.shiftDate === date || activityIds.has(String(shift.id)))).map(shift => {
    const sc = changes.filter(row => String(row.shiftId) === String(shift.id)).sort((a, b) => String(b.occurredAt || b.createdAt).localeCompare(String(a.occurredAt || a.createdAt)));
    const st = toilets.filter(row => String(row.shiftId) === String(shift.id)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return {
      ...shift, staff: shift.assignedStaff || [],
      handover: (store.handovers || []).find(row => String(row.shiftId) === String(shift.id)) || {},
      changes: sc, toilets: st, changeCount: sc.length, toiletingCount: st.length,
      redCount: sc.filter(row => row.attentionLevel === 'RED').length,
      yellowCount: sc.filter(row => row.attentionLevel === 'YELLOW').length,
      openCount: sc.filter(row => row.attentionLevel && row.attentionStatus === 'OPEN').length
    };
  }).sort((a, b) => String(a.shiftDate).localeCompare(String(b.shiftDate)) || String(a.shiftType).localeCompare(String(b.shiftType)));
  const summary = blank();
  summary.shiftCount = shifts.length;
  summary.staffCount = new Set(shifts.flatMap(shift => shift.staff.map(person => String(person.id)))).size;
  for (const shift of shifts) {
    for (const key of ['changeCount', 'toiletingCount', 'redCount', 'yellowCount', 'openCount']) summary[key] += shift[key];
    summary[shift.handover.confirmedAt ? 'handoverDone' : 'handoverPending']++;
  }
  return { date, branchId: branch, staffId: String(staffId), summary, shifts };
}

export function staffCalendarReport(store, user, { from, to, branchId = '', staffId = '' }) {
  const dates = new Set((store.shifts || []).map(shift => shift.shiftDate));
  for (const row of store.changeLogs || []) if (!row.deleted) dates.add(dateVN(row.occurredAt || row.createdAt));
  for (const row of store.toiletingLogs || []) if (!row.deleted) dates.add(dateVN(row.createdAt));
  const reports = [...dates].filter(date => date && date >= from && date <= to).sort().map(date => staffDayReport(store, user, { date, branchId, staffId }));
  const days = reports.filter(report => report.summary.shiftCount).map(report => ({ date: report.date, ...report.summary }));
  const summary = blank();
  for (const day of days) for (const key of Object.keys(summary)) if (key !== 'staffCount') summary[key] += day[key];
  summary.staffCount = new Set(reports.flatMap(report => report.shifts.flatMap(shift => shift.staff.map(person => String(person.id))))).size;
  const branch = user.role === 'ADMIN' ? String(branchId) : String(user.branchId || '');
  const staffDirectory = (store.staffMembers || []).filter(person => person.active !== false && !person.deleted && (!branch || String(person.branchId) === branch) && (user.role === 'ADMIN' || String(person.branchId) === String(user.branchId || ''))).map(person => ({ id: String(person.id), employeeCode: person.employeeCode || '', fullName: person.fullName || '', branchId: person.branchId || '', branchName: person.branchName || '' }));
  return { from, to, branchId: branch, staffId: String(staffId), summary, days, staffDirectory };
}
