import { Router } from 'express';
import { authenticate, allowRoles, scopedBranch } from '../middleware/auth.js';
import { diagnostics, getResidents } from '../services/bcare.service.js';
import { CARE_BRANCHES } from '../config/branches.js';

const router = Router();
router.use(authenticate);

router.get('/diagnostics', allowRoles('ADMIN', 'BRANCH_DIRECTOR'), async (_req, res) => {
  res.json(await diagnostics());
});

router.get('/branches', (req, res) => {
  let rows = CARE_BRANCHES;
  if (req.user.role !== 'ADMIN') rows = rows.filter(x => x.id === req.user.branchId);
  res.json({ success:true, data:rows });
});

router.get('/locations', async (req,res) => {
  const branchId = scopedBranch(req, req.query.branchId || '');
  if (!branchId) return res.json({success:true,data:{areas:[],rooms:[]}});
  try {
    let page=1,totalPage=1,all=[];
    do {
      const r=await getResidents({pageIndex:page,pageSize:100,branchId,status:1});
      all.push(...(r.items||[])); totalPage=Number(r.totalPage||1); page++;
    } while(page<=totalPage && page<=20);
    const areaMap=new Map(), roomMap=new Map();
    for(const x of all){
      if(x.areaId && x.areaName) areaMap.set(x.areaId,{id:x.areaId,name:x.areaName});
      if(x.roomId && x.roomName) roomMap.set(x.roomId,{id:x.roomId,name:x.roomName,areaId:x.areaId||null,areaName:x.areaName||''});
    }
    const sort=(a,b)=>a.name.localeCompare(b.name,'vi');
    res.json({success:true,data:{areas:[...areaMap.values()].sort(sort),rooms:[...roomMap.values()].sort(sort)}});
  } catch(e){ res.status(502).json({success:false,message:e.message}); }
});

router.post('/residents', async (req, res) => {
  const payload = { ...req.body };
  payload.branchId = scopedBranch(req, payload.branchId);
  const query=String(payload.query||'').trim().toLocaleLowerCase('vi'),requestedArea=payload.areaId||'';
  let data;
  if(query||requestedArea){
    let page=1,totalPage=1,all=[];do{const batch=await getResidents({...payload,pageIndex:page,pageSize:100});all.push(...(batch.items||[]));totalPage=Number(batch.totalPage||1);page++}while(page<=totalPage&&page<=20);
    if(requestedArea)all=all.filter(x=>x.areaId===requestedArea);
    if(query)all=all.filter(x=>`${x.fullName||''} ${x.code||''} ${x.roomName||''} ${x.bedName||''}`.toLocaleLowerCase('vi').includes(query));
    const pageIndex=Math.max(1,Number(payload.pageIndex||1)),pageSize=Math.min(100,Math.max(1,Number(payload.pageSize||20))),start=(pageIndex-1)*pageSize;
    data={pageIndex,pageSize,totalItem:all.length,totalPage:Math.max(1,Math.ceil(all.length/pageSize)),items:all.slice(start,start+pageSize),serverFiltered:true};
  }else data=await getResidents(payload);
  res.json({ success: true, data });
});

export default router;
