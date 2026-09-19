function escapeHtml(value=''){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}
function configured(){const token=String(process.env.TELEGRAM_BOT_TOKEN||'').trim(),chatId=String(process.env.TELEGRAM_ALERT_CHAT_ID||'').trim(),disabled=String(process.env.TELEGRAM_ALERTS_ENABLED||'true').toLowerCase()==='false';return{token,chatId,enabled:!!token&&!!chatId&&!disabled}}
function vitalsText(v){if(!v)return'';return[v.pulse!=null&&`Mạch ${v.pulse}`,v.temperature!=null&&`Nhiệt độ ${v.temperature}°C`,v.bpSys!=null&&`HA ${v.bpSys}/${v.bpDia}`,v.spo2!=null&&`SpO₂ ${v.spo2}%`,v.respiratoryRate!=null&&`Nhịp thở ${v.respiratoryRate}`].filter(Boolean).join(' • ')}

async function send(text){
  const c=configured();if(!c.enabled)return{sent:false,reason:'NOT_CONFIGURED'};
  const response=await fetch(`https://api.telegram.org/bot${c.token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:c.chatId,text,parse_mode:'HTML',disable_web_page_preview:true}),signal:AbortSignal.timeout(6000)});
  const data=await response.json().catch(()=>null);if(!response.ok||!data?.ok)throw new Error(`Telegram HTTP ${response.status}: ${data?.description||'Không gửi được cảnh báo'}`);return{sent:true,messageId:data.result?.message_id||null};
}

export async function notifyUrgentCreated(row){
  const lines=['🚨 <b>BCARE — BIẾN ĐỘNG ĐỎ CẦN XỬ LÝ</b>',`👤 <b>${escapeHtml(row.residentName)}</b>`,`📍 ${escapeHtml([row.branchName,row.areaName,row.roomName,row.bedName].filter(Boolean).join(' • '))}`,`📝 ${escapeHtml(String(row.content||'').slice(0,700))}`];const vitals=vitalsText(row.vitals);if(vitals)lines.push(`❤️ ${escapeHtml(vitals)}`);if(row.vitals?.urgent?.action)lines.push(`🩺 Xử trí ban đầu: ${escapeHtml(row.vitals.urgent.action)}`);lines.push(`✍️ Ghi bởi: ${escapeHtml(row.createdByName||'—')}`,`⏱ ${new Date(row.occurredAt||row.createdAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}`,'➡️ Mở BCARE để cập nhật “Đã xử lý”.');return send(lines.join('\n'));
}

export async function notifyUrgentResolved(row){
  return send(['✅ <b>BCARE — ĐÃ XỬ LÝ CẢNH BÁO ĐỎ</b>',`👤 <b>${escapeHtml(row.residentName)}</b>`,`📍 ${escapeHtml([row.areaName,row.roomName,row.bedName].filter(Boolean).join(' • '))}`,`📌 Kết quả: ${escapeHtml(row.resolutionNote||'')}`,`✍️ Hoàn tất bởi: ${escapeHtml(row.resolvedByName||'—')}`,`⏱ ${new Date(row.resolvedAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}`].join('\n'));
}
