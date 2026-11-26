import {Router} from 'express';
import {authenticate,allowPermission,scopedBranch} from '../middleware/auth.js';
import {getPool} from '../services/db.service.js';
import {getStore} from '../services/store.service.js';
const router=Router();
router.get('/:id',authenticate,allowPermission('CARE.VIEW','CARE.CREATE'),async(req,res,next)=>{
 try {
  const branch=String(scopedBranch(req,req.query.branchId)||'');
  if(!branch)return res.status(400).json({success:false,message:'Cần chọn cơ sở.'});
  const id=req.params.id, days=[7,15,30].includes(Number(req.query.days))?Number(req.query.days):30;
  const db=getPool();let rows;
  if(db){
   const found=await db.query('SELECT 1 FROM bcare_residents_ref WHERE bcare_resident_id=$1 AND branch_id=$2',[id,branch]);
   if(!found.rowCount)return res.status(404).json({success:false,message:'NCT không thuộc cơ sở hoặc chưa đồng bộ.'});
   const result=await db.query(`SELECT c.id,c.occurred_at AS at,c.content,c.category,c.event_type AS "eventType",v.bp_sys AS "bpSys",v.bp_dia AS "bpDia",v.pulse,v.spo2,v.temperature FROM care_records c LEFT JOIN care_record_vitals v ON v.care_record_id=c.id WHERE c.bcare_resident_id=$1 AND c.branch_id=$2 AND NOT c.deleted AND c.occurred_at>=NOW()-($3::int*interval '1 day') ORDER BY c.occurred_at DESC LIMIT 500`,[id,branch,days]);rows=result.rows;
  }else{
   const s=await getStore();rows=s.changeLogs.filter(x=>String(x.residentId)===id&&String(x.branchId)===branch&&!x.deleted&&Date.parse(x.occurredAt)>=Date.now()-days*86400000).sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt)).slice(0,500).map(x=>({id:x.id,at:x.occurredAt,content:x.content,category:x.category,eventType:x.eventType,...x.vitals}));
  }
  res.set('Cache-Control','no-store');res.json({success:true,data:{rows,days,limited:rows.length===500}});
 }catch(e){next(e)}
});
export default router;
