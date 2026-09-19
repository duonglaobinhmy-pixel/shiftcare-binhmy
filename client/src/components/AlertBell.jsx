import { useEffect,useRef,useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';

function beep(){try{const AudioContext=window.AudioContext||window.webkitAudioContext,ctx=new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.frequency.value=880;gain.gain.setValueAtTime(.08,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.35);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.35)}catch{}}
export default function AlertBell(){
  const navigate=useNavigate(),[red,setRed]=useState(0),[yellow,setYellow]=useState(0),lastRed=useRef(null);
  useEffect(()=>{let active=true;async function load(){try{const d=(await api.dashboard()).data;if(!active)return;const next=Number(d.openRed||0);if(lastRed.current!==null&&next>lastRed.current){beep();if('Notification'in window&&Notification.permission==='granted')new Notification('BCARE có cảnh báo Đỏ mới',{body:'Mở hệ thống để xử lý ngay.'})}lastRed.current=next;setRed(next);setYellow(Number(d.openYellow||0))}catch{}}load();const timer=setInterval(load,20000);return()=>{active=false;clearInterval(timer)}},[]);
  async function open(){if('Notification'in window&&Notification.permission==='default')try{await Notification.requestPermission()}catch{}navigate('/')}
  const total=red+yellow;return <button type="button" className={`alert-bell ${red?'urgent':''}`} onClick={open} title={`${red} cảnh báo Đỏ, ${yellow} cảnh báo Vàng chưa xử lý`} aria-label={`Cảnh báo chưa xử lý: ${total}`}><span>🔔</span>{total>0&&<b>{total>99?'99+':total}</b>}</button>
}
