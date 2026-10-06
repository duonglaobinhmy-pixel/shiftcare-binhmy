import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '../utils/files.js';
import { hasDatabase, getPool, withTransaction } from './db.service.js';

export const COLLECTIONS = ['zones','floors','rooms','residents','locations','shifts','scopes','assignments','tasks','activities','handovers','interactions','followups','schedules','snapshots','amendments','audits'];
export const emptyOperations = () => Object.fromEntries(COLLECTIONS.map(k => [k, []]));
const queues = new Map();
const operationsDataDir=process.env.SHIFTCARE_OPERATIONS_DATA_DIR||dataDir;
const filename = branchId => path.join(operationsDataDir, `operations-${Buffer.from(branchId).toString('hex')}.json`);
async function loadFile(branchId) {
  try { return {...emptyOperations(), ...JSON.parse(await fs.readFile(filename(branchId), 'utf8'))}; }
  catch (e) { if (e.code === 'ENOENT') return emptyOperations(); throw e; }
}
async function ensureSchema(db) {
  const result = await db.query("SELECT to_regclass('public.shiftcare_operations') AS table_name");
  if (!result.rows[0]?.table_name) throw Object.assign(new Error('Chạy npm run db:migrate:middleware trong server để bổ sung schema vận hành V2.'), {status:503});
}
async function loadDb(db, branchId) {
  const state = emptyOperations();
  const result = await db.query('SELECT kind,payload FROM shiftcare_operations WHERE branch_id=$1', [branchId]);
  for (const row of result.rows) if (state[row.kind]) state[row.kind].push(row.payload);
  return state;
}
export async function readOperations(branchId) {
  if (!hasDatabase()) return loadFile(branchId);
  const db = getPool(); await ensureSchema(db); return loadDb(db, branchId);
}
export async function transactOperations(branchId, work) {
  if (hasDatabase()) return withTransaction(async db => {
    await ensureSchema(db);
    // Includes activities, roster, staff, tasks and signing in the same branch lock.
    // Independent API processes cannot race a write against a scope signature.
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`shiftcare-v2:${branchId}`]);
    const state = await loadDb(db, branchId);
    const before = new Map(COLLECTIONS.flatMap(kind => state[kind].map(row => [`${kind}:${row.id}`, JSON.stringify(row)])));
    const result = await work(state);
    for (const kind of COLLECTIONS) for (const row of state[kind]) {
      const json = JSON.stringify(row);
      if (json !== before.get(`${kind}:${row.id}`)) await db.query(`INSERT INTO shiftcare_operations(branch_id,kind,id,payload) VALUES($1,$2,$3,$4::jsonb)
        ON CONFLICT(branch_id,kind,id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`, [branchId,kind,row.id,json]);
    }
    return result;
  });
  const previous = queues.get(branchId) || Promise.resolve();
  const operation = previous.then(async () => {
    const state = await loadFile(branchId);
    const result = await work(state);
    await fs.mkdir(operationsDataDir, {recursive:true});
    const target=filename(branchId), temporary=`${target}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state), 'utf8');
    await fs.rename(temporary, target);
    return result;
  });
  const settled=operation.then(()=>undefined,()=>undefined);
  queues.set(branchId,settled);
  settled.then(()=>{if(queues.get(branchId)===settled)queues.delete(branchId)});
  return operation;
}
