import pg from 'pg';

const { Pool } = pg;
let pool;
let schemaCache={value:null,expiresAt:0};

export function hasDatabase() {
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

export function getPool() {
  if (!hasDatabase()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false },
    });
    pool.on('error', error => console.error('[POSTGRES] pool error', error));
  }
  return pool;
}

export async function withTransaction(work) {
  const db = getPool();
  if (!db) throw new Error('DATABASE_URL chưa được cấu hình.');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function clearSchemaReadyCache(){schemaCache={value:null,expiresAt:0}}

export async function middlewareSchemaReady() {
  if (!hasDatabase()) return false;
  if(schemaCache.value!==null && Date.now()<schemaCache.expiresAt)return schemaCache.value;
  const r = await getPool().query(`SELECT to_regclass('public.shifts') AS shifts, to_regclass('public.bcare_residents_ref') AS residents_ref`);
  const value=Boolean(r.rows[0]?.shifts && r.rows[0]?.residents_ref);
  schemaCache={value,expiresAt:Date.now()+30_000};
  return value;
}

export async function databaseHealth() {
  if (!hasDatabase()) return { mode: 'JSON_FILE_DEMO', ok: true, middlewareSchemaReady: false };
  try {
    const r = await getPool().query(`SELECT NOW() AS now, to_regclass('public.shifts') AS shifts, to_regclass('public.bcare_residents_ref') AS residents_ref`);
    const ready=Boolean(r.rows[0]?.shifts && r.rows[0]?.residents_ref);
    schemaCache={value:ready,expiresAt:Date.now()+30_000};
    return {mode:'POSTGRESQL_MIDDLEWARE',ok:true,now:r.rows[0]?.now,middlewareSchemaReady:ready};
  } catch (error) {
    return { mode: 'POSTGRESQL_MIDDLEWARE', ok: false, middlewareSchemaReady: false, error: String(error?.message || error) };
  }
}
