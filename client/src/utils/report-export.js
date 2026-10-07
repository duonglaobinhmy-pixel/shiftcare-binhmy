// Preserve every record; use timestamps rather than lexicographic ISO offsets.
export const recordTime = row => row.occurredAt || row.createdAt || '';
export const newestFirst = (a, b) =>
  (Date.parse(recordTime(b)) || 0) - (Date.parse(recordTime(a)) || 0) ||
  (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) ||
  String(b.id || '').localeCompare(String(a.id || ''));
const labels = { HEALTH:'Sức khỏe', NUTRITION:'Dinh dưỡng', PSYCHOLOGY:'Tâm lý', SKIN:'Ngoài da', INCIDENT:'Sự cố', OTHER:'Khác', NORMAL:'Bình thường', CONSTIPATION:'Táo bón', DIARRHEA:'Tiêu chảy', SONDE:'Qua sonde', CATHETER:'Qua ống tiểu', DIAPER:'Qua tã', LOW:'Tiểu ít', NONE:'Không tiểu' };
const dateTime = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('vi-VN', {timeZone:'Asia/Ho_Chi_Minh'}) : '';
export function detailCsvRows(changes = [], toilets = [], shifts = [], resident = {}) {
  const shiftMap = new Map(shifts.map(s => [String(s.id), s]));
  const rows = [...changes.map(r => ({...r, recordKind:'CHANGE'})), ...toilets.map(r => ({...r, recordKind:'TOILET'}))].sort(newestFirst);
  return [
    ['Mã bản ghi','Loại ghi nhận','Mã NCT','NCT','Cơ sở','Khu','Phòng','Giường','Mã ca','Ngày ca','Loại ca','Thời điểm ghi nhận (VN)','Thời điểm tạo (VN)','Nhóm','Nội dung','Xử lý','Kết quả','Mức cảnh báo','Trạng thái cảnh báo','Cần bàn giao','Theo dõi tiếp','Đã báo','Người ghi','Người cập nhật','Cập nhật lúc (VN)','Người xác nhận xử lý','Xử lý lúc (VN)','Mạch','Nhiệt độ','HA tâm thu','HA tâm trương','SpO2','Nhịp thở','Đường huyết','Insulin (IU)','Tiêu','Tiểu','Chi tiết tiểu','Ghi chú tiêu/tiểu','Số ảnh','Liên kết ảnh'],
    ...rows.map(r => {
      const s = shiftMap.get(String(r.shiftId)) || {}, v = r.vitals || {};
      return [r.id,r.recordKind==='CHANGE'?'Diễn biến':'Tiêu / tiểu',r.residentId,r.residentName||resident.name,r.branchName||s.branchName,r.areaName||resident.areaName,r.roomName||resident.roomName,r.bedName||resident.bedName,r.shiftId,s.shiftDate,s.shiftType,dateTime(recordTime(r)),dateTime(r.createdAt),(r.categoryCodes?.length?r.categoryCodes:[r.category]).filter(Boolean).map(c=>labels[c]||c).join(' · '),r.content,r.intervention,r.resolutionNote,r.attentionLevel,r.attentionStatus,r.requiresHandover?'Có':'Không',r.followUp,r.notifiedTo,r.createdByName,r.updatedByName,dateTime(r.updatedAt),r.resolvedByName,dateTime(r.resolvedAt||r.attentionResolvedAt),v.pulse,v.temperature,v.bpSys,v.bpDia,v.spo2,v.respiratoryRate,v.bloodGlucose,v.insulinDoseUnits??(r.insulin?.given?r.insulin.dose:''),labels[r.bowelStatus]||r.bowelStatus,labels[r.urineStatus]||r.urineStatus,r.urineDetail,r.note,r.woundImages?.length||0,(r.woundImages||[]).map(i=>i.url||i.image||'').filter(x=>typeof x==='string'&&!x.startsWith('data:')).join(' | ')];
    })
  ];
}
export function downloadDetailCsv(filename, changes, toilets, shifts, resident) {
  // Quoting and neutralizing spreadsheet formulas protects free-text fields.
  const cell = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"','""') + '"';
  };
  const csv = '\ufeff' + detailCsvRows(changes,toilets,shifts,resident).map(r=>r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
