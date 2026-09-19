import { v4 as uuid } from 'uuid';
import { getPool, middlewareSchemaReady } from './db.service.js';
import { updateStore } from './store.service.js';

export async function audit(user, action, objectType, objectId, detail = {}) {
  const row={id:uuid(),actorId:user?.sub||null,actorName:user?.fullName||user?.username||'SYSTEM',role:user?.role||'SYSTEM',branchId:user?.branchId||null,action,objectType,objectId,detail,occurredAt:new Date().toISOString()};
  if(await middlewareSchemaReady()){
    const db=getPool();
    if(row.branchId)await db.query(`INSERT INTO bcare_branches_ref(bcare_branch_id,name_cache,last_synced_at) VALUES($1,'',NOW()) ON CONFLICT(bcare_branch_id) DO NOTHING`,[String(row.branchId)]);
    await db.query(`INSERT INTO audit_logs(id,actor_id,actor_name,role,branch_id,action,object_type,object_id,detail,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,[row.id,row.actorId,row.actorName,row.role,row.branchId,row.action,row.objectType,row.objectId,JSON.stringify(row.detail||{}),row.occurredAt]);
    return row;
  }
  return updateStore(store=>{store.auditLogs.unshift(row);return row});
}
