const KEY = 'shiftcare_offline_outbox_v1';
export function getOutbox(){ try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return []} }
export function addOutbox(item){ const rows=getOutbox(); rows.push({...item,id:crypto.randomUUID?.()||String(Date.now()),queuedAt:new Date().toISOString()}); localStorage.setItem(KEY,JSON.stringify(rows.slice(-50))); window.dispatchEvent(new Event('shiftcare-outbox')); return rows.length; }
export function removeOutbox(id){ const rows=getOutbox().filter(x=>x.id!==id); localStorage.setItem(KEY,JSON.stringify(rows)); window.dispatchEvent(new Event('shiftcare-outbox')); }
export function clearOutbox(){ localStorage.removeItem(KEY); window.dispatchEvent(new Event('shiftcare-outbox')); }
