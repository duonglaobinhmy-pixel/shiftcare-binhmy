
// Straight segments connect actual samples. Missing measurements remain gaps.
export default function ReportTrend({title,description,rows,series,unit='lượt'}) {
  const width=900,height=250,pad=44;
  const values=rows.flatMap(row=>series.map(s=>row[s.key])).filter(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))).map(Number);
  const min=Math.min(0,...values),max=Math.max(1,...values),span=max-min||1;
  const times=rows.map(row=>Date.parse(row.at||row.date||''));
  const timed=times.length>1&&times.every(Number.isFinite)&&times[times.length-1]>times[0];
  const x=i=>pad+(timed?(times[i]-times[0])/(times[times.length-1]-times[0]):rows.length===1?.5:i/Math.max(1,rows.length-1))*(width-pad*2);
  const y=v=>height-pad-(Number(v)-min)/span*(height-pad*2);
  return <div className="panel"><h2>{title}</h2><p>{description}</p>{!rows.length?<p>Chưa có dữ liệu.</p>:<>
    <div style={{overflowX:'auto'}}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}. Đơn vị: ${unit}`} style={{width:'100%',minWidth:480}}>
      {[0,.5,1].map(t=><g key={t}><line x1={pad} x2={width-pad} y1={y(min+t*span)} y2={y(min+t*span)} stroke="#dce1e7"/><text x={pad-7} y={y(min+t*span)+4} textAnchor="end" fontSize="12">{Number((min+t*span).toFixed(1))}</text></g>)}
      {series.map(s=><g key={s.key}>{rows.map((r,i)=>{const v=r[s.key],previous=rows[i-1]?.[s.key];if(v==null||!Number.isFinite(Number(v)))return null;return <g key={i}>{i>0&&previous!=null&&Number.isFinite(Number(previous))&&<line x1={x(i-1)} y1={y(previous)} x2={x(i)} y2={y(v)} stroke={s.color} strokeWidth="2"/>}<circle cx={x(i)} cy={y(v)} r="3" fill={s.color}><title>{r.label}: {s.label} {v} {unit}</title></circle></g>})}</g>)}
      {rows.map((r,i)=>i===0||i===rows.length-1||i%Math.max(1,Math.ceil(rows.length/8))===0?<text key={i} x={x(i)} y={height-12} textAnchor="middle" fontSize="11">{r.label}</text>:null)}
    </svg></div>
    <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>{series.map(s=><span key={s.key} style={{color:s.color}}>● {s.label} ({unit})</span>)}</div>
    <details><summary>Xem số liệu biểu đồ</summary><div className="table-wrap"><table><thead><tr><th>Thời điểm</th>{series.map(s=><th key={s.key}>{s.label}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td>{r.label}</td>{series.map(s=><td key={s.key}>{r[s.key]??'—'}</td>)}</tr>)}</tbody></table></div></details>
  </>}</div>;
}
export function dayRows(from,to) {
  const rows=[];const first=new Date(`${from}T00:00:00Z`),last=new Date(`${to}T00:00:00Z`);
  if(!Number.isFinite(first.getTime())||!Number.isFinite(last.getTime())||last<first)return rows;
  for(let d=first;d<=last;d=new Date(d.getTime()+86400000)){const date=d.toISOString().slice(0,10);rows.push({date,label:date.slice(5).split('-').reverse().join('/')});}
  return rows;
}
