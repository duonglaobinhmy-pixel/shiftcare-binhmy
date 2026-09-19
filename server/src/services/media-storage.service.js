import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const URL_CACHE = new Map();
let s3Client;

function firstEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

export function storageConfig() {
  return {
    endpoint: firstEnv('NEON_STORAGE_ENDPOINT', 'S3_ENDPOINT', 'AWS_ENDPOINT_URL_S3', 'AWS_ENDPOINT_URL'),
    accessKeyId: firstEnv('NEON_STORAGE_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'),
    secretAccessKey: firstEnv('NEON_STORAGE_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'),
    region: firstEnv('NEON_STORAGE_REGION', 'AWS_REGION') || 'us-east-1',
    bucket: firstEnv('WOUND_IMAGE_BUCKET', 'NEON_STORAGE_BUCKET', 'S3_BUCKET') || 'bcare-uploads',
    forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true',
  };
}

export function storageConfigured() {
  const cfg = storageConfig();
  return Boolean(cfg.endpoint && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket);
}

function getS3() {
  if (!storageConfigured()) {
    throw new Error(
      'Object Storage chưa được cấu hình. Cần NEON_STORAGE_ENDPOINT/S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY và WOUND_IMAGE_BUCKET.'
    );
  }

  if (!s3Client) {
    const cfg = storageConfig();
    s3Client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }

  return s3Client;
}

function safePathPart(value, fallback = 'unknown') {
  const text = String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return text || fallback;
}

function extensionFor(mimeType) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  throw new Error(`Định dạng ảnh không được hỗ trợ: ${mimeType || 'unknown'}`);
}

export function decodeImageDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('Ảnh phải là JPEG hoặc WebP base64 hợp lệ.');
  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], 'base64'),
  };
}

export function buildWoundImageObjectKey({ branchId, careRecordId, imageId, mimeType, createdAt }) {
  const date = createdAt ? new Date(createdAt) : new Date();
  const yyyy = String(Number.isNaN(date.getTime()) ? new Date().getUTCFullYear() : date.getUTCFullYear());
  const mm = String((Number.isNaN(date.getTime()) ? new Date().getUTCMonth() : date.getUTCMonth()) + 1).padStart(2, '0');
  return [
    'wound-images',
    safePathPart(branchId, 'branch'),
    yyyy,
    mm,
    safePathPart(careRecordId, 'record'),
    `${safePathPart(imageId, 'image')}.${extensionFor(mimeType)}`,
  ].join('/');
}

export async function uploadWoundImage({
  dataUrl,
  branchId,
  careRecordId,
  imageId,
  width,
  height,
  createdAt,
  expiresAt,
}) {
  const { mimeType, buffer } = decodeImageDataUrl(dataUrl);
  if (!buffer.length) throw new Error('Ảnh rỗng.');

  const key = buildWoundImageObjectKey({ branchId, careRecordId, imageId, mimeType, createdAt });
  const cfg = storageConfig();

  await getS3().send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: 'private, max-age=300',
    Metadata: {
      care_record_id: String(careRecordId || ''),
      image_id: String(imageId || ''),
      branch_id: String(branchId || ''),
      width: String(width || ''),
      height: String(height || ''),
      expires_at: String(expiresAt || ''),
    },
  }));

  URL_CACHE.delete(key);

  return {
    objectKey: key,
    mimeType,
    sizeBytes: buffer.length,
  };
}

export async function getSignedWoundImageUrl(objectKey, expiresInSeconds = 900) {
  if (!objectKey || !storageConfigured()) return null;

  const seconds = Math.max(60, Math.min(Number(expiresInSeconds || 900), 3600));
  const now = Date.now();
  const cached = URL_CACHE.get(objectKey);
  if (cached && cached.expiresAt > now + 30_000) return cached.url;

  const cfg = storageConfig();
  const url = await getSignedUrl(
    getS3(),
    new GetObjectCommand({ Bucket: cfg.bucket, Key: objectKey }),
    { expiresIn: seconds }
  );

  URL_CACHE.set(objectKey, {
    url,
    expiresAt: now + Math.min(seconds * 1000, 5 * 60 * 1000),
  });
  return url;
}

export async function deleteWoundImageObject(objectKey) {
  if (!objectKey) return false;
  const cfg = storageConfig();
  await getS3().send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: objectKey }));
  URL_CACHE.delete(objectKey);
  return true;
}

export async function woundImageObjectExists(objectKey) {
  if (!objectKey || !storageConfigured()) return false;
  const cfg = storageConfig();
  try {
    await getS3().send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: objectKey }));
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return false;
    throw error;
  }
}

export function clearWoundImageUrlCache(objectKey) {
  if (objectKey) URL_CACHE.delete(objectKey);
  else URL_CACHE.clear();
}
