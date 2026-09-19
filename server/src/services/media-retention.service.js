import { v4 as uuid } from 'uuid';
import { getPool, middlewareSchemaReady } from './db.service.js';
import { updateStore } from './store.service.js';
import { deleteWoundImageObject, storageConfigured } from './media-storage.service.js';

export const WOUND_IMAGE_LIMITS = Object.freeze({
  maxFiles: 3,
  maxStoredBytesPerFile: 800 * 1024,
  retentionDays: 90,
});

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i;

function hasValidSignature(buffer, mimeType) {
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/webp') {
    return buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function normalizeExistingImage(item, index) {
  const objectKey = String(item?.objectKey || '').trim();
  if (!objectKey) return null;

  const width = Number(item?.width || 0);
  const height = Number(item?.height || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 3000 || height > 3000) {
    throw new Error(`Kích thước ảnh ${index + 1} không hợp lệ.`);
  }

  return {
    id: String(item?.id || uuid()),
    objectKey,
    mimeType: String(item?.mimeType || ''),
    sizeBytes: item?.sizeBytes == null ? null : Number(item.sizeBytes),
    width,
    height,
    createdAt: item?.createdAt || new Date().toISOString(),
    expiresAt: item?.expiresAt || null,
    legacyDataOmitted: Boolean(item?.legacyDataOmitted),
  };
}

export function sanitizeWoundImages(value, now = new Date()) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Danh sách ảnh vết loét không hợp lệ.');
  if (value.length > WOUND_IMAGE_LIMITS.maxFiles) {
    throw new Error(`Mỗi lần ghi chỉ được tối đa ${WOUND_IMAGE_LIMITS.maxFiles} ảnh vết loét.`);
  }

  return value.map((item, index) => {
    const existing = normalizeExistingImage(item, index);
    if (existing) return existing;

    const dataUrl = String(item?.dataUrl || '');
    const match = dataUrl.match(DATA_URL_PATTERN);
    if (!match) throw new Error(`Ảnh ${index + 1} phải là JPEG hoặc WebP đã được nén.`);

    const mimeType = match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > WOUND_IMAGE_LIMITS.maxStoredBytesPerFile) {
      throw new Error(`Ảnh ${index + 1} sau nén phải nhỏ hơn 800 KB.`);
    }
    if (!hasValidSignature(buffer, mimeType)) {
      throw new Error(`Ảnh ${index + 1} có nội dung không đúng định dạng.`);
    }

    const width = Number(item?.width || 0);
    const height = Number(item?.height || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 3000 || height > 3000) {
      throw new Error(`Kích thước ảnh ${index + 1} không hợp lệ.`);
    }

    const createdAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + WOUND_IMAGE_LIMITS.retentionDays * 24 * 60 * 60 * 1000
    ).toISOString();

    return {
      id: String(item?.id || uuid()),
      dataUrl,
      mimeType,
      sizeBytes: buffer.length,
      width,
      height,
      createdAt,
      expiresAt,
    };
  });
}

async function purgePostgresImages(now) {
  const db = getPool();
  if (!db) return 0;

  const expired = await db.query(`
    SELECT
      i.id,
      i.object_key,
      i.care_record_id,
      c.branch_id
    FROM care_record_images i
    JOIN care_records c ON c.id = i.care_record_id
    WHERE i.expires_at IS NULL OR i.expires_at <= $1
    ORDER BY i.created_at
    LIMIT 500
  `, [now.toISOString()]);

  let removed = 0;

  for (const row of expired.rows) {
    if (row.object_key) {
      if (!storageConfigured()) {
        console.error(`[MEDIA] Không thể xóa ${row.id}: Object Storage chưa cấu hình.`);
        continue;
      }
      try {
        await deleteWoundImageObject(row.object_key);
      } catch (error) {
        console.error(`[MEDIA] Xóa object thất bại ${row.object_key}:`, error?.message || error);
        continue;
      }
    }

    const result = await db.query(`DELETE FROM care_record_images WHERE id=$1`, [row.id]);
    if (!result.rowCount) continue;
    removed += 1;

    await db.query(`
      INSERT INTO audit_logs(
        id, actor_id, actor_name, role, branch_id,
        action, object_type, object_id, detail, occurred_at
      )
      VALUES($1,NULL,'SYSTEM','SYSTEM',$2,'WOUND_IMAGE_RETENTION_PURGE','care_record_image',$3,$4::jsonb,NOW())
    `, [uuid(), row.branch_id || null, row.id, JSON.stringify({ careRecordId: row.care_record_id, objectKey: row.object_key || null })])
      .catch(error => console.error('[MEDIA] Không ghi được audit retention:', error?.message || error));
  }

  return removed;
}

async function purgeLegacyJsonImages(now) {
  const cutoff = now.getTime();
  let removed = 0;

  await updateStore(store => {
    for (const row of store.changeLogs || []) {
      if (!Array.isArray(row.woundImages) || !row.woundImages.length) continue;
      const kept = row.woundImages.filter(image => {
        const expired = !image?.expiresAt || new Date(image.expiresAt).getTime() <= cutoff;
        if (expired) removed += 1;
        return !expired;
      });
      if (kept.length !== row.woundImages.length) {
        row.woundImages = kept;
        row.woundImagesPurgedAt = now.toISOString();
      }
    }
  });

  return removed;
}

export async function purgeExpiredWoundImages(now = new Date()) {
  if (await middlewareSchemaReady()) return purgePostgresImages(now);
  return purgeLegacyJsonImages(now);
}

export function startMediaRetentionCleanup() {
  const run = () => purgeExpiredWoundImages()
    .then(count => {
      if (count) console.log(`Media retention: removed ${count} expired wound image(s).`);
    })
    .catch(error => console.error('Media retention cleanup failed:', error));

  run();
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}
