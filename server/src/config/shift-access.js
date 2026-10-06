// Care staff use current open shifts only. Managers retain reporting history.
export const isCareStaff = user => ['CARE_SHARED', 'CAREGIVER'].includes(user?.role);
export function isCurrentOpenShift(shift, now = new Date()) {
  if (!shift || shift.status !== 'OPEN') return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(x => [x.type, x.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const date = String(shift.shiftDate || '').slice(0, 10);
  if (date === today) return true;
  // Night shift dated yesterday remains current until 06:00 Vietnam time.
  const previous = new Date(`${today}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return shift.shiftType === 'NIGHT' && Number(parts.hour) < 6 && date === previous.toISOString().slice(0, 10);
}
export function canAccessShift(user, shift) {
  if (!user || !shift) return false;
  if (user.role === 'ADMIN') return true;
  if (!user.branchId || String(shift.branchId || '') !== String(user.branchId)) return false;
  return !isCareStaff(user) || isCurrentOpenShift(shift);
}
