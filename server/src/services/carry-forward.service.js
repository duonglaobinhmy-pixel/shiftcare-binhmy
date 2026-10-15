// Additive work queue: source observations and signed shift content stay in place.
export function isPending(row) {
  if (row.deleted || row.attentionStatus === 'RESOLVED' || row.followUpStatus === 'RESOLVED') return false;
  return !!row.attentionLevel || !!row.requiresHandover;
}
export function isEarlierShift(source, target) {
  if (!source || !target || String(source.id) === String(target.id)) return false;
  if (String(source.branchId) !== String(target.branchId)) return false;
  if (!source.shiftDate || !target.shiftDate) return false;
  if (source.shiftDate !== target.shiftDate) return source.shiftDate < target.shiftDate;
  const order={MORNING:0,AFTERNOON:1,NIGHT:2};
  return order[source.shiftType] < order[target.shiftType];
}
export function carryForward(store, target, residents) {
  const roster = new Set(residents.map(row => String(row.residentId)));
  const shifts = new Map(store.shifts.map(row => [String(row.id), row]));
  return store.changeLogs.filter(row => String(row.branchId) === String(target.branchId) &&
    roster.has(String(row.residentId)) && isPending(row) && isEarlierShift(shifts.get(String(row.shiftId)), target))
    .map(row => ({ ...row, sourceShiftDate: shifts.get(String(row.shiftId)).shiftDate,
      sourceShiftType: shifts.get(String(row.shiftId)).shiftType }))
    .sort((a,b) => String(a.occurredAt || a.createdAt).localeCompare(String(b.occurredAt || b.createdAt)));
}
