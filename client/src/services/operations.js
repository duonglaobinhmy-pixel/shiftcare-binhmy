import { getToken } from './api';
export function todayVN(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
export function localVN(value=new Date().toISOString()){const d=new Date(value);return new Date(d.getTime()+7*3600000).toISOString().slice(0,16)}
export const toInstant=value=>new Date(`${value}:00+07:00`).toISOString();
export const timeVN=value=>value?new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'—';
export async function operations(path,{method='GET',body,query}={}){
  const qs=new URLSearchParams();for(const [key,value] of Object.entries(query||{}))if(value!==undefined&&value!==null&&value!=='')qs.set(key,value);
  const response=await fetch(`/api${path}${qs.size?`?${qs}`:''}`,{method,headers:{Authorization:`Bearer ${getToken()}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const result=await response.json().catch(()=>({message:`HTTP ${response.status}`}));if(!response.ok){const e=new Error(result.message||'Không thể xử lý.');e.status=response.status;throw e}return result.data;
}
export async function downloadReport(query){
  const response=await fetch(`/api/reporting/export?${new URLSearchParams({...query,cursor:'0',limit:'200'})}`,{headers:{Authorization:`Bearer ${getToken()}`}});
  if(!response.ok){const r=await response.json();throw new Error(r.message)}const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download='ShiftCare-bao-cao.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
