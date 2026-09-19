import { getPool, middlewareSchemaReady } from './db.service.js';

export async function cacheBcareResidents(items = []) {
  if (!Array.isArray(items) || items.length === 0 || !await middlewareSchemaReady()) return;
  const db = getPool();
  for (const r of items) {
    if (!r?.id) continue;
    if (r.branchId) {
      await db.query(`
        INSERT INTO bcare_branches_ref(bcare_branch_id, code_cache, name_cache, last_synced_at)
        VALUES($1,$2,$3,NOW())
        ON CONFLICT(bcare_branch_id) DO UPDATE SET
          code_cache=COALESCE(NULLIF(EXCLUDED.code_cache,''),bcare_branches_ref.code_cache),
          name_cache=COALESCE(NULLIF(EXCLUDED.name_cache,''),bcare_branches_ref.name_cache),
          last_synced_at=NOW()
      `, [String(r.branchId), String(r.branchCode || ''), String(r.branchName || '')]);
    }
    await db.query(`
      INSERT INTO bcare_residents_ref(
        bcare_resident_id,code_cache,full_name_cache,branch_id,
        area_id_cache,area_name_cache,room_id_cache,room_name_cache,bed_name_cache,image_cache,
        active_cache,raw_cache,last_synced_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,NOW())
      ON CONFLICT(bcare_resident_id) DO UPDATE SET
        code_cache=EXCLUDED.code_cache,
        full_name_cache=EXCLUDED.full_name_cache,
        branch_id=EXCLUDED.branch_id,
        area_id_cache=EXCLUDED.area_id_cache,
        area_name_cache=EXCLUDED.area_name_cache,
        room_id_cache=EXCLUDED.room_id_cache,
        room_name_cache=EXCLUDED.room_name_cache,
        bed_name_cache=EXCLUDED.bed_name_cache,
        image_cache=EXCLUDED.image_cache,
        active_cache=EXCLUDED.active_cache,
        raw_cache=EXCLUDED.raw_cache,
        last_synced_at=NOW()
    `, [
      String(r.id), String(r.code || ''), String(r.fullName || ''), r.branchId ? String(r.branchId) : null,
      r.areaId ? String(r.areaId) : null, String(r.areaName || ''), r.roomId ? String(r.roomId) : null,
      String(r.roomName || ''), String(r.bedName || ''), String(r.image || ''), r.status !== 0,
      JSON.stringify(r),
    ]);
  }
}

export async function logBcareSync({ operation, endpoint = '', branchId = null, success, itemCount = null, durationMs = null, error = null, meta = {} }) {
  if (!await middlewareSchemaReady()) return;
  await getPool().query(`
    INSERT INTO integration_sync_logs(provider,operation,endpoint,branch_id,success,item_count,duration_ms,error_message,request_meta)
    VALUES('BCARE',$1,$2,$3,$4,$5,$6,$7,$8::jsonb)
  `, [operation, endpoint, branchId, !!success, itemCount, durationMs, error ? String(error).slice(0,2000) : null, JSON.stringify(meta || {})]);
}
