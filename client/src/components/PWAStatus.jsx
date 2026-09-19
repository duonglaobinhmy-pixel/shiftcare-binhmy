import { useEffect,useState } from 'react';
import { api } from '../services/api';
import { getOutbox,removeOutbox } from '../utils/outbox';

export default function PWAStatus(){
  const [online,setOnline]=useState(navigator.onLine),[deferred,setDeferred]=useState(null),[pending,setPending]=useState(getOutbox().length),[syncing,setSyncing]=useState(false);
  useEffect(()=>{
    const on=()=>setOnline(true),off=()=>setOnline(false),before=e=>{e.preventDefault();setDeferred(e)},refresh=()=>setPending(getOutbox().length);
    addEventListener('online',on);addEventListener('offline',off);addEventListener('beforeinstallprompt',before);addEventListener('shiftcare-outbox',refresh);
    return()=>{removeEventListener('online',on);removeEventListener('offline',off);removeEventListener('beforeinstallprompt',before);removeEventListener('shiftcare-outbox',refresh)};
  },[]);
  useEffect(()=>{ if(online && pending) sync(); },[online]);
  async function install(){ if(!deferred)return; deferred.prompt(); await deferred.userChoice; setDeferred(null); }
  async function sync(){ if(syncing||!navigator.onLine)return; setSyncing(true); for(const row of getOutbox()){ try{ if(row.kind==='change')await api.change(row.payload,{skipQueue:true}); if(row.kind==='toileting')await api.toileting(row.payload,{skipQueue:true}); removeOutbox(row.id); }catch{ break; } } setPending(getOutbox().length); setSyncing(false); }
  return <div className="pwa-status">
    <span className={online?'net online':'net offline'}>{online?'● Online':'● Offline'}</span>
    {pending>0&&<button className="pwa-mini" onClick={sync} disabled={!online||syncing}>{syncing?'Đang đồng bộ…':`${pending} chờ đồng bộ`}</button>}
    {deferred&&<button className="pwa-mini" onClick={install}>Cài ứng dụng</button>}
  </div>
}
