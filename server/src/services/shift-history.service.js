// Reading another shift must not extend canAccessShift's write access.
export function canReadShiftHistory(user, shift) {
  return !!user && !!shift && (user.role === 'ADMIN' ||
    (!!user.branchId && String(user.branchId) === String(shift.branchId)));
}
export function shiftHistorySummary(store, shift) {
  const residents=(store.shiftResidents||[]).filter(r=>r.shiftId===shift.id);
  const changes=(store.changeLogs||[]).filter(r=>r.shiftId===shift.id&&!r.deleted);
  const toilets=(store.toiletingLogs||[]).filter(r=>r.shiftId===shift.id&&!r.deleted);
  const attention=r=>{
    if(r.vitals?.alertLevel==='RED'||r.eventType==='FALL'||r.categoryCodes?.includes('INCIDENT')||r.priority==='HIGH')return 'RED';
    if(r.vitals?.alertLevel==='YELLOW'||r.priority==='MEDIUM')return 'YELLOW';
    return ['RED','YELLOW'].includes(r.attentionLevel)?r.attentionLevel:null;
  };
  const normalized=changes.map(r=>({...r,attentionLevel:attention(r),attentionStatus:attention(r)?(r.attentionStatus==='RESOLVED'?'RESOLVED':'OPEN'):null}));
  const handover=(store.handovers||[]).filter(h=>h.shiftId===shift.id).sort((a,b)=>String(b.confirmedAt||'').localeCompare(String(a.confirmedAt||'')))[0]||null;
  return {shift,residents,changes:normalized,toileting:toilets,handover,summary:{
    rosterResidents:new Set(residents.map(r=>r.residentId)).size,
    residentsWithActivity:new Set(changes.map(r=>r.residentId)).size,
    records:changes.length,toiletingRecords:toilets.length,
    openRed:normalized.filter(r=>r.attentionLevel==='RED'&&r.attentionStatus==='OPEN').length,
    openYellow:normalized.filter(r=>r.attentionLevel==='YELLOW'&&r.attentionStatus==='OPEN').length,
    resolvedAlerts:normalized.filter(r=>r.attentionStatus==='RESOLVED').length,
    requiresHandover:changes.filter(r=>r.requiresHandover).length,
  },asOf:new Date().toISOString(),readOnly:true};
}
