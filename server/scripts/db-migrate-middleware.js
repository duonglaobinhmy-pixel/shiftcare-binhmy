import '../src/config/env.js';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getPool, clearSchemaReadyCache, middlewareSchemaReady } from '../src/services/db.service.js';

const pool = getPool();
if (!pool) {
  console.error('Thiếu DATABASE_URL. Điền chuỗi kết nối PostgreSQL thật vào server/.env. Nếu dùng JSON demo thì không cần chạy migration.');
  process.exitCode = 1;
} else {
  const db = await pool.connect();
  try {
    await db.query('SELECT pg_advisory_lock(7342104)');
    const directory = fileURLToPath(new URL('../db/migrations/', import.meta.url));
    const files = (await fs.readdir(directory)).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
    for (const filename of files) {
      const version = filename.slice(0, -4);
      const table = await db.query("SELECT to_regclass('public.schema_migrations') AS name");
      if (table.rows[0]?.name) {
        const applied = await db.query('SELECT 1 FROM schema_migrations WHERE version=$1', [version]);
        if (applied.rowCount) { console.log(`Đã có ${filename}; bỏ qua.`); continue; }
      }
      // Each migration is atomic, including its version marker.
      let sql = await fs.readFile(`${directory}/${filename}`, 'utf8');
      sql = sql.replace(/^\s*BEGIN\s*;/im, '').replace(/^\s*COMMIT\s*;/im, '');
      await db.query('BEGIN');
      try {
        await db.query(sql);
        await db.query('INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING', [version]);
        await db.query('COMMIT');
      } catch (error) { await db.query('ROLLBACK'); throw error; }
      console.log(`Đã áp dụng ${filename}`);
    }
    clearSchemaReadyCache();
    await middlewareSchemaReady();
    console.log('Schema PostgreSQL đã sẵn sàng. Không xóa dữ liệu chăm sóc.');
  } catch (error) {
    console.error(`Migration thất bại: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await db.query('SELECT pg_advisory_unlock(7342104)').catch(() => {});
    db.release();
    await pool.end();
  }
}
