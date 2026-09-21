import { addOutbox } from '../utils/outbox';
const API='/api';
export function getToken(){return localStorage.getItem('shiftcare_token')||''}
export function setToken(v){if(v)localStorage.setItem('shiftcare_token',v);else localStorage.removeItem('shiftcare_token')}
async function request(path,options={}){
  const headers={...(options.headers||{})};
  if(!(options.body instanceof FormData))headers['Content-Type']='application/json';

  const token=getToken();
  if(token)headers.Authorization=`Bearer ${token}`;

  const res=await fetch(`${API}${path}`,{
    ...options,
    headers,
    body:options.body&&!(options.body instanceof FormData)&&typeof options.body!=='string'
      ?JSON.stringify(options.body)
      :options.body
  });

  const data=await res.json().catch(()=>({message:`HTTP ${res.status}`}));

  if(!res.ok){
    const detail=typeof data?.error==='string'?data.error:data?.error?.message;
    const error=new Error(data?.message||detail||`HTTP ${res.status}`);
    error.status=res.status;
    error.payload=data;
    throw error;
  }

  return data;
}
async function writeWithQueue(kind,path,body,opts={}){try{return await request(path,{method:'POST',body})}catch(e){if(!opts.skipQueue&&!navigator.onLine){addOutbox({kind,payload:body});return{success:true,queued:true,data:{offline:true}}}throw e}}
const rangeQs=(from='',to='',extra={})=>{const q=new URLSearchParams();if(from)q.set('from',from);if(to)q.set('to',to);Object.entries(extra||{}).forEach(([k,v])=>{if(v)q.set(k,v)});return q.toString()?`?${q}`:''};
export const api={
 login:(body)=>request('/auth/login',{method:'POST',body}),me:()=>request('/auth/me'),
 dashboard:(date='')=>request(`/dashboard${date?`?date=${encodeURIComponent(date)}`:''}`),
 residents:(body)=>request('/bcare/residents',{method:'POST',body}),diagnostics:()=>request('/bcare/diagnostics'),branches:()=>request('/bcare/branches'),locations:(branchId)=>request(`/bcare/locations?branchId=${encodeURIComponent(branchId||'')}`),
 activeShiftForResident:(residentId)=>request(`/residents/${residentId}/open-shift`),ensureShiftForResident:(resident)=>request(`/residents/${resident.id}/ensure-open-shift`,{method:'POST',body:{resident}}),
 shifts:()=>request('/shifts'),shiftStaffOptions:(branchId='')=>request(`/shifts/staff-options${branchId?`?branchId=${encodeURIComponent(branchId)}`:''}`),shift:(id)=>request(`/shifts/${id}`),createShift:(body)=>request('/shifts',{method:'POST',body}),updateShiftStaff:(id,assignedStaffIds,primaryRecorderId)=>request(`/shifts/${id}/staff`,{method:'PATCH',body:{assignedStaffIds,primaryRecorderId}}),deleteShift:(id)=>request(`/shifts/${id}`,{method:'DELETE'}),
 change:(body,opts)=>writeWithQueue('change','/change-logs',body,opts),updateChange:(id,body)=>request(`/change-logs/${id}`,{method:'PATCH',body}),resolveChange:(id,note)=>request(`/change-logs/${id}/resolve`,{method:'POST',body:{note}}),deleteChange:(id,reason)=>request(`/change-logs/${id}`,{method:'DELETE',body:{reason}}),restoreChange:(id)=>request(`/change-logs/${id}/restore`,{method:'POST',body:{}}),
 toileting:(body,opts)=>writeWithQueue('toileting','/toileting-logs',body,opts),updateToileting:(id,body)=>request(`/toileting-logs/${id}`,{method:'PATCH',body}),deleteToileting:(id,reason)=>request(`/toileting-logs/${id}`,{method:'DELETE',body:{reason}}),handoverPreview:(id)=>request(`/shifts/${id}/handover-preview`),handoverConfirm:(id,body)=>request(`/shifts/${id}/handover/confirm`,{method:'POST',body}),handoverReceive:(id,body)=>request(`/shifts/${id}/handover/receive`,{method:'POST',body}),closeShift:(id)=>request(`/shifts/${id}/close`,{method:'POST',body:{}}),
 reports:(from='',to='',branchId='')=>request(`/reports${rangeQs(from,to,{branchId})}`),staffReports:(from='',to='',branchId='')=>request(`/reports/staff${rangeQs(from,to,{branchId})}`),staffCalendar:(from='',to='',branchId='',staffId='')=>request(`/reports/staff/calendar${rangeQs(from,to,{branchId,staffId})}`),staffReportDay:(date='',branchId='',staffId='')=>request(`/reports/staff/day${rangeQs(date,date,{branchId,staffId,date})}`),residentMedicalReport:(residentId,from='',to='',branchId='')=>request(`/reports/resident/${encodeURIComponent(residentId)}${rangeQs(from,to,{branchId})}`),
 audit:()=>request('/audit-logs'),users:()=>request('/users'),staff:(branchId='')=>request(`/users/staff${branchId?`?branchId=${encodeURIComponent(branchId)}`:''}`),createStaff:(body)=>request('/users/staff',{method:'POST',body}),importStaff:(body)=>request('/users/staff/import',{method:'POST',body}),updateStaff:(id,body)=>request(`/users/staff/${id}`,{method:'PATCH',body}),deleteStaff:(id,reason)=>request(`/users/staff/${id}`,{method:'DELETE',body:{reason}}),createUser:(body)=>request('/users',{method:'POST',body}),updateUser:(id,body)=>request(`/users/${id}`,{method:'PATCH',body}),deactivateUser:(id)=>request(`/users/${id}`,{method:'DELETE'}),activateUser:(id)=>request(`/users/${id}/activate`,{method:'POST',body:{}}),deleteUserPermanent:(id,confirmUsername)=>request(`/users/${id}/permanent`,{method:'DELETE',body:{confirmUsername}}),
 medicationOrders:()=>request('/medication/orders'),createMedicationOrder:(body)=>request('/medication/orders',{method:'POST',body}),updateMedicationOrder:(id,body)=>request(`/medication/orders/${id}`,{method:'PATCH',body}),deleteMedicationOrder:(id,reason)=>request(`/medication/orders/${id}`,{method:'DELETE',body:{reason}}),stopMedicationOrder:(id,reason)=>request(`/medication/orders/${id}/stop`,{method:'POST',body:{reason}}),administerMedication:(id,body)=>request(`/medication/orders/${id}/administer`,{method:'POST',body}),medicationReport:(from='',to='')=>request(`/medication/report${rangeQs(from,to)}`),
 aiStatus:()=>request('/ai/status'),aiReport:(scope={})=>request(`/ai/report${rangeQs(scope.from||'',scope.to||'',{branchId:scope.branchId||'',page:scope.page||'',residentId:scope.residentId||''})}`),aiChat:(input,scope={})=>{const message=typeof input==='string'?input:String(input?.message||'');return request('/ai/chat',{method:'POST',body:{message,scope}})},cleanTranscript:(text)=>request('/ai/clean-transcript',{method:'POST',body:{text}}),transcribeAudio:(audioBase64,mimeType)=>request('/ai/transcribe-audio',{method:'POST',body:{audioBase64,mimeType}})
};
