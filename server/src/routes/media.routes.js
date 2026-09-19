import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { authenticate, allowPermission } from '../middleware/auth.js';
import { getPool } from '../services/db.service.js';
import {
  getSignedWoundImageUrl,
  deleteWoundImageObject,
  storageConfigured,
  storageConfig,
} from '../services/media-storage.service.js';

const router = Router();
router.use(authenticate);

function canRead(user, row) {
  if (user.role === 'ADMIN') return true;
  if (row.branch_id && String(row.branch_id) !== String(user.branchId || '')) return false;
  if (user.role === 'CAREGIVER' && user.areaId && row.area_id_snapshot && String(row.area_id_snapshot) !== String(user.areaId)) return false;
  return true;
}

async function findImage(id) {
  const db = getPool();
  if (!db) return null;
  const result = await db.query(`
    SELECT
      i.*,
      c.branch_id,
      c.area_id_snapshot,
      c.bcare_resident_id,
      c.resident_name_snapshot
    FROM care_record_images i
    JOIN care_records c ON c.id=i.care_record_id
    WHERE i.id=$1
    LIMIT 1
  `, [id]);
  return result.rows[0] || null;
}

router.get('/storage-status', allowPermission('SYSTEM.VIEW'), async (_req, res) => {
  const cfg = storageConfig();
  res.json({
    success: true,
    data: {
      configured: storageConfigured(),
      bucket: cfg.bucket,
      endpointConfigured: Boolean(cfg.endpoint),
      credentialConfigured: Boolean(cfg.accessKeyId && cfg.secretAccessKey),
    },
  });
});

router.get('/wound-images/:id', allowPermission('CARE.VIEW'), async (req, res) => {
  const row = await findImage(req.params.id);
  if (!row || !canRead(req.user, row)) {
    return res.status(404).json({ success: false, message: 'Không tìm thấy ảnh.' });
  }
  if (!row.object_key) {
    return res.status(410).json({ success: false, message: 'Ảnh cũ không còn file lưu trữ để hiển thị.' });
  }

  try {
    const url = await getSignedWoundImageUrl(row.object_key, 300);
    if (!url) throw new Error('Object Storage chưa được cấu hình.');
    return res.redirect(302, url);
  } catch (error) {
    return res.status(502).json({ success: false, message: `Không thể mở ảnh: ${error.message}` });
  }
});

router.delete('/wound-images/:id', allowPermission('CARE.DELETE'), async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ success: false, message: 'Chỉ Admin được xóa ảnh đã lưu.' });
  }

  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(422).json({ success: false, message: 'Cần nhập lý do xóa ảnh.' });

  const row = await findImage(req.params.id);
  if (!row) return res.status(404).json({ success: false, message: 'Không tìm thấy ảnh.' });

  try {
    if (row.object_key) await deleteWoundImageObject(row.object_key);
    const db = getPool();
    await db.query('DELETE FROM care_record_images WHERE id=$1', [row.id]);
    await db.query(`
      INSERT INTO audit_logs(
        id,actor_id,actor_name,role,branch_id,action,object_type,object_id,detail,occurred_at
      ) VALUES($1,$2,$3,$4,$5,'WOUND_IMAGE_DELETE','care_record_image',$6,$7::jsonb,NOW())
    `, [
      uuid(),
      req.user.sub || null,
      req.user.fullName || req.user.username || '',
      req.user.role || '',
      row.branch_id || null,
      row.id,
      JSON.stringify({ reason, careRecordId: row.care_record_id, objectKey: row.object_key || null }),
    ]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(502).json({ success: false, message: `Không thể xóa ảnh: ${error.message}` });
  }
});

export default router;
