import {Router} from 'express';
import {authenticate,allowPermission} from '../middleware/auth.js';
import {getStore} from '../services/store.service.js';
import {canReadShiftHistory,shiftHistorySummary,findPreviousShift} from '../services/shift-history.service.js';
const router=Router();
router.use(authenticate,allowPermission('SHIFT.VIEW'),allowPermission('CARE.VIEW'));
const route=(url,fn)=>router.get(url,(req,res,next)=>Promise.resolve(fn(req,res)).catch(next));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function date(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw Object.assign(new Error('Ngày không hợp lệ.'),{status:400});return value}
route('/',async(req,res)=>{
 const from=date(String(req.query.from||today())),to=date(String(req.query.to||from));
 if(from>to)throw Object.assign(new Error('Từ ngày phải trước hoặc bằng đến ngày.'),{status:400});
 const type=String(req.query.shiftType||'');if(type&&!['MORNING','AFTERNOON','NIGHT'].includes(type))throw Object.assign(new Error('Loại ca không hợp lệ.'),{status:400});
 const store=await getStore();
 const shifts=(store.shifts||[]).filter(s=>canReadShiftHistory(req.user,s)&&s.shiftDate>=from&&s.shiftDate<=to&&(!type||s.shiftType===type)).sort((a,b)=>String(b.shiftDate).localeCompare(String(a.shiftDate))||String(a.shiftType).localeCompare(String(b.shiftType)));
 const data=shifts.map(s=>{const report=shiftHistorySummary(store,s);return{...s,residentCount:report.summary.rosterResidents,summary:report.summary,handoverConfirmedAt:report.handover?.confirmedAt||null}});
 res.json({success:true,data});
});
// Full resident history in the selected shift's branch, with independent read authorization.
route('/:id/resident/:residentId',async(req,res)=>{
 const store=await getStore(),shift=(store.shifts||[]).find(s=>String(s.id)===req.params.id);
 if(!canReadShiftHistory(req.user,shift))return res.status(404).json({success:false,message:'Không tìm thấy ca trong cơ sở được giao.'});
 const residentId=String(req.params.residentId);
 const belongs=(store.shiftResidents||[]).some(r=>String(r.shiftId)===String(shift.id)&&String(r.residentId)===residentId)||
  [...(store.changeLogs||[]),...(store.toiletingLogs||[])].some(r=>String(r.shiftId)===String(shift.id)&&String(r.residentId)===residentId&&!r.deleted);
 if(!belongs)return res.status(404).json({success:false,message:'NCT không thuộc ca đang xem.'});
 const shifts=(store.shifts||[]).filter(s=>String(s.branchId)===String(shift.branchId)&&canReadShiftHistory(req.user,s));
 const reports=shifts.map(s=>shiftHistorySummary(store,s));
 const changes=reports.flatMap(r=>r.changes).filter(r=>String(r.residentId)===residentId);
 const toileting=reports.flatMap(r=>r.toileting).filter(r=>String(r.residentId)===residentId);
 const newest=(a,b)=>(Date.parse(b.occurredAt||b.createdAt)||0)-(Date.parse(a.occurredAt||a.createdAt)||0);
 res.json({success:true,data:{residentId,branchId:shift.branchId,scope:'ALL_HISTORY',changes:changes.sort(newest),toileting:toileting.sort(newest),shifts:shifts.filter(s=>[...changes,...toileting].some(r=>String(r.shiftId)===String(s.id)))}});
});
route('/:id',async(req,res)=>{
 const store=await getStore(),shift=(store.shifts||[]).find(s=>String(s.id)===req.params.id);
 if(!canReadShiftHistory(req.user,shift))return res.status(404).json({success:false,message:'Không tìm thấy ca trong cơ sở được giao.'});
 const previous=findPreviousShift(store,req.user,shift);
 res.json({success:true,data:{...shiftHistorySummary(store,shift),previousShift:previous?shiftHistorySummary(store,previous):null}});
});
export default router;
